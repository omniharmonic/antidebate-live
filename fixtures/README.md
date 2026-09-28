# Fixtures

| Folder | What | Committed? |
|---|---|---|
| `dt/transcript_diarized.json` | Marcus × Demartini debate (Aubrey Marcus Podcast #521), 270 speaker-labeled segments, 105 min, from Dialectical Topology | yes |
| `dt/reference/*.json` | DT's hand analysis (claims, flow, ontology dimensions, tree, dialogue, manifest). Secondary evaluation reference (G1). | yes |
| `antidebate/<slug>/manifest.json` | Metadata for each prior Anti-Debate replay | yes |
| `antidebate/<slug>/audio.*`, `transcript.*` | Downloaded media and offline transcripts | **no** (gitignored); fetch with `tools/fetch-replays.sh` |

Any transcript becomes pipeline input as `utterance.final` events. See `apps/worker/src/replay.ts`.
