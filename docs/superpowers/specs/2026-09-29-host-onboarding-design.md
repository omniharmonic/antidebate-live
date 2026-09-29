# Host onboarding: password-gated, bring-your-own-key, browser-only hosting

Date: 2026-09-29 · Owner: Benjamin Life (@omniharmonic) · Status: approved in conversation, awaiting spec review

## 1. Intent

Approved hosts (Stephanie Lepp, Liv Boeree, Benjamin) can run a live Anti-Debate or process a recorded one from any laptop with Chrome, with no installs, funded by their own Anthropic key. Everyone else sees only the finished pre-run debates.

Success looks like:
- A host on a fresh machine goes from "I have the password" to a running live session using only the browser and on-screen instructions.
- No request path exists by which a visitor can create a session, write events, or spend anyone's credits.
- Speaker attribution works in every audio setup (separate mics, video call, one room mic, recording), degrades visibly rather than silently, and each setup has a measured accuracy.

What the user said (verbatim intent): hosting and video submission go behind a password; "anyone with the password can use it but they need to bring their own API key"; clear instructions for creating a key; it must work for Stephanie and Liv on their machines; attribution must be configurable per session across in-room, video-call and separate-track settings, based on researched methods rather than guesses; diarization must work without separate channels; the system should feel robust and adaptive.

Decisions taken in conversation:
1. Processing runs entirely in the host's browser tab (approach A). Not the server (B), not a local installer (C).
2. One shared host password, remembered 30 days per device in a signed cookie.
3. The host's Anthropic key is remembered on the device (localStorage) with an always-visible "Forget key".
4. Attribution combines channel, voiceprint and new-voice discovery in every setup (section 5).

Research behind this: `docs/research/2026-09-29-browser-audio-capture.md`, `2026-09-29-video-call-audio.md`, `2026-09-29-browser-asr-diarization.md`.

Out of scope: Zoom RTMS / Meet Media API integrations, hosting our own call rooms, Deepgram or other hosted ASR, per-host accounts, phones as capture devices. The local CLI path (`services/capture` + `apps/worker`) stays as the operator's path; this adds to it.

## 2. Architecture

```
Host's Chrome tab (/host/…)                                   antidebate.xyz (Vercel)
┌──────────────────────────────────────────────────────┐     ┌──────────────────────────────┐
│ capture (getUserMedia / getDisplayMedia / file)      │     │ /api/host/login   → cookie   │
│   → VAD segmenter → Parakeet ASR (parakeet.js)       │     │ /api/host/session → token    │
│   → attributor (channel + voiceprint + discovery)    │     │ /api/events  (session token) │
│   → utterance.final / attribution.* events           │────▶│ Neon event log               │
│ SessionEngine (shared with apps/worker)              │     │ /api/events/stream (SSE)     │
│   → L1–L4 via Anthropic, host's key, direct from tab │     └──────────────┬───────────────┘
│   → proposals, verdicts, insights                    │                    ▼
└──────────────────────────────────────────────────────┘      cockpit / stage / explore (unchanged)
```

The host's key goes only from the tab to `api.anthropic.com`. Our server never receives it. Audience surfaces are unchanged and still read only `audienceView()` output.

## 3. Access: host password and session tokens

- Env: `HOST_PASSWORD` (shared secret) and `HOST_SIGNING_SECRET` (HMAC key), set in Vercel for production and preview.
- `POST /api/host/login {password}`: constant-time compare, then sets `adl_host` = `v1.<expiry>.<hmac>` (HttpOnly, Secure, SameSite=Lax, 30 days). Rate limit: 5 failures per IP per 10 minutes (in-memory per instance; acceptable for a shared password).
- `proxy.ts` (Next 16) guards `/host/**`. No valid cookie → redirect to `/host/login?next=…`.
- `POST /api/host/session` (cookie required) creates the session (`session.started` written server-side) and returns `sessionToken = v1.<sessionId>.<expiry>.<hmac>`, valid 24 hours.
- `/api/events` gains a fourth tier: `Bearer <sessionToken>`. It accepts worker-tier event types, only for that `sessionId`. The existing three tiers stay for the CLI path.
- `/` lists only ended sessions (`session.ended` present). A live session is reachable only by its link.
- `/new` redirects to `/host/new`. The `?key=` operator-key flow stays for the console, for Benjamin's CLI use.

## 4. Bring your own key

- `/host/key`: shown on first sign-in, and whenever no key is stored. The steps, rendered as a checklist:
  1. Create an account at console.anthropic.com. Do it a few days before the event: new accounts can start with lower rate limits.
  2. Billing → buy credits. Suggest $25. A 90-minute debate measured about $12–15 (R0_DEMO, 2026-09-28).
  3. API keys → Create key, named "antidebate". Optionally put it in its own workspace with a monthly spend limit.
  4. Paste it here.
- Check: one `max_tokens: 1` request to the default model through the browser SDK (`dangerouslyAllowBrowser: true`). Its result maps to plain messages: 401 → "That key wasn't accepted"; 400 credit-balance → "The account has no credit yet"; 429 → "Rate-limited; new accounts start low, try again in a minute"; network/CORS → "The browser couldn't reach Anthropic".
- Storage: `localStorage['adl.anthropicKey']`, wrapped in try/catch. The header shows "Key: sk-ant-…XXXX · Forget". The page says plainly that anyone using this browser profile can spend on this key.
- A running spend estimate (tokens × `PRICES`) shows in the host bar during a session. It's labelled "estimate".

## 5. Speaker attribution (every setup)

One attributor combines, per utterance, whichever signals exist, and writes `Utterance.attribution` as it already appears in the ontology (`confidence`, `signals {channel, diarLabel, voiceprint}`, `confirmedBy`). No ontology change is needed.

- **Channel.** When a channel has an owner, the energy margin against the other channels in dB.
- **Voiceprint.** Cosine similarity of the utterance's speaker embedding to each enrolled voice. Enrollment is 20–30 s per person at sound check. It runs in all setups, so it also cross-checks channels.
- **Discovery.** An embedding that matches no voice above a threshold opens a temporary cluster ("Voice 3"). The host names it once from a clip; earlier utterances in the cluster get `attribution.confirmed`.
- **Fusion.** Port `services/capture/adl_capture/fusion.py` to TypeScript unchanged (weights 0.5/0.35/0.15, overlap ×0.8, auto at ≥ 0.85), with tests that match the Python ones. Below threshold: emit `attribution.pending`. The existing hold validator keeps its claims out of the map until confirmed.
- **Adaptation**, with status shown to the host and never a stop:
  - Bleed: the same voice on two channels is resolved by margin plus voiceprint, and emitted once.
  - Dead channel: silent for 60 s while voice activity continues elsewhere → that speaker falls back to voiceprint.
  - Swapped channel: 5 consecutive confident mismatches → suggest remapping.
- **Recordings.** Whole-file diarization (segmentation + embeddings + clustering) before transcription. The host names each cluster from a clip. One file per speaker skips diarization.
- **Models.** sherpa-onnx WASM: pyannote segmentation plus a small speaker-embedding model, about 34 MB. It loads in a Web Worker.

Quality gate (QUALITY §6), run in Node against the same WASM build, over fixtures whose speaker turns are known (Ball×Kokotajlo and the other ingested debates):
- separate-channel audio;
- the same audio mixed to mono;
- mono with simulated bleed.

The measure is the share of speech time attributed correctly, and the share of wrong attributions that were auto-accepted. The latter must be ≤ 2%. The results go in `evals/results.md`. A setup that misses the gate keeps "confirm speakers" forced on.

## 6. Audio setups (host picks one per session)

`/host/new` asks "How will the audio reach this laptop?" Each answer opens a setup screen with numbered steps, meters, and checks that must pass before Start is enabled.

1. **Each speaker has their own mic.** A 2-input USB interface (L/R split) or 2–4 USB mics (one `getUserMedia` each).
   - Checks: `channelCount` = 2; echoCancellation, noiseSuppression and autoGainControl all false; no clipping or silence.
   - Mapping: each person says their name; the host clicks the name next to the meter that moved.
   - Warnings: PodTrak and RØDECaster (macOS) send only a mix; more than 2 inputs from one device doesn't work in Chrome.
2. **Video call.**
   - Join the call in a second Chrome window as a muted listener → "Share tab audio".
   - Zoom desktop app: system audio (Chrome 141+ on macOS 14.2+, or Windows).
   - Enrollment, then voiceprint attribution.
   - The screen suggests recording with per-participant tracks (Zoom local, Riverside, StreamYard) for a later, cleaner import.
3. **One mic in the room.** The laptop or a single mic, with the same enrollment. The session is labelled "speakers identified by voice". Placement tips.
4. **A recording.**
   - One file, or one file per speaker; mp4/m4a/wav/webm, decoded in the browser.
   - A note explains YouTube links aren't accepted, and why.
   - Progress with an estimate. The tab must stay open.

Every live setup includes:
- "Prepare this laptop": download and cache the ASR model (about 700 MB, with progress and a resumable Cache Storage download), keep the laptop plugged in, turn on Do Not Disturb, keep the tab in front.
- A 30-second rehearsal showing the live transcript.
- A Wake Lock request.
- An on-page warning if the tab is hidden.

## 7. Engine in the browser

- **`@adl/llm` gets a transport seam.** `callStructured` delegates to a `Transport`. The current Node code becomes `nodeTransport` (subscription/api/cache). A new `browserTransport(apiKey)` uses `@anthropic-ai/sdk` with `dangerouslyAllowBrowser`, with the same `passConfig`, the same structured-output format and the same `LlmCallLog`.
  - Node-only imports move behind the `node` export condition, so the browser bundle never pulls in `node:*`.
  - Prompt versions and model defaults are unchanged.
- **`SessionEngine` moves** from `apps/worker/src/engine.ts` to a new `packages/engine`, with its `EventLog` interface.
  - `apps/worker` imports it unchanged.
  - The browser gets `HttpEventLog`: the tab's own events are applied locally and POSTed in batches (every 1 s or 50 events) with the session token. It retries with backoff and keeps an IndexedDB outbox so a network blip loses nothing. Posts are idempotent by eventId.
- **ASR.** parakeet.js (Parakeet TDT 0.6B, int8) in a Web Worker, WebGPU with WASM fallback.
  - Live: a VAD segmenter per channel → per-utterance transcription.
  - Recordings: 60 s chunks at speed max.
  - Word timestamps populate `Utterance.words`.
- **Recovery.** If the tab reloads mid-session, the host reopens `/host/s/<id>`. The engine replays the log from the server (`caughtup`), then resumes. Capture restarts after one click, because browsers require a user gesture.

## 8. Host flow (screens)

1. `/host/login`: the password.
2. `/host/key`: key steps and check. Skipped when a key is stored.
3. `/host`: the host's recent sessions on this device (localStorage), "New live session", "Process a recording".
4. `/host/new`: title, format, participants (names and roles), then the audio setup (section 6).
5. `/host/s/<id>`: host bar (status, spend estimate, attribution issues count, Pause/End), live transcript with unconfirmed utterances to click, and links to open the cockpit, stage and explore views for others.

Copy follows UX §2: plain, no filler, no emoji, no unverifiable numbers.

## 9. Error handling

Every failure is shown in words, with the next action:
- wrong password;
- key rejected, or no credit;
- mic permission denied;
- device gives 1 channel when 2 were expected;
- processing still on;
- model download interrupted (resume);
- WebGPU unavailable (uses WASM, "slower");
- Anthropic 429/5xx (the engine backs off; the turn is retried, and the host bar shows "Analysis delayed");
- event POST failing (outbox count shown);
- session token expired (re-issued via cookie).

## 10. Testing

- Unit tests:
  - cookie and token sign/verify, including expiry and tamper;
  - the `/api/events` session-token tier: right session accepted, other session 403, audience 401;
  - the fusion port, against the Python cases;
  - the attributor's adaptation rules;
  - `HttpEventLog` outbox;
  - `browserTransport` request shape (mocked fetch).
- Attribution quality gate: section 5.
- E2E (Playwright):
  - login → key screen with a fake key (mocked Anthropic);
  - new session → recording upload of a 2-minute fixture clip with transcription stubbed → events appear on `/s/<id>`.
- Manual, before 2026-10-11:
  - Scarlett L/R split in Chrome;
  - two USB mics over 90 minutes;
  - Chrome system audio on the host's macOS;
  - parakeet.js latency on an M-series Mac and a Windows laptop;
  - a full session on Stephanie's machine.
- No API spend in automated tests. Real-key checks happen only with Benjamin's explicit approval.

## 11. Open risks

- parakeet.js speed and accuracy on real laptops aren't measured yet. If live latency is over 4 s on the host's laptop, live mode shows a warning, and the CLI capture path is the fallback for 10/11.
- New Anthropic accounts may be rate-limited during a 90-minute session. The L3/L4 cadence already backs off. The key screen tells hosts to create the key days ahead.
- The model download is large for venue Wi-Fi. "Prepare this laptop" must be done beforehand; the setup screen checks the model is cached.
