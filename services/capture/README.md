# services/capture

Python service for live multichannel capture and speaker attribution, plus the offline transcription path used for replays. The spec is [docs/ARCHITECTURE.md §2](../../docs/ARCHITECTURE.md).

| Module | Status |
|---|---|
| `gate.py`: bleed suppression and overlap | ✅ implemented + tested |
| `fusion.py`: attribution confidence | ✅ heuristic + tested; tune on the G5 gold set |
| `merge.py`: ASR words + diarization turns → utterances | ✅ implemented + tested |
| `emit.py`: durable spool + POST to `/api/events` | ✅ implemented (untested against the server) |
| `offline.py`: FluidAudio (Parakeet TDT v3 + pyannote community-1 as CoreML) for replays | ✅ run on Dean × Daniel (86 min: ASR 17 s, diarization 32 s on Apple Silicon); parsers tested |
| `live.py`: the live loop | ⛔ not built (WS1) |

```bash
cd services/capture
uv sync                          # core + dev
uv run pytest                    # tests
# replays (Apple Silicon): builds FluidAudio's CLI into .cache/ on first use; no Hugging Face token
uv run python -m adl_capture.offline ../../fixtures/antidebate/ball-kokotajlo-ai-governance   # --rerun to regenerate
```
