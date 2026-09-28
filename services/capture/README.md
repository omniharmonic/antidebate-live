# services/capture

Python service for live multichannel capture and speaker attribution, plus the offline transcription path used for replays. The spec is [docs/ARCHITECTURE.md §2](../../docs/ARCHITECTURE.md).

| Module | Status |
|---|---|
| `gate.py`: bleed suppression and overlap | ✅ implemented + tested |
| `fusion.py`: attribution confidence | ✅ heuristic + tested; tune on the G5 gold set |
| `merge.py`: ASR words + diarization turns → utterances | ✅ implemented + tested |
| `emit.py`: durable spool + POST to `/api/events` | ✅ implemented (untested against the server) |
| `offline.py`: Parakeet (MLX) + pyannote for replays | ⚠️ written; **run it on a Mac**. Verify the parakeet-mlx result fields against the installed version. |
| `live.py`: the live loop | ⛔ not built (WS1) |

```bash
cd services/capture
uv sync                          # core + dev
uv run pytest                    # tests
uv sync --extra mac --extra diarize   # on an Apple Silicon Mac, for replays
HF_TOKEN=… uv run python -m adl_capture.offline ../../fixtures/antidebate/ball-kokotajlo-ai-governance
```
