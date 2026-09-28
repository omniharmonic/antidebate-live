# Topology Live — Reuse Audit & New Repo Layout

**Author:** Benjamin Life (@omniharmonic) · **Version:** 1.0 · **Date:** 2026-09-28

Verdicts:
- **Copy**: bring the file across and adapt lightly.
- **Port**: rewrite in the new structure, keeping the substance.
- **Reference**: read for lessons; don't copy.
- **Leave**: not used.

---

## 1. From Ontography (`omniharmonic/auto-ontography-archive`, Next.js 16)

| Asset | Path | Verdict | Becomes |
|---|---|---|---|
| Extraction schema (claims/assumptions/concepts/edges, warrants, evidence, `quote`, `stated`) | `src/lib/prompts/extractor.ts` | **Port** | `packages/ontology` schemas + the L1 prompt. It gains speech acts, stances, modality/scope, strata and span offsets. The `quote` + `stated` discipline carries straight over. |
| Alignment judge (`equivalent / resonant / divergent / drift`) | `src/lib/prompts/alignment-judge.ts` | **Port** | The L3 identity-resolution and relation adjudication prompts; `drift` becomes concept-sense drift |
| Synthesis doctrine & structure (commonGround, domainDistinctions, semanticDrift, genuineDivergences, practicalPaths) | `src/lib/prompts/synthesis.ts` | **Port** | The L4 higher-ground prompt; its sections map onto the construction types in ONTOLOGY §4.4 |
| Nudge doctrine ("silence is the default; questions, not verdicts") | `src/lib/prompts/nudge.ts` | **Port** | The facilitator-prompt policy (L4) |
| Interviewer protocol (assumption descent: "what would have to be true…") | `src/lib/prompts/interviewer.ts` | **Reference** | The presupposition necessity test and prompt phrasing |
| Graph analytics (merged graph, shortest path, deepest shared assumption, category convergence) | `src/lib/graph/analytics.ts` | **Copy** | `packages/graph`, extended with crux dependency scoring |
| Four strata (ontology / epistemology / axiology / praxis) | `src/lib/protocol/categories.ts` | **Copy** | Strata enum (plus `empirical`) |
| 8 core dimensions + dimensions prompt | `src/lib/protocol/dimensions.ts`, `prompts/dimensions.ts` | **Port (R3)** | The Worldview Fingerprints lens |
| Model map pattern; LLM call logging | `src/lib/ai/models.ts`, `src/lib/ai/log.ts` | **Port** | `packages/llm`, with cache-token and effort fields added. The SDK changes from the AI Gateway to `@anthropic-ai/sdk` (ARCHITECTURE §3.2). |
| Drizzle + Neon setup | `src/lib/db/*`, `drizzle.config.ts` | **Copy (pattern)** | `packages/db` |
| Ingestion workflow (chunk → extract → merge → descend) | `src/workflows/ingest-source.ts` | **Reference** | The participant-priors job (R3) and the canonical-pass batching |
| Chunking | `src/lib/chunking.ts` | **Reference** | The turn buffer uses speaker turns rather than character chunks |
| Verification panel (confirm / amend / reject) | `src/components/interview/VerificationPanel.tsx` | **Port (R2)** | Participant review UI |
| 3D force graph components | `src/components/graph/*`, `handshake/HandshakeGraph3D.tsx` | **Reference** | Encodings and interaction ideas. The new topology uses a deterministic R3F layout instead of a force layout. |
| Open Field tokens (Tailwind v4) | `src/app/globals.css` | **Copy** | `packages/ui/tokens.css` + the stage dark variant |
| Next.js 16 guidance | `AGENTS.md` | **Copy** | Root `AGENTS.md` in the new repo |
| Auth (Neon Auth), Telegram bot, constellations, celestial, reflection, interview room | various | **Leave** | Not in scope |

## 2. From Dialectical Topology (`omniharmonic/dialecticaltopology`)

| Asset | Path | Verdict | Becomes |
|---|---|---|---|
| Diarized, timestamped debate transcript (270 segments, 105 min) | `data/bundle/transcript_diarized.json` | **Copy** | `fixtures/dt/` — the first replay input (G1) |
| Hand analysis: claims, flow (phases, inflection points, roads not taken, missed synthesis), ontology dimensions, tree (synthesis nodes, semantic drift, framework boundaries) | `data/bundle/*.json`, `frontend/public/data/tree.json` | **Copy** | `fixtures/dt/reference/` — the secondary evaluation reference; its schemas inform flow and drift outputs |
| Steel-man and synthesis prompts | `pipeline/generate_dialogue.py` (L213–287) | **Port** | The steelman-check rubric and the synthesis doctrine text |
| Speaker-aware chunking lessons (v2: larger, conversational units) | `pipeline/create_chunks_v2.py` | **Reference** | Turn-window sizing in L0 |
| Otter parser | `pipeline/parse_transcript.py` | **Leave** | Replaced by the capture and offline paths |
| Claim-anchored clustering; UMAP landscape | `pipeline/cluster_by_claims.py`, `project_umap.py` | **Reference (R3)** | The semantic layout option for the 3D topology |
| Lens components: ClaimAtlas, DialecticalFlow, EpistemologicalTree, WorldviewMap, SteelManArena, SemanticLandscape (Next 14, R3F, d3; ~4.8k lines) | `frontend/src/components/lenses/*` | **Reference → Port selectively (R2)** | Flow and Tree lenses in playback. Two useful stopgaps: exporting a DT-compatible bundle lets the old frontend render any event while the new lenses are built; and the timecode link component is worth copying. |
| Open Field design docs, fonts | `docs/plans/2026-02-23-open-field-*`, `frontend/src/styles/*` | **Copy** | Design system source of truth |
| Wiki generator, OPAL, embeddings `.npy` | `pipeline/generate_wiki.py`, etc. | **Leave** | |

## 3. Built fresh

- **Capture service** (Python): multichannel recording, VAD, channel gate, Parakeet, voiceprints, fusion, offline path, local queue.
- **Ontology package**: schemas for every entity in ONTOLOGY.md, plus validators.
- **Pipeline passes L0–L4 + canonical**, with prompts written for the new ontology. Only the doctrines are ported; the prompts are new because the schema is richer.
- **Event log, projections, snapshots**: the playback backbone.
- **Real-time layer** with server-side audience filtering.
- **Operator console, facilitator cockpit, stage and overlay outputs, the dial.**
- **Topology 3D** (deterministic stratified layout, fault planes, cinematic mode).
- **Playback explorer** and new lenses (Positions Matrix, Crux Tree, Questions / Updates / Credences ledgers).
- **Evaluation harness**, gold sets, annotation mode.
- **Setup flow**, runbook, emergency tooling.

## 4. New repo layout

Repo: `omniharmonic/antidebate-live` (created 2026-09-28). This layout is implemented in the initial scaffold.

```
antidebate-live/
├─ AGENTS.md                  # Next.js 16 guidance + repo conventions (from Ontography)
├─ docs/                      # this documentation set, moved in as-is
├─ apps/
│  ├─ web/                    # Next.js 16: /console /cockpit /stage /overlay /p /play /setup + /api
│  └─ worker/                 # Node: live pipeline runner, replay feeder, canonical pass CLI
├─ packages/
│  ├─ ontology/               # Zod schemas, enums, validators (ONTOLOGY.md in code)
│  ├─ core/                   # event types, projections (pure reducers), snapshots
│  ├─ pipeline/               # passes L0–L4, canonical, prompt modules (versioned)
│  ├─ graph/                  # crux ranking, paths, commitment-store logic (from Ontography analytics)
│  ├─ llm/                    # Anthropic SDK wrapper, caching layout, llm_calls logging
│  ├─ db/                     # Drizzle schema + migrations (Neon)
│  ├─ ui/                     # Open Field tokens, stage theme, shared components
│  └─ topology3d/             # R3F topology, 2D map, layouts
├─ services/
│  └─ capture/                # Python (uv): live capture + offline transcription/diarization
├─ fixtures/
│  ├─ dt/                     # Marcus × Demartini transcript + reference analysis
│  └─ antidebate/             # downloaded replays (gitignored media; manifests committed)
├─ evals/                     # gold sets (event logs), scoring, results.md
└─ tools/                     # setup scripts, device pairing, runbook printouts
```

**Tooling:** pnpm workspaces + Turborepo; TypeScript strict; Vitest for projections, validators and graph; Playwright for surface smoke tests (Chromium); `uv` for Python. CI runs unit tests, and a fixture replay on every PR asserts that projections are deterministic.

## 5. What happens to the old repos
- **Ontography** keeps its role (personal worldview mapping and handshakes). Topology Live's participant priors and Worldview Fingerprints lens call Ontography's ingestion concepts; they don't share a database.
- **Dialectical Topology** stays as the public proof of concept. Its bundle format becomes an export target, so every Topology Live event can also render in the original explorer.
