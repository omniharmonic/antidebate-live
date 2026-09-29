# Browser-only ASR, diarization and BYO-key analysis (research, 2026-09-29)

Question: can a browser-only build transcribe live (under ~5 s per utterance) and uploaded recordings (60–150 min) on the host's laptop, with word timestamps and speaker attribution, with the host supplying only an Anthropic key? What do the hosted fallbacks cost, and how should the Anthropic key be handled?

Confidence labels: **H** means confirmed from a primary source in this pass. **M** means from a secondary source, or inferred from primary sources. **L** means my estimate, to be measured. "Stale" marks data older than about 12 months.

---

## 1. In-browser ASR

### Candidates

| Model / runtime | Params · download | English WER (Open ASR avg) | Word timestamps | Streaming | Browser path |
|---|---|---|---|---|---|
| **Parakeet TDT 0.6B v3** (NVIDIA, CC-BY-4.0) | 0.6B · int8 encoder ~900 MB, w4a8 ~650 MB, int4/int8 hybrid ~409 MB, fp16 ~1.2 GB | **6.34%** (H, model card). v2 is English-only and slightly better (~6.05%, M) | **Yes**: word, segment and char (H) | Chunked/stateful. parakeet.js ships "stateful streaming helpers" (H) | **parakeet.js** (MIT; onnxruntime-web; WebGPU encoder + WASM decoder; IndexedDB cache) (H). Also sherpa-onnx WASM (int8) and transformers.js (Parakeet listed; TDT is via community conversions, CTC landed in 3.7.6) (M) |
| **Moonshine v2** (Useful Sensors; English weights MIT) | Tiny 34M (~26 MB), Small 123M, Medium 245M | Tiny 12.0%, Small 7.84%, Medium **6.65%** (H, paper) | Line/segment start and duration only. No word timestamps documented (H) | **Native streaming**: sliding-window encoder, latency 50/148/258 ms on M3 (H) | Official runtime is native ONNX (Python/iOS/Android/desktop). **No web/JS runtime is listed** (H). transformers.js supports Moonshine v1 architecture, fixed in 4.3.0 (H). v2 in the browser is unproven |
| **Whisper large-v3-turbo** (transformers.js, whisper.cpp WASM) | 809M · q4 ~500 MB to fp16 ~1.6 GB | ~7.8% (M) | Yes in transformers.js (`return_timestamps: 'word'`, cross-attention DTW). Less precise than TDT (M) | Not natively. 30 s windows, hallucinates on silence without VAD | Mature (whisper-web, transformers.js). Known WebGPU fp16 precision issues (issue #1590) (M) |
| distil-whisper / whisper small/base | 166M–244M | 9–12% (M) | Same as Whisper | No | Fine for a low-end fallback |

### Runtime and performance facts

- **transformers.js v4** (released 2026-02-09, current 4.3.0 on 2026-09-16) has a rewritten C++ WebGPU runtime. 4.3.0 enabled WebGPU on Safari 26+ (H). The release notes have no ASR benchmarks.
- **WebGPU is not automatically faster.** A 2024 Whisper test on an M2 Mac mini (60 s of audio) ran faster on WASM (4.9–5.9 s) than on WebGPU (9.5–27 s) (H, stale, pre-v4 runtime). Parakeet shows the opposite: parakeet_web on an RTX 3090 Ti transcribed 6.5 min of audio in ~20 s on WebGPU vs ~111 s on WASM int8 (H, but high-end desktop GPU). The rule: **the GPU wins for large encoders on long chunks; WASM wins for short chunks and small models.** parakeet.js splits the work that way (GPU encoder, WASM decoder).
- **Apple Silicon (L, to measure):** Parakeet 0.6B on an M1/M2/M3 laptop GPU should run at roughly 10–30× real time on 60 s chunks. For live work, a 3–10 s utterance should finish in well under 1 s on WebGPU and in about 1–2 s on WASM int8.
- **Typical Windows laptops (L):** Intel Iris Xe or AMD iGPU WebGPU works in Chrome, but fp16 (`shader-f16`) support and drivers vary. Expect 2–5× slower than an M-series GPU, and WASM int8 at roughly 3–5× real time on a 4–8-core CPU. That's still enough for live single-utterance latency, but a 150-min upload may take 30–50 min.
- **Memory:** 32-bit WASM caps at 4 GB per module (H, V8). Memory64 exists in Chrome 133+ but is slower (H). The WebGPU buffer limit (`maxBufferSize`, often 2–4 GB) is why the fp32 Parakeet encoder is sharded into pieces under 2 GB (H, parakeet_web). **Use int8 or fp16 weights, never fp32.** Process audio in chunks (parakeet_web uses 60 s windows "chosen by measurement"). Never decode a 150-min file into one Float32Array per model call: at 16 kHz mono that array is ~576 MB, which is fine to hold but not to pass whole into the encoder.
- **Caching:** Cache API, IndexedDB and OPFS share one origin quota. Chrome gives an origin up to 60% of disk (H, MDN/web.dev). Call `navigator.storage.persist()` so model files aren't evicted under storage pressure (H). parakeet.js caches in IndexedDB. transformers.js v4 adds `ModelRegistry` cache inspection and WASM runtime caching for offline use (H).
- **Known defect:** sherpa-onnx's Parakeet v3 int8 build drops words that onnx-asr keeps (issue #2605, fix in PR #2606) (H). Test the exact build you use on a gold segment.

### Verdict

- **Live:** Parakeet TDT 0.6B (v2 for English-only, v3 for multilingual) through parakeet.js, fed **VAD-segmented utterances** (Silero VAD, ~2 MB, WASM). Emit a partial every ~1–2 s from a growing buffer, and a final at end of speech. On M-series Macs, latency from end of utterance to final should be ≈ VAD hangover (0.5–0.8 s) + inference (<1 s) (L). That's well inside 5 s. Moonshine v2 would be the ideal streaming model, but it has no word timestamps and no supported browser runtime today.
- **Uploads:** the same Parakeet model in 60 s windows with a few seconds of overlap, merging words on timestamps. WebGPU where available, WASM int8 otherwise. Run it in a Web Worker, with progress and resume from the last finished chunk (store chunk results in IndexedDB).
- **Low-end fallback:** Whisper base/small or Moonshine tiny via transformers.js, clearly marked as lower fidelity.

## 2. In-browser speaker diarization

**Available pieces:**
- **pyannote segmentation-3.0** in transformers.js (`onnx-community/pyannote-segmentation-3.0`, `post_process_speaker_diarization`). It gives frame-level activity for up to 3 speakers per 10 s window and **does not include embeddings or clustering** (H). On its own it's not a diarizer for a 90-min file.
- **sherpa-onnx WASM diarization.** A full offline pipeline: pyannote-segmentation-3.0 or reverb-diarization-v1, plus an embedding model (3D-Speaker CAM++, WeSpeaker, NeMo TitaNet), plus clustering (fast agglomerative, set by number of speakers or a threshold). A HF Space demo runs it in the browser (H). The parakeet_web project ships exactly this pair (pyannote seg + CAM++, ~28–34 MB) in a worker (H).
- **Streaming Sortformer 4-speaker v2** (NVIDIA). A true online diarizer (80 ms resolution, max 4 speakers) (H). sherpa-onnx added a streaming Sortformer wrapper for native/mobile targets around 2026-09 (M). **No proven browser/WASM build** was found.

**Accuracy expectations.** The pyannote community-1 pipeline (native, full-precision reference) scores DER 17.0% on AMI headset, 19.9% on AMI far-field and 11.2% on VoxConverse (H, model card). The sherpa-onnx WASM pipeline uses segmentation 3.0 with a small embedding model and should be the same or somewhat worse (L). For **2–4 speakers in a clean debate** (long turns, little overlap, distinct voices), expect roughly 5–12% DER, with errors concentrated at turn boundaries, backchannels and cross-talk (L). That isn't good enough to auto-commit attribution under our fidelity rules. It is good enough to pre-fill labels for an operator to confirm.

**Live incremental use.** Realistic browser approach: **speaker identification, not blind diarization.**
1. Enroll each known speaker at session start (15–30 s each: an intro, or the host clicking "this is A" during the first turns). Compute CAM++/WeSpeaker embeddings in WASM (a few ms per 1.5 s window).
2. For each VAD utterance, embed it and assign it to the nearest enrolled centroid by cosine similarity, with a margin. Below the margin, attribution is `pending` and goes to the console. This matches the existing fusion rule in ARCHITECTURE §Capture.8.
3. Update centroids slowly with confirmed utterances.

This works per utterance, adds under 100 ms, and handles 2–4 known speakers well (L, standard practice). Unknown audience speakers fall below the margin and go to the operator. Blind online clustering in the browser without enrollment is not recommended.

## 3. Hosted fallbacks (BYO key)

| Provider | Streaming price | Batch price | Diarization | Multichannel | Word ts | Browser-direct? |
|---|---|---|---|---|---|---|
| **Deepgram** Nova-3 | $0.0048/min (**$0.29/h**) promo, regular $0.0077/min ($0.46/h) (H) | $0.0043/min ($0.26/h) (H) | Streaming +$0.0020/min (+$0.12/h). Included free on batch (H). Streaming uses the older v1 diarizer (M) | **Yes, streaming, up to 20 ch** (H) | Yes | WebSocket: yes, with a temporary JWT from `/v1/auth/grant` (TTL 30 s default, up to 3600, only needed at connect) or the key via the WebSocket subprotocol (M). **REST pre-recorded: no CORS, needs a proxy** (H, Deepgram docs/discussions) |
| **AssemblyAI** | Universal-Streaming **$0.15/h**, U3.6 Pro Realtime $0.45/h (H) | Universal-2 $0.15/h, U3.5 Pro $0.21/h (H) | Streaming +$0.12/h (up to 10 speakers). Batch +$0.02/h (H) | Streaming: one session per channel (H). Batch billed per channel | Yes | Streaming: temporary token (`GET streaming.assemblyai.com/v3/token`, 1–600 s redemption window, session up to 3 h) passed as a `token` query param (H). Whether the token endpoint allows CORS was **not verified**. Plan for a tiny token-mint route |
| **Speechmatics** | From ~$0.24/h. The Pro tier advertises from $0.129/h (M, the pricing page didn't render the table) | Similar | **Included** on real-time (M) | Channel diarization supported (M) | Yes | Temporary JWT (`type=rt`, ~60 s TTL) as a `?jwt=` query param (H) |
| **Rev.ai** | Reverb $0.20/h, Turbo $0.10/h (M) | Same | Price not public (M) | — | Yes | Server-side only in practice |
| **OpenAI** | `gpt-realtime-whisper` / `gpt-live-transcribe` $0.017/min (**~$1.02/h**) (H) | `gpt-transcribe` $0.0045/min, `gpt-4o-transcribe-diarize` $0.006/min (H) | `-diarize` is **batch only**, not realtime (H) | — | Not documented for diarize | Realtime: ephemeral `ek_` client secret from `/v1/realtime/client_secrets` over WebRTC (H). Minting it needs the key, so it's server-side by design |

Free credits (H unless marked): Deepgram $200, AssemblyAI $50, Speechmatics $100. A 90-min event with 3 separate tracks on Deepgram streaming costs about 3 × 1.5 h × $0.29 ≈ **$1.30**. A room mic with diarization costs about 1.5 h × $0.41 ≈ **$0.62**. A 150-min upload on Deepgram batch costs about **$0.65**. Transcription is a rounding error next to the Claude spend (§4).

**Browser-direct pattern for BYO keys.** The host's key is already in the browser, so the concern is CORS, not secrecy. WebSockets aren't subject to CORS, so live streaming can run direct. REST uploads (Deepgram pre-recorded) and possibly the token endpoints need a **stateless pass-through route** (`/api/stt-token`). It forwards the user's key once, returns a short-lived token, and never logs or stores the key. The existing Next.js `/api` on Vercel can host it.

## 4. Anthropic API from the browser with a user key

- **CORS:** supported since Aug 2024 via the request header `anthropic-dangerous-direct-browser-access: true`. Without it, browser-originated calls are rejected (H). The TypeScript SDK sets it when constructed with `new Anthropic({ apiKey, dangerouslyAllowBrowser: true })`. Browsers are blocked by default (H, SDK README). Streaming (SSE via fetch) and structured outputs (`output_config.format`, `messages.parse()`) are the same Messages API, so they work from the browser (M: same endpoint; test once).
- **Key validation:** `GET /v1/models` with the key is cheap, costs no tokens, and returns 401 on a bad key (H that the endpoint exists; M that it's CORS-enabled with the header, verify in dev). A fallback is `POST /v1/messages/count_tokens` (free). Neither checks that credits exist. Only a real `messages.create` with `max_tokens: 1` (costs a fraction of a cent) surfaces a zero-balance error.
- **Rate and spend limits a new host will hit:** new organizations "may start in the Evaluation tier, with limits below the standard limits". The Start tier has a **$500/month spend cap** and, for Opus 5.5, 1,000 RPM / 2M ITPM / 400k OTPM (H, rate-limits doc). A host who creates an account the morning of an event may be rate-limited. Have them create it a week ahead and run one test session.
- **Where to hold the key.**
  - *Memory only (default):* lost on reload, and XSS can still read it while the page runs.
  - *sessionStorage:* survives a reload in the same tab.
  - *localStorage "remember on this device":* persistent, and readable by any script on the origin, including any compromised dependency or XSS.
  - Mitigations: a strict CSP (`connect-src` limited to api.anthropic.com and the chosen STT hosts, no third-party scripts on host pages), keep the key only in the host console route (never on `/stage`, `/overlay` or `/p`), never send it to our server except through the explicit STT token pass-through, show a "forget key" control, and recommend a **dedicated key with a workspace spend limit** (Console → Settings → Limits). The real risk is the key leaving the laptop, so the spend limit is the backstop.
  - Recommendation: memory by default, opt-in localStorage, and the workspace spend-limit advice built into setup.
- **Non-technical setup steps (H: platform.claude.com, support.claude.com):**
  1. Go to **platform.claude.com** (console.anthropic.com redirects there). Sign up with email or Google and verify.
  2. **Settings → Billing → Buy credits.** Add a card. Presets are $5 / $20 / $100 / custom. **$5 is the minimum** (M, secondary source; the support article doesn't state it). Credits are prepaid, non-refundable, and **expire after one year** (H). Optionally turn on auto-reload.
  3. Optionally, **Settings → Limits**: set a monthly spend limit.
  4. **Settings → API keys → Create key.** Name it "Anti-Debate". Copy it immediately (it's shown once, starts `sk-ant-`). Paste it into the app.
  - Free starter credits for new accounts: **unclear**. One secondary source says $5 free; the official support page doesn't mention any. Don't promise them.
- **Cost framing:** measured on this project's pipeline (R0_DEMO, 2026-09-28): **≈$1.6 per 11 min of two-person debate on Opus 5.5, or about $12–15 for a 90-min event** (ARCHITECTURE §10 estimated up to ~$30 live, plus $20–40 for a canonical pass). Suggested host copy: "Buy $25 of credit. A 90-minute live session typically uses $12–15. Processing an uploaded recording costs about the same per hour."

## 5. Recommendation matrix

| Mode | ASR | Speaker attribution | Latency | Download | Quality notes | Hosted fallback |
|---|---|---|---|---|---|---|
| **Live, separate tracks** (USB interface, one mic per speaker) | Parakeet TDT 0.6B via parakeet.js. Per-channel Silero VAD, one shared model instance processing utterances in a queue | **Channel ownership** (no diarizer), plus a bleed guard: drop an utterance when another channel's energy is higher at the same time. Optional voiceprint cross-check | ~1–2 s end of speech → final on M-series (L). ~2–4 s on Windows iGPU/WASM (L) | ~650–900 MB once (cached) + VAD 2 MB | Best case. Matches the native design in ARCHITECTURE. **Risk:** Chrome multichannel capture beyond 2 channels needs `getUserMedia` with `channelCount` and `echoCancellation`/`noiseSuppression`/`autoGainControl` off. Verify on the actual interface (L) | Deepgram streaming `multichannel=true`, ~$0.29/h per channel, no diarization needed |
| **Live, room mic** (one mic or a laptop mic) | Same Parakeet + VAD | **Enrolled speaker identification** (CAM++/WeSpeaker WASM embeddings, nearest centroid with margin → `pending`) | Same + <0.1 s | + ~30 MB | Weakest mode: overlap and backchannels get misattributed. Needs the operator confirming low-margin utterances. Blind diarization isn't usable here | AssemblyAI Universal-Streaming + `speaker_labels` ($0.27/h), or Deepgram + diarize ($0.41/h promo). Both still need operator confirmation |
| **Uploaded recording** (60–150 min) | Parakeet in 60 s windows with overlap, WebGPU if present, else WASM int8, in a worker with resumable chunk results | sherpa-onnx WASM offline diarization (pyannote seg-3.0 + CAM++), `num_speakers` set from the manifest, then the existing operator relabel pass. For separate-track recordings, per-track ASR and no diarization | 90 min audio: ~5–10 min on M-series GPU, ~20–40 min on WASM/iGPU (L) | ~650–900 MB + ~34 MB | Diarization DER is roughly pyannote-level (11–20% on hard sets, lower on clean debates). Relabel pass stays mandatory | Deepgram batch ($0.26/h, diarization included, **needs the proxy** for CORS) or AssemblyAI batch ($0.15–0.23/h) |

---

## What this means for the app

1. **A browser-only, Anthropic-key-only build is feasible** for separate-track live and for uploads. Parakeet TDT in the browser via parakeet.js gives Parakeet-class WER (~6.3%) with the word timestamps the quote locator needs, and it's the same model family as the native `parakeet-mlx` path. The ~0.65–0.9 GB first-load download must happen **before** the event: add a "prepare this laptop" step that downloads, calls `persist()`, and runs a 30 s benchmark that reports real-time factor and the backend it picked.
2. **Room-mic live is the weak mode**, whatever the stack. Build enrollment-based identification, route low-margin utterances to `attribution.pending`, and keep non-negotiable #1: nothing auto-commits on a guess. Say so plainly in setup.
3. **Offer one hosted STT as an optional second key, not a requirement.** Deepgram is the best single choice: multichannel streaming, $200 free credit, about $1–2 per event. It's the fallback for weak Windows laptops and for hosts who want certainty. It needs one stateless pass-through route for pre-recorded uploads and token minting. The key must never be stored or logged there.
4. **Anthropic direct from the browser is supported.** Use `dangerouslyAllowBrowser: true` in `packages/llm` for the browser build (the model config stays in `models.ts`), validate with `GET /v1/models`, then a 1-token call to confirm credits. Hold the key in memory by default. Onboarding should tell hosts to create the account **days ahead** (Evaluation-tier limits), buy about $25 (the minimum is $5), and set a workspace spend limit.
5. **Measure before committing** (QUALITY §6): (a) parakeet.js v2 vs v3 WER on the DT and Anti-Debate gold segments vs native parakeet-mlx, (b) end-of-speech → final latency on an M1 Air and a mid-range Windows iGPU laptop, (c) sherpa-onnx WASM diarization DER on one Anti-Debate recording vs the pyannote native pass, (d) 4-channel capture in Chrome on the event interface.

## Sources

- NVIDIA Parakeet TDT 0.6B v3 model card: https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3
- parakeet.js: https://github.com/ysdede/parakeet.js · discussion: https://huggingface.co/nvidia/parakeet-tdt-0.6b-v2/discussions/56
- parakeet_web (benchmarks, sizes, chunking, diarization bundle): https://github.com/thiswillbeyourgithub/parakeet_web
- Quantized v3 ONNX: https://huggingface.co/efederici/parakeet-tdt-0.6b-v3-onnx-int4 · https://huggingface.co/istupakov/parakeet-tdt-0.6b-v3-onnx
- sherpa-onnx Parakeet v3 int8 word-drop issue: https://github.com/k2-fsa/sherpa-onnx/issues/2605
- Moonshine v2 paper: https://arxiv.org/html/2602.12241v1 · repo: https://github.com/moonshine-ai/moonshine-v2
- transformers.js v4 blog: https://huggingface.co/blog/transformersjs-v4 · releases: https://github.com/huggingface/transformers.js/releases · docs: https://huggingface.co/docs/transformers.js/en/index
- Whisper WebGPU vs WASM on M2 (stale, 2024): https://github.com/huggingface/transformers.js/issues/894
- V8 4 GB WASM memory: https://v8.dev/blog/4gb-wasm-memory · Memory64: https://spidermonkey.dev/blog/2025/01/15/is-memory64-actually-worth-using.html
- Storage quotas: https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria · https://web.dev/articles/storage-for-the-web
- pyannote segmentation-3.0 ONNX: https://huggingface.co/onnx-community/pyannote-segmentation-3.0 · community-1 DER: https://huggingface.co/pyannote/speaker-diarization-community-1
- sherpa-onnx diarization: https://k2-fsa.github.io/sherpa/onnx/speaker-diarization/index.html · WASM Space: https://huggingface.co/spaces/k2-fsa/web-assembly-speaker-diarization-sherpa-onnx
- Streaming Sortformer: https://huggingface.co/nvidia/diar_streaming_sortformer_4spk-v2 · https://arxiv.org/pdf/2507.18446
- Deepgram pricing: https://deepgram.com/pricing · multichannel: https://developers.deepgram.com/docs/multichannel · tokens: https://developers.deepgram.com/guides/fundamentals/token-based-authentication · CORS/proxy: https://github.com/orgs/deepgram/discussions/686
- AssemblyAI pricing: https://www.assemblyai.com/pricing · temp token: https://www.assemblyai.com/docs/api-reference/streaming/create-temporary-token · multichannel: https://www.assemblyai.com/docs/universal-streaming/multichannel-streams
- Speechmatics: https://www.speechmatics.com/pricing · auth: https://docs.speechmatics.com/get-started/authentication
- Rev.ai: https://www.rev.ai/pricing
- OpenAI pricing: https://developers.openai.com/api/docs/pricing · diarize model: https://developers.openai.com/api/docs/models/gpt-4o-transcribe-diarize · ephemeral: https://developers.openai.com/api/reference/resources/realtime/subresources/transcription_sessions/methods/create
- Anthropic CORS: https://simonwillison.net/2024/Aug/23/anthropic-dangerous-direct-browser-access/ · TS SDK: https://github.com/anthropics/anthropic-sdk-typescript · rate limits/tiers: https://platform.claude.com/docs/en/api/rate-limits · billing: https://support.claude.com/en/articles/8977456-how-do-i-pay-for-my-claude-api-usage · console walkthrough: https://dev.classmethod.jp/en/articles/claude-console-buy-credit-create-api-key/
- Project cost measurement: `docs/R0_DEMO.md` §Costs, `docs/ARCHITECTURE.md` §10
