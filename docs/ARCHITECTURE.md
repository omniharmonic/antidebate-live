# Topology Live — Technical Architecture

**Author:** Benjamin Life (@omniharmonic) · **Version:** 1.0 · **Date:** 2026-09-28
Implements [PRD](./PRD.md) over the model in [ONTOLOGY](./ONTOLOGY.md).

---

## 1. System overview

```
 VENUE (operator laptop, Apple Silicon)                       CLOUD
┌───────────────────────────────────────────────┐         ┌──────────────────────────────────────┐
│ CAPTURE (Python)                               │         │ Postgres (Neon)                       │
│  audio interface ch1..chN ─▶ VAD ─▶ channel    │  HTTPS  │  events (append-only)                 │
│  gate ─▶ Parakeet ASR (word ts) ─▶ voiceprint  │────────▶│  projections (current state)          │
│  ─▶ attribution fusion ─▶ Utterance events     │         │  snapshots (for playback seek)        │
│  + raw multitrack WAV recording (local)        │         │  llm_calls, eval results              │
│                                                │         └───────────────▲──────────────────────┘
│ PIPELINE WORKER (Node/TS, long-lived)          │                         │
│  turn buffer ─▶ L1 segment+extract ─▶ L2 link  │─────────────────────────┘
│  ─▶ validators ─▶ L3 critic ─▶ L4 structure    │
│  ─▶ L5 insight ─▶ events                       │         ┌──────────────────────────────────────┐
│  (Claude Opus 5.5 via Anthropic SDK)           │         │ WEB (Next.js 16 on Vercel)            │
└───────────────────────────────────────────────┘         │  /api/events/stream  SSE              │
                                                           │  /console  /cockpit  /stage/:channel  │
 Devices: cockpit (iPad) · stage (projector PC/laptop)     │  /overlay/:channel  /p/:event (phones)│
          · operator (laptop) — all browsers ◀────────────│  /play/:event (playback explorer)     │
                                                           │  /setup/:event                        │
                                                           └──────────────────────────────────────┘
```

**Why a long-lived worker, not serverless:** the pipeline holds turn buffers, timers, ordering guarantees and in-flight LLM calls across a 90-minute session. A single Node process on the operator laptop (or a small VM) is simpler and faster than orchestrating serverless steps, and it keeps working if the web tier has a hiccup. The same worker binary runs replays and post-event canonical passes.

## 2. Capture & speaker attribution (`services/capture`, Python)

### 2.1 Signal path
1. **Input:** CoreAudio multichannel device (a 4–8 channel USB interface, or a direct out from the venue mixer). A channel map is set in Setup: ch1 = Debater A, ch2 = Debater B, ch3 = Moderator, ch4 = Audience Q&A mic, ch5 = room ambient (optional, recording only).
2. **Recording:** every channel is written continuously to a local multitrack WAV (48 kHz) with an event-clock timestamp. That file is the master for playback and the canonical pass.
3. **VAD:** Silero VAD per channel. Speech regions are aligned across channels.
4. **Channel gate (bleed suppression):** for overlapping speech regions, compare per-channel RMS. The owner is the channel louder by ≥ 6 dB (tunable at sound check), and the others are marked bleed. Loud on two or more channels within 6 dB means true overlap, kept as separate utterances.
5. **ASR:** Parakeet TDT 0.6B (v3) via `parakeet-mlx` on the owner channel segment, with word-level timestamps. Streaming partials go to the operator console only.
6. **Voiceprint check:** speaker embedding of the segment (ECAPA/TitaNet class, or FluidAudio's embedder in R3) compared with the embeddings enrolled at sound check. The result is a similarity for each enrolled participant.
7. **Streaming diarization:** used on any channel shared by several voices (the audience mic, the room mic, or a mixed feed in remote/hybrid mode). Streaming Sortformer or diart. On single-person channels it's a cross-check, not the primary signal.
8. **Fusion:** `confidence = f(channel ownership margin, voiceprint similarity to the channel's expected owner, diarizer agreement, overlap)`. Owner-confirmed and ≥ 0.85 → auto. Below that → `attribution.pending` to the console and held from all downstream release until confirmed.
9. **Emit:** `utterance.final` events over HTTPS, batched every 250 ms, idempotent by `utteranceId`. There's a local on-disk queue so nothing is lost during network loss.

### 2.2 Fallbacks
- **ASR fallback:** a hosted streaming ASR with multichannel support (e.g., Deepgram multichannel), switchable by config at runtime without dropping the recording.
- **Manual:** the operator types or pastes an utterance with a participant key and time.

### 2.3 Offline path (replays and canonical)
Recording (or a downloaded video's audio) → Parakeet on each track, or on the mix → offline diarization (pyannote, best available pipeline) → operator relabel pass in the console → `utterance.final` events with `source: offline`. This is how R0 turns YouTube Anti-Debates into pipeline input.

## 3. Pipeline (`packages/pipeline`, run by `apps/worker`)

### 3.1 Passes

| Pass | Trigger | Input | Output events | Effort | Target latency |
|---|---|---|---|---|---|
| **L0 Turn buffer** | Utterances | Utterance stream | `turn.closed` at a speaker change, a pause > 1.2 s after ≥ 8 words, or a 25 s window in monologues | — | — |
| **L1 Segment & extract** | `turn.closed` | Turn text with word ids; the last 3 turns; the compact commitment stores; the proposition index (id + canonical, all) | `adu.proposed`, `proposition.proposed` (new or `sameAs` an existing id), `stance.proposed`, `relation.proposed`, `basis.proposed`, `question.proposed` | medium | ≤ 6 s p50 |
| **L1v Validators** (code) | L1 output | Spans + proposals | `validation.failed` or pass | — | < 50 ms |
| **L2 Critic** | Validated L1 items | Items + exact spans + ±1 turn context | `critic.verdict` {pass, repair(text), reject, reason} per item | medium | ≤ 5 s, parallel with L3 on passing items |
| **L3 Link & structure** | Every ~45 s or 4 turns | Changed props + neighbors | `equivalence.proposed`, `relation.proposed` (cross-turn), `presupposition.proposed` (with necessity test), `concept.sense.proposed` | high | ≤ 25 s |
| **L4 Insight** | Round boundary, operator request, or every ~3 min | Full stores + graph + ledgers | `crux.proposed` (graph-ranked), `higherground.proposed`, `drift.proposed`, `prompt.proposed`, `steelman.assessed`, `update.detected` | high | ≤ 45 s |
| **Canonical** | Post-event | Full transcript (corrected) + all live events | Complete recomputation at effort `xhigh` in context windows by round, then global linking. Reconciled with live items (`canonical.supersedes`). | xhigh | offline |

Every pass writes proposals. Only operator actions or auto-approval policies write `*.approved`, and only `release.*` events reach audiences.

### 3.2 Model use
- **Model:** `claude-opus-5-5` for all reasoning passes, through the official Anthropic TypeScript SDK (`@anthropic-ai/sdk`). Effort is set per pass (table above) with adaptive thinking. Structured outputs use `messages.parse` with Zod schemas generated from `packages/ontology`. Server-side refusal fallbacks are enabled (`fallbacks: "default"`).
- **Why direct SDK instead of the AI Gateway used in Ontography:** explicit prompt-cache control, per-pass effort, structured outputs, and refusal fallbacks. The worker also runs on a laptop, where Vercel OIDC is less natural. A thin `llm.ts` wrapper keeps a gateway swap possible.
- **Latency plan:** measure L1 on replays at effort `low`, `medium` and `high`. If p50 is over 6 s at an acceptable quality level, the options for Benjamin to choose between are lowering L1's effort, or measuring a faster model for L1 only against the same gold set (QUALITY §4). The quality gate decides; nothing is downgraded silently.
- **Caching:** each pass has a frozen system prompt (ontology rules, schema, examples) followed by the append-only session context (proposition index, stores). This is ordered so that each new turn only appends. Cache hits are verified through `usage.cache_read_input_tokens` in `llm_calls`.
- **Independence of the critic:** a different system prompt, no access to L1's reasoning, and only spans + items. It's judged against §8 of the ontology.

### 3.3 Validators (deterministic, `packages/pipeline/validate`)
- Span existence: every char range exists in the utterance text, and the quoted text matches exactly.
- Entity/number diff: named entities, numbers, units and years in `canonical` ⊆ spans ∪ resolved antecedents.
- Hedge lexicon: hedge tokens in the span → the minimum strength allowed; a stronger stated strength is a fail.
- Quantifier lexicon: "some / many / most / all" in the span must match `scope.quantifier`.
- Speech-act guard: `attribute` or `steelman_report` ADUs can't produce stances for the speaker.
- Attribution guard: items from utterances with `attribution.pending` are held.

### 3.4 Identity resolution
Propositions are the unit of comparison, so duplicate or near-duplicate propositions quietly break disagreement detection. L1 sees the full proposition index (it stays small: typically < 300 per event) and proposes `sameAs`. L3 re-checks new propositions against their neighbors: first by embedding similarity (for candidate retrieval; R2+, with Voyage or another embedding provider), then by adjudication with a strict equivalence test. The test is same truth conditions under the same scope, and **polarity-normalized**. Merges are events; they're reversible and shown in the console.

### 3.5 Crux ranking (code, `packages/graph`)
For each disagreement D on P: compute each participant's support/presupposition subgraph toward P. Candidates C are the nodes on both participants' paths with a disagreement on C. Score = Σ over disagreements whose paths include C (weighted by stratum depth), × path confidence (stated links 1.0, inferred 0.5). The top-k go to L4, which writes the crux card (update conditions, settling evidence type). This extends Ontography's `graph/analytics.ts` (merged graph, shortest path, deepest shared assumption).

## 4. Event sourcing

### 4.1 Event log
`events(id bigserial, eventId uuid, sessionId, type, actor {system|operator|facilitator|participant}, mediaMs, wallTs, payload jsonb, causedBy uuid[])`

- Append-only; idempotent by `eventId`.
- `mediaMs` is the position in the recording; `wallTs` is when it happened. Playback uses `mediaMs` for content and can use `wallTs` for "as seen live" (items appear when they appeared in the room, not when they were said).

Main event families:
- `utterance.*`
- `attribution.*`
- `adu.*`, `proposition.*`, `stance.*`, `relation.*`, `basis.*`, `presupposition.*`, `concept.*`
- `question.*`, `update.*`, `steelman.*`, `crux.*`, `higherground.*`, `drift.*`, `prompt.*`
- `critic.*`, `validation.*`
- `*.approved | *.edited | *.rejected | *.merged` (operator)
- `round.*`
- `dial.set` (channel, level, toggles), `release.*`, `blackout.*`, `spotlight.*`
- `canonical.*`

### 4.2 Projections
Pure reducers in `packages/core/projections` build the state: stores, graph, ledgers, visible sets per channel. The same reducers run in the worker (to write current-state tables for fast reads), in the web app (client-side, from the event stream) and in playback (from a snapshot plus the delta). Reducers are deterministic and unit-tested against fixtures.

### 4.3 Snapshots
Every 200 events, or at every round boundary, a projection snapshot is stored. Playback seek = nearest snapshot ≤ t, then apply events up to t. The target is < 150 ms to seek anywhere in a 90-minute event.

## 5. Real-time delivery
- **Transport:** SSE at `/api/events/stream?session=…&after=cursor&view=console|cockpit|stage:<channel>`. The server filters by view: audience channels only ever receive `release.*`-derived render payloads, never raw proposals. That gives audience safety on the server side.
- **Source:** the route tails the events table (poll every 400 ms on the indexed `id > cursor`). There are few clients (console, cockpit, 1–3 outputs), so this is ample. Audience phones read a CDN-cached render snapshot every 2 s. A managed pub/sub is the R3 upgrade path.
- **Resilience:** clients resume from their cursor. The cockpit and stage keep the last good state if the stream drops, with a small offline indicator visible only on the operator's and facilitator's devices.

## 6. Rendering

### 6.1 2D argument map
SVG, with a deterministic layered layout: participants in columns, a shared column, and strata in rows. Stable positions: a node's position is computed once when it's released, then pinned. Tested at 1080p projector distance: minimum 28 px text on stage.

### 6.2 3D topology (`packages/topology3d`)
- **Stack:** react-three-fiber + drei, with instanced meshes for nodes and custom line geometry for edges. Deterministic layout; no free-running force jitter.
- **Axes:**
  - X is **stance polarity**: the participant's hemisphere, with shared propositions at x ≈ 0 and positioned by stance balance.
  - Y is **stratum depth**: ontology at the bottom, praxis at the top, higher ground floating above.
  - Z is **time of first assertion**. It can be collapsed to a plane.
  - An alternate "semantic" layout uses embedding UMAP.
- **Encodings:**
  - shape = proposition type (sphere empirical, octahedron predictive, cone prescriptive, torus normative, box definitional)
  - hue = participant stance
  - lightness/opacity = epistemic status (inferred translucent)
  - size = centrality / crux score
  - edge style = relation (rebut solid, undercut broken, undermine dotted, supports thin light)
- **Crux** is rendered as a fault plane between the hemispheres, intersecting the crux proposition. **Higher ground** nodes are lifted above, with filaments to their derivation nodes on both sides.
- **Camera:** orbit + focus-fly for interactive use. **Cinematic mode** for stage: slow deterministic orbit, auto-focus on newly released items, no user input.
- **Performance budget:** 60 fps at 500 nodes on an M-series laptop driving a projector. Degrades to the 2D map automatically below 40 fps.
- **Accessibility:** every 3D view has a synchronized 2D and list equivalent.

### 6.3 Design system
Open Field (inherited from DT and Ontography): light field, ink scale, per-participant voice colors (generated), violet = convergence/higher ground, amber = drift/insight (rare). A dark "stage" variant for projection. Type: Instrument Serif (display), Inter (text), JetBrains Mono (data, timecodes). See UX §2.

## 7. Playback (`apps/web/play`)
- **Media:** audio master (multitrack mixdown) + video when available (the conference AV recording, aligned by clap or cross-correlation of audio to the event clock). Stored in object storage (Vercel Blob or Cloudflare R2), streamed as HLS.
- **State at t:** snapshot + events (§4.3). Mode `canonical` (default) or `as_seen_live` (visibility follows `release.*` wall times and dial levels, so viewers can see exactly what the room saw).
- **Navigation:** scrubber with round chapters, crux markers and update markers; transcript follows the playhead. Clicking any node opens its spans and seeks the media.
- **Deep links:** `/play/:event#t=1234` style links aren't possible inside some embeds, so links use path segments: `/play/:event/at/1234`, `/play/:event/p/:propositionId`, `/play/:event/crux/:id`.
- **Publication:** requires every participant's review window to close (PRD F31). Contested items stay labeled.

## 8. Data model (projection tables; Drizzle)

```ts
events, snapshots
sessions        { id, title, format jsonb /*rounds*/, startedAt, recording { tracks[], videoUrl?, offsetMs } }
participants    { id, sessionId, key /*A,B,MOD,AUD*/, displayName, role, color, channel?, voiceprint vector? }
utterances      { id, sessionId, participantId, startMs, endMs, text, words jsonb, attribution jsonb, overlapsWith uuid[] }
adus            { id, sessionId, spans jsonb, speechAct, addressedTo, status }
propositions    { id, sessionId, canonical, type, stratum, scope jsonb, conditions jsonb, quantities jsonb, forecast jsonb, status, provenance jsonb }
stances         { id, propositionId, participantId, atMs, attitude, strength, credence?, source, viaAduId }
relations       { id, type, fromId, toId, scheme?, premises uuid[]?, status, provenance jsonb }
bases           { id, aduId, basis, stated bool, sourceId? }
sources         { id, sessionId, citation jsonb, checkable bool }
presuppositions { id, propositionId /*the presupposed*/, forPropositionId, necessity jsonb, status }
concepts, senses, drifts
questions       { id, askerId, addresseeId, aduId, propositionId?, status, answerAduId? }
updates         { id, participantId, propositionId, before jsonb, after jsonb, triggerAduId? }
cruxes          { id, propositionId, forDisagreements uuid[], score, updateConditions jsonb, settlingEvidence, status }
higher_ground   { id, text, construction, derivation jsonb, costs jsonb, status }
steelmans       { id, byParticipantId, ofParticipantId, aduId, captured/missed/distorted/added jsonb, confirmed? }
prompts         { id, text, rationale, targets uuid[], status }
visibility      { sessionId, channel, level, toggles jsonb, mode /*live|reveal*/ }
llm_calls       { id, pass, promptVersion, model, effort, inputTokens, cacheReadTokens, outputTokens, latencyMs, sessionId }
```

## 9. Infrastructure

| Piece | Choice |
|---|---|
| Web | Next.js 16 (App Router) on Vercel. Read the repo's `node_modules/next/dist/docs/` before coding; APIs differ from older versions (carried over from Ontography's AGENTS.md). |
| DB | Neon Postgres (+ pgvector from R2) |
| Worker | Node 22, a single process; runs on the operator laptop for live events and anywhere for replays/canonical |
| Capture | Python 3.12, `uv`; parakeet-mlx, silero-vad, sounddevice, a speaker-embedding model, diart/pyannote for shared channels |
| Media | Local multitrack WAV → post-event upload to Blob/R2; HLS for playback |
| LLM | Anthropic API, `claude-opus-5-5`, `@anthropic-ai/sdk` |
| Auth | R1: signed per-role links (console, cockpit, stage:<channel>) with short-lived tokens. R3: accounts. |
| Observability | `llm_calls` table, pipeline lag metrics on the console health strip, structured logs |

## 10. Cost envelope (Opus 5.5: $4 / $20 per MTok, cache reads $0.20)

A 90-minute two-person event produces ~15–20k spoken words and ~200 turns.

| Pass | Calls | Tokens per call (cached / fresh in / out incl. thinking) | Est. cost |
|---|---|---|---|
| L1 | ~200 | 10k / 1.5k / 2k | ~$10 |
| L2 critic | ~200 | 6k / 1.5k / 1k | ~$6 |
| L3 | ~120 | 20k / 4k / 3k | ~$9 |
| L4 | ~25 | 40k / 8k / 6k | ~$4 |
| **Live total** | | | **≈ $30** |
| Canonical pass | — | full context, xhigh | ≈ $20–40 |

These are estimates to be replaced with measured numbers from R0 replays. Each replay run of a 90-minute debate costs about the same as a live event, so prompt iteration uses 10–15-minute gold segments.

## 11. Failure modes

| Failure | Behavior |
|---|---|
| Venue internet drops | Capture keeps recording and queues events locally. The worker queues LLM calls and resumes. The cockpit shows "paused", with the last state kept. A phone hotspot is the backup for the operator laptop and the cockpit. |
| LLM latency spike | Passes drop to their fallback cadence (L3/L4 postponed to round boundaries). L1 continues. Console health turns amber. |
| Refusal | Server-side fallback; if that also refuses, the item goes to the operator as "needs manual". |
| Attribution uncertain | Held; operator hotkey; nothing downstream releases. |
| Stage machine crash | The stage URL reloads to the current state from the event log (cold start < 3 s). |
| Wrong item released | Operator "retract" → `release.retracted`. The item fades out within 600 ms on all channels; playback shows it in "as seen live" mode with a retraction marker. |
