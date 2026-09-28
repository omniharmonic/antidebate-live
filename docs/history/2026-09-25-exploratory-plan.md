> **Superseded (2026-09-28):** this exploratory plan has been replaced by the full documentation set in [`docs/live/`](./live/README.md), which incorporates Stephanie Lepp's feedback and the expanded product vision.

# Ontography Live: Real-Time Mapping for the Anti-Debate

**Author:** Benjamin Life ([@omniharmonic](https://github.com/omniharmonic)) · **Date:** 2026-09-25 · **Status:** Design proposal, for discussion with Stephanie Lepp
**Builds on:** [Dialectical Topology](https://github.com/omniharmonic/dialecticaltopology) (the proof of concept) and Ontography (this repo)

---

## 0. The one-paragraph version

Two people talk. A capture layer turns their speech into speaker-labeled text within about a second. A tiered AI pipeline turns each finished turn into **claims**, links them to what has already been said (builds on / challenges / agrees / reframes), and every minute or so digs below them to find the **assumptions** each person is standing on. It also looks across the two speakers for **common ground, cruxes, and words they use differently**. A facilitator console lets a human operator approve what reaches the room. A calm stage display shows the map growing: *common ground → higher ground*. After the event, the same data becomes a full Dialectical Topology–style explorer and an Ontography handshake between the two debaters, for free.

The main design point: **transcription is not the hard part.** The hard parts are (1) making AI interpretation trustworthy enough to show on stage, in front of the people being interpreted, and (2) keeping a live graph calm enough to watch without pulling attention from the humans.

---

## 1. What the Anti-Debate needs from a tool

From Stephanie's public description ([What is The Anti-Debate?](https://www.synthesismedia.org/p/what-is-the-anti-debate), [anti-debate.org](https://www.anti-debate.org/)): it starts like a normal debate, with openings and rebuttals, and then keeps going. Participants build on each other's perspectives, steelman, and integrate, moving "from common ground to higher ground." The aim is to expand minds, not change them.

That arc maps directly onto what the tool should show at each moment:

| Anti-Debate movement | What the map should make visible | Tool feature |
|---|---|---|
| Opening statements | Each person's position and what it rests on | **Positions view**: two territories of claims, with inferred roots under them |
| Rebuttals | Where they actually clash, and where the clash is only apparent | **Clash edges**, **semantic drift alerts** ("you both say *safety* but mean different things") |
| Steelmanning | Whether A's restatement of B's view is one B would recognize | **Steelman check**: A's restatement laid over B's actual claims, which B confirms or corrects |
| Building / integrating | Claims that include both perspectives | **Higher-ground nodes**: synthesis claims linked to their sources on both sides |
| Close | What moved, what stayed genuinely different | **Arc summary**: shared ground, open cruxes, and the honest disagreements that remain |

> ⚠️ I don't know her exact round structure, timings, or whether there are judges or audience participation. The tool should be **phase-aware but configurable**: phases are data, not code. See §10 for the questions to ask her.

---

## 2. Form factor: four surfaces, not one

The old repos were single-user explorers. A live event has different people with different jobs:

```
┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐
│  FACILITATOR CONSOLE │  │    STAGE DISPLAY     │  │   AUDIENCE (phone)   │
│  laptop, operator    │  │  projector / stream  │  │  QR code, optional   │
│                      │  │                      │  │                      │
│ • live transcript    │  │ • the growing map    │  │ • follow the map     │
│ • claim queue:       │─▶│ • one insight card   │  │ • tap a claim → the  │
│   approve/merge/edit │  │   at a time          │  │   exact words said   │
│ • insight cards:     │  │ • phase title        │  │ • (later) "this      │
│   push / hold        │  │ • big type, calm     │  │   shifted me"        │
│ • phase control      │  │   motion             │  │                      │
│ • fix speaker labels │  │                      │  │                      │
└──────────────────────┘  └──────────────────────┘  └──────────────────────┘
                     ┌──────────────────────────────────────┐
                     │  POST-EVENT ARCHIVE (take-home)       │
                     │  DT-style lenses + Ontography         │
                     │  handshake + verified worldviews      │
                     └──────────────────────────────────────┘
```

**Design choices that differ from the existing repos:**

- **2D on stage, 3D for the archive.** The Ontography 3D force graph works for exploring alone. On a projector, viewed live from 15 meters, rotating 3D can't be read. The stage uses a fixed 2D layout:
  - **Horizontal:** speaker A's territory | shared ground | speaker B's territory
  - **Vertical:** roots (assumptions) at the bottom, surface claims in the middle, **higher ground** (synthesis) at the top

  This carries forward DT's Epistemological Tree metaphor of roots, trunk, and canopy, and it shows the Anti-Debate's "common ground → higher ground" arc as literal space.
- **"Elements arrive, don't animate"** (Open Field doctrine). Nodes fade in and never jump. The layout is pinned: once a node is placed, it stays. Merges pulse gently and don't reflow the graph.
- **Two display modes, chosen by the facilitator:**
  - *Ambient:* the map updates continuously.
  - *Reveal:* the map updates only when the facilitator presses "reveal", for example at the end of each round.

  I'd recommend **Reveal** as the default for the first event. The humans on stage should stay the show, with the map adding a moment between rounds. This question matters more than any technical one, and Stephanie should decide it.

---

## 3. Input: getting clean, speaker-labeled text

Everything downstream consumes one event type, so every input method is interchangeable:

```ts
type Utterance = {
  sessionId: string;
  speakerKey: string;      // 'A' | 'B' | 'moderator' | 'audience' | 'unknown'
  speakerConfidence: number; // 0..1 from diarization fusion (§3.4)
  speakerSignals: { channel?: string; diarLabel?: string; voiceprintMatch?: string; zoomParticipant?: string };
  overlapsWith?: string[]; // ids of utterances spoken at the same time
  text: string;
  startMs: number; endMs: number;
  final: boolean;          // partials drive captions; finals drive analysis
  source: 'local-parakeet' | 'cloud-parakeet' | 'hosted-asr' | 'zoom' | 'manual' | 'replay';
};
```

### 3.1 Input modes

| Scenario | Audio path | Where speaker identity starts | Recommendation |
|---|---|---|---|
| **In person** | Each speaker on their own mic → audio interface (e.g., a 2–4 channel USB interface, or a feed from the venue's mixer) → operator laptop | **Strong hint from the channel** (mic 1 is probably A), which diarization then confirms. See §3.4. | ✅ **Best option.** The most accurate signal we can get. |
| **Zoom** | Per-participant audio streams through a meeting-bot API (e.g., Recall.ai) or Zoom's Realtime Media Streams (RTMS) API | **Strong hint from the participant stream**, which diarization then confirms | ✅ Use per-participant streams. RTMS needs a Zoom developer app. A bot service is quicker to set up but paid per hour. Either way, confirm it works on her account ahead of time. |
| **Hybrid / livestream** (StreamYard, YouTube, single mixed feed) | Mixed audio → laptop | **Diarization plus enrolled voiceprints only** | ⚠️ Works, but has the least margin. The operator should expect to fix more labels. |
| **Anything breaks** | Operator types or pastes | Operator | Manual fallback, always available |
| **Development / rehearsal** | A recorded debate played back in real time | The existing transcript, or diarization run on the recording | See §7. This is how we build and tune without a live event. |

In every scenario, **speaker identity comes from the diarization layer in §3.4.** Channels and Zoom streams feed it strong hints. They never replace it.

### 3.2 Where Parakeet runs

You're right that Meetily's local speed comes from NVIDIA's Parakeet models. But Meetily is a finished desktop note-taker (Tauri/Rust). It isn't built to stream text into another app. Forking it is more work than we need. We only need Meetily's engine, and that engine is available on its own:

| Option | How | Pros | Cons |
|---|---|---|---|
| **A. Local on the operator's Mac** ⭐ | A small **capture agent**, ideally in Swift on [FluidAudio](https://github.com/FluidInference/FluidAudio) (Parakeet, voice-activity detection, Sortformer diarization, and speaker embeddings on the Neural Engine). Fallbacks: Python + [`parakeet-mlx`], or Rust + [`parakeet-rs`](https://github.com/altunenes/parakeet-rs). It reads each mic channel, runs the speaker pipeline in §3.4, transcribes each utterance, and POSTs `Utterance` events to the app. | Free, private, fast (sub-second per utterance on an M-series chip), and **no audio leaves the room**. Venue Wi-Fi only carries small text payloads. | Needs a decent Mac at the venue. We own a small piece of software. |
| **B. Cloud GPU** | Parakeet streaming + Sortformer diarization on a serverless GPU. [Modal's reference project](https://github.com/modal-projects/modal-nvidia-asr) already does this over WebSocket. | Works for Zoom or remote setups with no strong local machine. Diarization is built in. | Cold starts, costs a small amount per GPU-hour, depends on the network. |
| **C. Hosted streaming ASR** (Deepgram, AssemblyAI, etc.) | WebSocket straight from the capture agent | Easiest to ship, very reliable, diarization included | Not open source, audio goes to a third party, costs cents per minute |

**Recommendation:** use **A as primary and C as hot standby.** Build the capture agent so it can switch engines with one flag. Then if the local model struggles on the night, the operator changes a setting and keeps going. This fits both the local-first values and the need for a live show that doesn't fail.

### 3.3 Speaker attribution is load-bearing

Every feature downstream depends on knowing **who** said something: territories, cross-speaker alignment, cruxes, the steelman check, and each person's worldview. A misattributed claim doesn't just look wrong. It puts one debater's words in the other's territory, on stage, in front of both of them. So speaker attribution is a subsystem of its own, not a side effect of how the audio was recorded. See §3.4.

### 3.4 Speaker diarization: always on, whatever the input

**Why separate mics or Zoom streams alone aren't enough:**

- **Mic bleed.** A's voice is picked up faintly on B's mic. Without handling, the same sentence gets transcribed twice, once under each name.
- **Crosstalk and interruptions.** Both people talk at once. Anti-Debates should have fewer interruptions than normal debates, but "yes, and—" overlaps still happen.
- **More voices than mics.** The moderator, audience Q&A on a shared handheld mic, or a third panelist.
- **Shared devices on Zoom.** Two people in one room on one laptop share one Zoom stream.
- **Mixed-only feeds.** A livestream or venue recording gives us one channel with everyone in it.

**The design: five signals fused into one decision, with a human as the final check.**

```
 per-channel audio ──▶ ① CHANNEL GATE ─────────┐   who is loudest, and by how much
                        (energy comparison)      │   bleed = same speech, >~6 dB quieter elsewhere
                                                 ▼
 mixed / per-channel ─▶ ② STREAMING DIARIZER ──▶ ④ FUSION ──▶ Utterance{speakerKey, confidence}
                        (who-spoke-when,         ▲    │           │
                         overlap-aware)          │    │           ├─ confidence high ─▶ pipeline
 sound-check samples ─▶ ③ VOICEPRINT MATCH ─────┘    │           └─ confidence low ──▶ console
                        (enrolled speaker             │                "who said this?" [1][2][M][Aud]
                         embeddings)                  ▼
                                                ⑤ OPERATOR (hotkeys 1/2/M/A, relabel any line)
                                                      │
                                                      ▼
                        utterance.relabeled event ─▶ derived claims move territory, stage updates gently
```

1. **Channel gate** (when there are separate channels). If speech is detected on several channels at once, the channel that's louder by a clear margin owns the segment and the quieter copies are dropped as bleed. If two channels are both loud, that's real overlap, and both are kept as separate, overlapping utterances. This is cheap signal processing and fixes most in-person problems before any model runs.
2. **Streaming diarizer.** An overlap-aware neural model answers "who spoke when" on the audio. Candidates:
   - [Streaming Sortformer](https://huggingface.co/nvidia/diar_streaming_sortformer_4spk-v2) from NVIDIA, the same family as Parakeet. It handles up to 4 speakers.
   - [diart](https://pypi.org/project/diart/0.1/), open-source streaming diarization built on pyannote.
   - pyannoteAI's hosted [Live-1](https://www.pyannote.ai/blog/introducing-live-1-streaming-diarization).
   - Hosted ASR providers' built-in diarization.
3. **Voiceprint enrollment.** Diarizers only produce anonymous labels ("speaker 0", "speaker 1"). To get *names*, we record about 30 seconds of each person at **sound check**, which the event already has, and store a speaker embedding (TitaNet, pyannote, or FluidAudio embeddings). Each diarized segment is matched to the closest enrolled voice. Voices that match no one become **"Audience / other"**. Their words show as questions in the console but never land in a debater's territory. This also covers the 4-speaker limit: however many audience members speak, they share one bucket.
4. **Fusion.** Combines the channel or Zoom hint, the diarizer label, and the voiceprint match into one `speakerKey` plus a **confidence** score. When the signals agree, the utterance goes straight through. When they disagree, or confidence is low, it's flagged.
5. **Operator correction, the final check.** Flagged lines appear in the console with one-key assignment (`1` = A, `2` = B, `M` = moderator, `A` = audience). The operator can also relabel any line at any time. Because everything is an append-only event log, a relabel emits `utterance.relabeled`, and every claim derived from that line moves to the correct territory. Claims waiting for approval can also be **held until their speaker is confirmed**. This hold is on by default for low-confidence lines.

**Two more safeguards:**

- **Text-level sanity check.** The claim pass (T1) gets one extra instruction: flag, but never silently fix, likely misattribution. For example, a line addressing A by name inside A's own turn, or "as you said" pointing at the speaker's own earlier claim. These are hints to the operator, not decisions.
- **Offline re-diarization for the archive.** After the event, the full recording is diarized again with the best non-streaming model, which is noticeably more accurate than streaming. The operator's live corrections are kept as ground truth. The archive's attribution should end up close to perfect.

**Where it runs.** The strongest local candidate is [FluidAudio](https://github.com/FluidInference/FluidAudio), an open-source Swift SDK for Apple Silicon. It already bundles **Parakeet** (batch and streaming), **Silero voice-activity detection**, **Streaming Sortformer diarization with overlap handling**, and **speaker embeddings**, all running on the Mac's Neural Engine. That's essentially the whole of §3.2 plus this section in one local library. It's a better base for the capture agent than a Python stack, and it's what Meetily-class apps are built from. The Python route (Parakeet + diart/pyannote) is the fallback. Hosted providers remain the standby.

**How we choose: a diarization bake-off (build phase 1b, §9).** Take 2–3 real recordings, ideally Stephanie's past Anti-Debates plus one messy, mixed-audio recording. Hand-label who spoke when for about 10 minutes of each. Then score each candidate on:
- **Diarization error rate**, and in particular **debater-swap errors** (A's words credited to B), the only error that is truly dangerous on stage
- time from speech to a confirmed label
- how often the operator gets flagged, which measures operator workload

The target is effectively zero A↔B swaps reaching the stage without a flag. Some "unsure" flags are fine, because the operator catches them.

### 3.5 Latency is a pipeline question, not an ASR question

Parakeet finishes an utterance in well under a second. Speed is limited by *meaning*: a claim only exists once a thought is complete. So the pipeline works on **finished turns** (or rolling windows of about 20–40 seconds during long monologues), not on words.

| Layer | Target lag behind speech | Notes |
|---|---|---|
| Captions (partials) | < 1 s | Console only by default |
| Speaker label (confident) | ~1–2 s | Diarization needs a moment of context; low-confidence lines wait for the operator |
| Claims appear in console | 3–8 s after a turn or window ends | Fast model |
| Claims on stage (after approval) | 5–15 s | Or at "reveal" |
| Assumptions, cross-speaker alignment, drift | 30–90 s | Rolling passes |
| Cruxes, synthesis / higher-ground candidates | At round boundaries or on demand | Slower, more deliberate model |

This is fast enough. The Anti-Debate's rounds give natural pauses where the heavier analysis can land.

---

## 4. The live analysis pipeline

Much of this can reuse Ontography's prompts: the extractor, alignment judge, dimensions, synthesis, and nudge prompts. What's new is making it **incremental**: each call sees the graph so far and returns a *diff*, not a fresh map.

```
 Utterance(final) ─▶ [turn buffer] ─▶ T1 CLAIM PASS ──▶ claim queue ──▶ (approve) ──▶ stage
                                        │ fast model, per turn/window
                                        │ in: new text + compact graph so far
                                        │ out: new claims, refinements of existing
                                        │      claims, edges to existing claims
                                        ▼
                                   embeddings → dedupe (cosine > ~0.9 ⇒ propose merge)
                                        │
            every ~60–90 s ────────▶ T2 STRUCTURE PASS
                                        │ • assumption descent ("what must be true for this to hold?")
                                        │ • cross-speaker alignment: equivalent / resonant / divergent / drift
                                        │   (reuses alignment-judge + pgvector candidates)
                                        │ • dimension positions nudged (reuses dimensions prompt)
                                        ▼
       round boundary / button ─────▶ T3 INSIGHT PASS
                                        │ • CRUX: the divergence most other disagreements hang on
                                        │   (graph: divergent pair with the most downstream `grounds`)
                                        │ • HIGHER-GROUND candidates: claims both could stand behind
                                        │ • STEELMAN CHECK (during steelman rounds)
                                        │ • FACILITATOR PROMPTS: questions, never verdicts
                                        ▼
                                   insight cards ──▶ console (always gated) ──▶ stage
```

### 4.1 Claim pass (T1): the workhorse

- **Input:** the new turn text, the speaker, the current phase, and a compact list of the existing claims (id, speaker, one line each). The graph-so-far is a stable prefix, so **prompt caching** keeps this cheap.
- **Output (diff):**
  - `newClaims[]`, each with a verbatim span pointer so every node links to the exact words said
  - `refines[]`: "this sharpens claim C7"
  - `edges[]`: `builds_on | challenges | agrees | reframes | concedes`, pointing at existing ids
- **The key rule: always quote-anchored.** Every claim carries the utterance span it came from. On stage or in the archive, tapping a claim shows what the person actually said. This is the main protection against putting words in someone's mouth.

### 4.2 The Anti-Debate features

1. **Semantic drift alerts.** The existing `drift` verdict ("same word, different meaning") is the single most useful live signal for a facilitator. It shows up as a console card: *"'Freedom': A seems to mean freedom from interference; B seems to mean the capacity to flourish. Worth naming?"*
2. **Crux detection.** A graph computation over the divergent alignments, not just an LLM guess. It answers "if this one disagreement resolved, how many others would too?" The existing `graph/analytics.ts` already has the building blocks (merged graph, shortest paths, deepest shared assumption).
3. **Steelman check.** When the phase is `steelman`, A's turn is checked against **B's claims**, not added to A's territory. Output: which of B's claims A captured, what A missed, and anything A added that B never said. Shown as overlay coverage, **not a score**. The best version asks B to confirm, which reuses Ontography's verification loop live: *"B, is this you?"* Stephanie might like that as a format moment.
4. **Higher-ground nodes.** Synthesis candidates generated under the existing **synthesis doctrine**, inherited from DT: *never force false synthesis*, separate domain and time-frame confusions, and name the disagreements that can't be reduced. Each higher-ground node draws lines down to the claims on *both* sides it integrates.
5. **Facilitator prompts.** These reuse the `nudge` doctrine, which already says: *silence is the default; questions, not verdicts; illuminate the gap, not the people.* Only Stephanie sees them. Example: *"Ask B what would have to be true for A's claim about X to hold."*

### 4.3 Worldview under the claims

Each debater becomes an Ontography **worldview** (kind `live`). The assumptions found during the debate live on the same four layers as everything else in this repo (ontology, epistemology, axiology, praxis). So we get:

- **Before the event (optional, strongly recommended):** use the existing **ingestion workflow** to fingerprint each debater from their public writing and talks. The live map starts with a faint "prior" of each person's likely roots. Live claims light up and attach to those roots, which makes deeper structure appear much faster. Everything prior stays clearly marked `inferred`.
- **After the event:** a full handshake between the two live worldviews, including dimension comparison and synthesis report, with no extra work. Each debater can then do the verification interview to confirm or correct what the system inferred about them.

---

## 5. Keeping it trustworthy on stage

Putting machine interpretations of real people on a screen, in front of those people and an audience, is the biggest risk here. It's also where Ontography's existing ethics carry over most directly:

- **Human in the loop by default.** Claims go to the console queue first. The operator can approve, merge, edit, or reject. An **auto-approve after N seconds** toggle is available once the operator trusts it. Insight cards (cruxes, drift, synthesis) are **always** gated.
- **Epistemic status is visible.** Quote-anchored claims are solid. Inferred assumptions are translucent and labeled "possible root". Synthesis is violet and labeled "candidate". Nothing inferred is presented as fact.
- **Right of correction.** Debaters can say "that's not what I meant" and the operator fixes it live. Afterwards, the verification interview lets each debater confirm or correct their worldview before the archive is published.
- **Consent.** Both debaters agree in advance to live mapping and to publication of the archive.
- **No scoring.** No winner, no "steelman score", no leaderboard. The Anti-Debate exists to get away from that.

---

## 6. Architecture and hosting

**Recommendation: build this as a `live` module inside Ontography**, not as a new app. The schema, prompt conventions, AI Gateway wiring, Neon + pgvector, auth, and worldview/handshake machinery are already here. The capture agent is the only separate piece of software.

```
 VENUE / ZOOM                           CLOUD (existing Ontography stack)
┌───────────────────────┐   HTTPS    ┌──────────────────────────────────────────────┐
│ Capture agent         │  Utterance │ Next.js 16 on Vercel                          │
│ (operator's Mac)      │───────────▶│  /api/live/[id]/utterances  (ingest, auth'd)  │
│ • mic channels / Zoom │            │  /api/live/[id]/stream      (SSE to clients)  │
│ • VAD + Parakeet      │            │  pipeline runners T1/T2/T3 (AI Gateway)       │
│ • diarization fusion  │            │                                               │
│   + voiceprints §3.4  │            │                                               │
│ • fallback: hosted ASR│            │ Neon Postgres + pgvector                      │
└───────────────────────┘            │  append-only live_events log = source of truth│
                                     └──────────────┬────────────────────────────────┘
                                                    │ SSE (console, stage)
                                                    │ CDN-cached snapshot, ~2 s poll (audience)
                              ┌─────────────────────┼─────────────────────┐
                           Console               Stage                Audience
```

- **Real-time fan-out:** an **append-only event log** in Postgres (`claim.added`, `edge.added`, `claim.merged`, `insight.pushed`, `phase.changed`, …). Console and stage subscribe over Server-Sent Events and reconnect on drop. Audience phones poll a CDN-cached snapshot every couple of seconds, which handles a few hundred phones without effort. A managed pub/sub (Ably, PartyKit, etc.) is an easy upgrade if we outgrow this.
- **Replayability for free:** since the event log is the source of truth, any session can be replayed. That supports rehearsal, post-event scrubbing ("show me the map at minute 42"), and debugging.
- **Models:** the existing `MODELS` map. `fast` (Haiku 4.5) for the claim pass; `extractor`/`judge` (Sonnet 5) for structure and insight passes; optionally a stronger model for the end-of-round synthesis. Everything stays behind the gateway with versioned prompts and logged calls (NFR-1).
- **Cost:** a 90-minute debate is roughly 15–20k words. With per-turn calls on a cached graph prefix, I'd expect **single-digit to low-double-digit dollars of LLM spend per event**. We'll measure it properly during replay testing (§7).
- **Venue resilience:** local ASR means only small text payloads need the network. Bring a phone hotspot as backup. If the cloud drops, the capture agent buffers utterances and flushes them when the connection returns.

### 6.1 Data model additions (sketch)

```ts
live_sessions   { id, title, topic, format jsonb /* phases[] */, displayMode: 'ambient'|'reveal',
                  status, handshakeId? /* created post-event */ }
live_speakers   { sessionId, speakerKey /* 'A','B','mod','audience' */, displayName, worldviewId?, color,
                  channel?, voiceprint vector /* enrolled at sound check */ }
live_utterances { id, sessionId, speakerKey, speakerConfidence, speakerSignals jsonb, speakerConfirmedBy?,
                  overlapsWith uuid[], text, startMs, endMs, phaseId, source }
live_events     { id bigserial, sessionId, type, payload jsonb, createdAt }   // append-only
live_insights   { id, sessionId, kind: 'drift'|'crux'|'higher_ground'|'steelman'|'prompt'|'road_not_taken',
                  body jsonb, nodeIds uuid[], status: 'proposed'|'pushed'|'dismissed' }
// claims/assumptions = existing `nodes` (provenance → utterance span); relations = existing `edges`;
// cross-speaker verdicts = existing `alignments`; worldviewKind gains 'live'.
```

---

## 7. The secret weapon: build against replays

We don't need a live debate to build this. **Dialectical Topology already contains a fully diarized, timestamped two-person debate** (`data/bundle/transcript_diarized.json`, the Marcus × Demartini conversation, 270 segments, about 105 minutes). A replay source feeds it into the pipeline at real speed, or 4× speed, as if it were live. We also have DT's hand-made analysis (claims, flow, inflection points, cruxes) as a **reference answer** to compare against the live pipeline's output.

Then, with Stephanie's permission, we replay **recordings of her past Anti-Debates** to tune for her format specifically: phase detection, steelman checks, higher-ground moments.

This gives us:
- a repeatable test harness for prompt iteration (each prompt version scored against the same replay)
- real latency and cost numbers before any live event
- a demo for Stephanie in week 1, well before the live pipeline is finished

---

## 8. The take-home archive

After the event, run one **batch re-analysis** over the full transcript with the heavier model and no time pressure. Live output is necessarily rough, and this pass cleans it up. It produces:

1. **A Dialectical Topology explorer for the debate.** DT's frontend reads a static JSON bundle (`manifest`, `claims`, `flow`, `ontology`, `tree`, `dialogue`, `landscape`). The session can **export in exactly that format**, and each Anti-Debate gets its own explorer with every lens: Claim Atlas, Dialectical Flow with inflection points and "road not taken", Epistemological Tree, Worldview Map, Steel-Man Arena, and Meta-Analysis. DT's hand-built pipeline becomes a repeatable output.
2. **An Ontography handshake** between the two debaters' worldviews, which they can verify and keep exploring.
3. **Timecode links** to the event video throughout, carried over from DT.

This is also the thing Synthesis Media could publish alongside the recording.

---

## 9. Build plan

Timing depends on the event date (open question). Here's a focused path, with each phase producing something Stephanie can react to:

| Phase | Deliverable | Rough effort |
|---|---|---|
| **0. Discovery** | 45-minute call with Stephanie using §10's questions. Pick the input scenario and display mode. | 1 call |
| **1. Replay harness + claim pass** | Replay source from the DT transcript; T1 incremental claim extraction; append-only event log; a bare console that shows claims arriving. | ~1 week |
| **2. Stage display** | 2D territories / shared ground / higher ground layout; pinned placement; Reveal and Ambient modes; Open Field styling. **→ Demo to Stephanie on the replay.** | ~1 week |
| **3. Structure + insight passes** | Assumption descent, cross-speaker alignment, drift cards, crux detection, steelman check, higher-ground candidates, facilitator prompts; phase control. | ~1–1.5 weeks |
| **1b. Diarization bake-off** | Hand-label ~10 minutes each of 2–3 real recordings; score FluidAudio/Sortformer, diart/pyannote, and a hosted provider on A↔B swap errors, label latency, and operator flag rate (§3.4). Pick the stack. | ~3–4 days (parallel with 1) |
| **4. Capture agent** | Local capture on the chosen stack: multi-channel input, channel gate, streaming diarization, sound-check voiceprint enrollment, confidence fusion; hosted fallback; Zoom path if needed; buffering for offline stretches. Console: speaker hotkeys and relabeling. | ~1–1.5 weeks (can run in parallel with 2–3) |
| **5. Archive export** | Batch re-analysis → DT bundle export → Ontography handshake. | ~3–5 days |
| **6. Dress rehearsal** | Full run with two real people, real mics, and the real room or Zoom setup; operator training; failure drills (kill Wi-Fi, switch ASR engine). | 1–2 sessions |

**Minimum viable version for a near-term date:** phases 1, 1b, 2, and 4, plus drift cards from phase 3, with the operator gating everything and Reveal mode. That's already a strong live experience. Cruxes, steelman check, and the archive can come in a second iteration.

---

## 10. Questions for Stephanie

**Format**
1. What are the exact rounds, and roughly how long is each? Is there a moderator? Judges? Audience participation?
2. Is there a steelman round where each person restates the other? (That determines whether the steelman check is a headline feature.)
3. How many speakers: always two, or sometimes more?

**Room and medium**
4. In person, Zoom, or hybrid? Is it livestreamed? What's the venue's AV like (separate mics, a mixer we can tap, a projector)?
5. Roughly how big is the audience, and would they have phones out?
6. Will anyone besides the two debaters speak (moderator, audience Q&A, a third panelist)? Can we do a 30-second voice sample per speaker at sound check?

**The role of the map**
7. **Should the map be visible to the audience live, only between rounds, or only to her as the facilitator?** This is the most important design decision.
8. Should the debaters see it while they're speaking? (Some people will find it grounding, others distracting.)
9. Does she want the facilitator prompt cards, or would she rather the tool stay silent during the event?

**Afterwards**
10. Would she want a published explorer per debate? Can we use recordings of past Anti-Debates to tune the system?
11. Consent and correction: are debaters comfortable being mapped live, and do they want to review before anything is published?

---

## 11. Risks and mitigations

| Risk | Mitigation |
|---|---|
| AI misrepresents a debater on stage | Quote-anchored claims, operator gate, visible epistemic status, live correction, post-event verification |
| Map pulls attention from the humans | Reveal mode default, calm motion, one insight card at a time |
| Map becomes unreadable clutter by minute 60 | Dedupe/merge on insert; collapse settled sub-threads; stage shows only the current phase's claims plus the persistent roots and higher ground |
| Speaker misattribution | Always-on diarization layer (§3.4): channel gate, streaming diarizer, sound-check voiceprints, confidence fusion; low-confidence lines held for the operator; hotkey relabeling that moves derived claims; offline re-diarization for the archive |
| Venue network fails | Local ASR, utterance buffering, phone hotspot |
| Latency feels sluggish | Show captions instantly in console; pipeline tuned on replays; heavy passes timed to round breaks |
| False synthesis ("you actually agree!") | The synthesis doctrine inherited from DT, in the prompt; higher-ground nodes labeled "candidate"; gated |

---

## 12. What we reuse (inventory)

| Asset | From | Used for |
|---|---|---|
| Claim / warrant / evidence schema | DT → Ontography `nodes` | Live claims |
| Extractor, alignment-judge, dimensions, synthesis, nudge prompts | `src/lib/prompts/` | T1–T3 passes (made incremental) |
| pgvector candidate matching + LLM adjudication | `src/lib/handshake.ts` | Live cross-speaker alignment |
| Merged-graph analytics | `src/lib/graph/analytics.ts` | Crux detection, shortest path between positions |
| Ingestion workflow | `src/workflows/ingest-source.ts` | Pre-event fingerprints, post-event batch re-analysis |
| Verification loop | `src/components/interview/VerificationPanel.tsx` | Steelman confirmation, post-event debater review |
| Diarized debate transcript + reference analysis | DT `data/bundle/` | Replay harness and evaluation baseline |
| Lens explorer frontend | DT `frontend/` | Post-event archive |
| Open Field design system | DT → Ontography | Stage display |
| Chat SDK Telegram agent | `src/lib/bot.ts` | (Later) post-event discussion group with the map as context |

---

*Prepared by Benjamin Life (@omniharmonic).*

[`parakeet-mlx`]: https://github.com/senstella/parakeet-mlx
