# Getting a video-call debate into the app: per-speaker audio, live and after

Research date: 2026-09-29. Question: how does a browser-based app get the audio of a debate held on a video call, with each speaker identified, live (under about 10 s) and from the recording afterwards, when the host is not technical?

Confidence tags: **[H]** verified in a primary vendor doc fetched today. **[M]** from vendor forum staff, an official blog, or several consistent secondary sources. **[L]** inferred, or sources conflict. Items marked *stale?* may have changed.

---

## Summary

- **No mainstream platform gives a plain browser tab separate per-participant audio from a normal meeting without a server-side integration.** Every official real-time path (Zoom RTMS, Meet Media API, Teams media bots) needs a registered app, OAuth or admin consent, and a server or a special client. [H]
- **Zoom RTMS is the only official path that is realistic for October 2026.** It streams per-participant PCM plus diarized transcripts with `user_name` over WebSockets to a server. It needs a Zoom General App and a paid Developer Pack, and costs about 0.01–0.02 credits per minute. [H/M]
- **Meet Media API is out of scope for a public debate.** It is still a Developer Preview, and *every participant* has to be enrolled in the preview. [H]
- **Teams real-time media needs C#/.NET on Windows Server in Azure.** Microsoft says outright that it is not meant for AI-agent scenarios. [H]
- **The quick win that works on any platform:** a dedicated "listener" Chrome window joins the call as a muted participant, and the app captures that tab's audio (`getDisplayMedia`, "Also share tab audio"). That gives one mixed feed. Speaker attribution then comes from our own diarization and voiceprints. Going further, a per-debater "companion mic" link in the app captures each debater's own mic in their browser, which is platform-independent (my design proposal, see §8).
- **Recordings:** Zoom local recording (desktop client) and Riverside give true per-participant tracks, and StreamYard does too (local recording on all plans, cloud tracks on the Advanced plan only). Meet and Teams recordings are composites only, but both offer speaker-labelled transcripts afterwards.

---

## 1. Zoom

### 1.1 Live per-participant audio

**Realtime Media Streams (RTMS).** This is the official answer, and Zoom now points bot builders to it.
- It streams "audio, video, and transcript data from Zoom meetings" to your app "instead of having participant bots." [H] ([RTMS overview](https://developers.zoom.us/docs/rtms/), [RTMS for meetings](https://developers.zoom.us/docs/rtms/meetings/))
- Audio: "an audio stream for each participant," plus a merged stream where `user_id` is `0`. The default format is raw PCM L16, 16 kHz, mono, in 20 ms packets (configurable up to 1000 ms). [H] ([media](https://developers.zoom.us/docs/rtms/meetings/media/))
- Transcripts: every message carries `user_id`, `user_name`, `timestamp`, `language` and text. Zoom describes its transcription as optimized "for low latency." [H] (same page)
- Requirements:
  - A **General App** in the Zoom Marketplace, with RTMS scopes and a webhook (`meeting.rtms_started`) that leads to a WebSocket connection from **your server**. There is no browser-only mode: the connection is server-side, using the Node or Python RTMS SDK. [H/M] ([SDKs](https://developers.zoom.us/docs/rtms/sdk/), [getting started](https://developers.zoom.us/docs/rtms/meetings/getting-started/))
  - "An active Zoom Developer Pack subscription with sufficient credits." Zoom staff answered a developer whose RTMS calls failed with "get the Developer Pack" (forum, 2026-08-24). [H/M] ([forum](https://devforum.zoom.us/t/enable-rtms-for-app-id-esvarqr7saol-fzqcofn7a-development/145841))
  - Cost: 0.01 credit per minute without transcription and 0.02 with it. Audio plus diarized transcript is billed at the 0.02 rate (forum, 2026-08-10, from a Recall.ai participant rather than Zoom staff). [M] ([forum](https://devforum.zoom.us/t/rtms-credit-consumption-per-minute-and-whether-the-initiating-participant-needs-a-paid-plan/145391)) A 90-minute debate is therefore about 1–2 credits. The dollar price per credit was not confirmed on a primary page. Third parties cite $100 for 100 credits on the Build Platform. [L]
  - Distribution: an internal (same-account) app does not need Marketplace review. [M] A tester reported that Development mode failed on another account and only started working after the app was switched to production or beta (forum, 2026-05/06). [M] ([forum](https://devforum.zoom.us/t/rtms-works-on-developer-account-but-not-on-zoom-marketplace-testers-account-development-mode/143827))
  - The initiating participant can be on a Basic plan, but the account has to be verified. [M]
  - Start mode: apps can auto-start when users join. Otherwise the host or an authorized user starts the app in-meeting. [H/M]
  - Latency: no figure is published. Streaming happens at packet level (20 ms), so seconds end to end is plausible. [L]
- **Practicality for 2026-10-11:** feasible if Benjamin's Zoom account hosts the meeting, a General App is created in that account, the Developer Pack is bought, and a small server (for example the worker process on Fly or Render; not Vercel serverless) terminates the WebSocket. Allow about a week to build and test. [M]

**Meeting SDK raw data.** Not recommended.
- Raw audio callbacks (mixed and per-user PCM) exist only in the native SDKs (Windows, macOS, Linux, iOS, Android). The Web Meeting SDK has no raw-audio access. [M] ([Windows raw data](https://developers.zoom.us/docs/meeting-sdk/windows/add-features/raw-data/), [Recall.ai](https://www.recall.ai/blog/can-i-access-raw-audio-data-using-the-zoom-web-sdk))
- Since **2026-03-02**, SDK bots that join meetings hosted by *other accounts* need an OBF (On Behalf Of) token from an OAuth-authorized user who is already in the meeting. When that user leaves, the bot is dropped. Zoom says to "use RTMS" for continuous access. [H] ([OBF FAQ](https://developers.zoom.us/docs/meeting-sdk/obf-faq/))

**Video SDK.** This is a separate product for building your own call UI, not for joining Zoom Meetings. It also supports RTMS. It is only relevant if we replace the meeting platform altogether. [H] ([RTMS for Video SDK](https://developers.zoom.us/docs/rtms/video-sdk/))

### 1.2 Live mixed audio plus speaker identity
- **Closed-caption API token:** this runs the wrong way. It lets a third-party captioner *post* captions into Zoom. It does not give us Zoom's captions. [M] ([example KB](https://support.cmts.jhu.edu/hc/en-us/articles/40926150526733-Setting-Up-Closed-Captioning-in-Zoom-Using-a-Third-Party-Captioning-Service))
- **Zoom Apps SDK** (an in-client web app): exposes `onActiveSpeakerChange`, but forum reports describe it as inconsistent, especially with two people in the meeting. It could in principle timestamp speaker turns alongside a tab-captured mixed feed, but it still needs a Marketplace app, and clock alignment across two contexts is fragile. [M] ([Apps SDK](https://appssdk.zoom.us/classes/ZoomSdk.ZoomSdk.html), [forum](https://devforum.zoom.us/t/inconsistent-behavior-for-onactivespeakerchange-and-onmyactivespeakerchange-events/71421))
- **RTMS transcripts** with `user_name` are the supported source of live speaker-labelled text (see above).

### 1.3 Recordings
- **Local recording (desktop client): confirmed per-participant audio.** Steps:
  1. In the Zoom desktop app, open Settings, then Recording, and tick **"Record a separate audio file for each participant"**. Do this before the meeting.
  2. In the web portal, under Settings, then Recording, make sure local recording is allowed.
  3. The host clicks Record, then "Record on this computer".

  After the meeting ends, Zoom converts the recording. The recording folder then contains `Audio Record/` with one `.m4a` per participant, each named for the participant. [M] ([GVSU KB](https://services.gvsu.edu/TDClient/60/Portal/KB/ArticleDet?ID=4698), [TechRepublic](https://www.techrepublic.com/article/how-to-record-separate-audio-for-each-person-in-a-zoom-call/)) Local recording needs the desktop client (not the web client), and the host must not quit before conversion finishes. Phone dial-in participants are merged into one file. [M]
- **Cloud recording:** sources conflict. Several university KBs and Zoom community posts describe an advanced cloud setting "Record a separate audio file of each participant" (up to 200 participants, M4A), downloaded from the recording's page under "Audio file of each participant". Other posts say the feature is local-only. The Zoom Video SDK cloud-recording doc does list per-participant files. [L] Treat it as unverified for Meetings and test it once on the host's account before relying on it. ([OU KB](https://itsupport.ou.edu/TDClient/30/Unified/KB/Article/2521/Getting-Started-with-Zoom-Local-and-Cloud-Recording), [community](https://community.zoom.com/t5/Zoom-Meetings/How-to-download-separate-participant-audio-from-cloud-recording/m-p/84315), [Video SDK cloud recording](https://developers.zoom.us/docs/build/cloud-recording/))

### 1.4 Quick recipe (today)
See the listener-tab recipe in §7. For Zoom specifically: the account setting "Show a 'Join from your browser' link" is on by default and needs end-to-end encryption off. An admin can also enable "Join meeting from browser" under Account Settings, then Meeting, then In Meeting (Advanced). [H] ([KB0067293](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0067293), [KB0084678](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0084678))

---

## 2. Riverside

- **Live per-participant audio:** there is no public real-time media API. The Business API (Business plan, custom pricing; a third party cites about $5.4k a year [L]) covers recordings, tracks, exports and transcriptions *after* recording. [H] ([Business API](https://docs.riverside.fm/quickstart), [get recording](https://docs.riverside.fm/endpoints-reference/get-recording))
- **Live mixed audio:** custom RTMP output is on Grow ($39/mo), Webinar and Business. That sends one mixed program feed to an RTMP endpoint we would host server-side. It carries no speaker metadata. [H] ([pricing](https://riverside.com/pricing), [multistream](https://support.riverside.com/hc/en-us/articles/5434275254941-Live-stream-to-multiple-destinations))
- **Recordings: best-in-class per-participant tracks.** Each participant is recorded locally on their own device and progressively uploaded, and the downloads are per-participant WAVs (24-bit/48 kHz for high-quality downloads). Separate-track download hours are capped by plan: Free 2 h one-off, Pro 15 h, Grow 20 h, Webinar 25 h, Business unlimited. Up to 10 on-screen participants record separate tracks. [H/M] ([download tracks](https://support.riverside.com/hc/en-us/articles/5260432295581-Download-high-quality-tracks), [pricing](https://riverside.com/pricing), [FAQ](https://riverside.com/faq))
  - Steps: Studio, then Recordings, then the session, then the download button on each participant's track, choosing "High quality" (WAV). No pre-call setting is needed, because tracks are separate by default.
- **Quick recipe:** the host joins the Riverside studio in Chrome, and a second Chrome window (the listener) joins as a guest or producer, muted, and is tab-captured (§7). Riverside warns against multiple tabs on one device, so use a second machine or a separate browser profile. [L]

---

## 3. Google Meet

- **Live per-participant audio: Meet Media API.** It is a **Developer Preview** (page updated 2026-09-03). "The Google Cloud project, OAuth principal, and **all participants in the conference** must be enrolled in the Developer Preview Program." [H] ([overview](https://developers.google.com/workspace/meet/media-api/guides/overview), [concepts](https://developers.google.com/workspace/meet/media-api/guides/concepts))
  - Audio arrives as exactly 3 receive-only audio streams: the "most relevant" (loudest) speakers, identified by CSRC, which stays constant per participant. So it is not every participant, but a debate rarely has more than 3 simultaneous talkers. [H]
  - It uses restricted OAuth scopes. The host, a co-host, or a same-organization participant has to consent in-meeting. It fails on encrypted or watermarked meetings. It uses the WebRTC and Opus reference clients (C++ and TypeScript). [H] Public apps need app verification plus a security assessment, reported as 4–7 weeks. [M] ([Recall.ai](https://www.recall.ai/blog/what-is-the-google-meet-media-api))
  - **Verdict:** not usable for a public event where the participants are outside our control.
- **Live captions with names:** Meet shows live captions with speaker names in its UI, but there is **no official API** for them. Chrome extensions that scrape the caption DOM (the Tactiq-style pattern) work but are unsupported and break when Meet changes its UI. [M]
- **Recordings:** Meet records a single composite MP4 to the organizer's Drive, with **no per-participant tracks**. Recording and transcripts need Business Standard or higher (or the matching Education or Enterprise editions). [M] ([Workspace updates](https://workspaceupdates.googleblog.com/2022/10/google-meet-transcripts.html))
  - Transcripts: the Meet REST API `conferenceRecords.transcripts.entries` returns entries with `participant`, `text`, `startTime` and `endTime`. Entries are deleted 30 days after the conference ends. [H] ([entries](https://developers.google.com/workspace/meet/api/reference/rest/v2/conferenceRecords.transcripts.entries))
  - Steps: in the meeting, open Activities, then Transcripts, then Start (and Recording, then Start). After the meeting, find the Doc and MP4 in "Meet Recordings" in Drive, or fetch them via the API.
- **Quick recipe:** the listener-tab recipe (§7) works directly, because Meet is browser-native.

---

## 4. Microsoft Teams

- **Live per-participant audio:** only through an **application-hosted media bot**, built on the Graph Communications SDK in C#/.NET, running on Windows Server in Azure (not an Azure Web App). It needs the `Calls.AccessMedia.All` and join permissions with tenant admin consent. [H] ([requirements](https://learn.microsoft.com/en-us/microsoftteams/platform/bots/calls-and-meetings/requirements-considerations-application-hosted-media-bots), [concepts](https://learn.microsoft.com/en-us/microsoftteams/platform/bots/calls-and-meetings/real-time-media-concepts), updated 2026-05)
  - Audio is 16 kHz/16-bit in 20 ms frames, with active-speaker IDs per frame. `ReceiveUnmixedMeetingAudio=true` gives up to 4 unmixed buffers for the top active speakers. [H/M] ([AudioSocketSettings](https://microsoftgraph.github.io/microsoft-graph-comms-samples/docs/bot_media/Microsoft.Skype.Bots.Media.AudioSocketSettings.html))
  - Microsoft now states: "Real-time Media bots are not recommended for AI agent scenarios." It points instead to Copilot Studio and post-meeting transcripts. [H]
- **Live captions or transcript:** mid-meeting transcript retrieval through Graph is not supported. [M] ([Q&A](https://learn.microsoft.com/en-au/answers/questions/5870080/microsoft-teams-graph-api-mid-meeting-transcript-p))
- **Recordings:** a composite MP4 only, with no per-participant tracks. Transcripts are available as WebVTT with `<v Speaker>` tags via Graph (`onlineMeeting/transcripts`, which needs the `CallTranscripts.Read.All` or `OnlineMeetingTranscript.Read.All` class of permissions) or can be downloaded from the meeting's Recap tab. The host has to click "Start recording and transcription" in the meeting (More, then Record and transcribe). [H/M] ([transcripts GA](https://devblogs.microsoft.com/microsoft365dev/microsoft-graph-apis-for-microsoft-teams-meeting-transcripts-now-generally-available/), [list transcripts](https://learn.microsoft.com/en-us/graph/api/onlinemeeting-list-transcripts?view=graph-rest-1.0))
- **Quick recipe:** the listener-tab recipe (§7) using Teams on the web in Chrome.

---

## 5. StreamYard

- **Live per-participant audio:** there is no media API. Output is a mixed RTMP broadcast (custom RTMP destinations are on paid plans). [M]
- **Recordings:**
  - **Local recordings**, on all plans (the free plan gets 2 h/month and Recording mode only; paid plans are unlimited): an individual WAV audio file plus video per participant. Each participant's browser records locally and uploads. [H] ([local recording](https://support.streamyard.com/hc/en-us/articles/10725401176596-Local-Recording-of-your-Live-Stream))
  - **Cloud individual audio tracks** are **Advanced plan only**. Enable them in the Studio under Settings, then Recording, then "Record a separate audio file for each participant". This has to be set *before* going live. [H] ([cloud individual tracks](https://support.streamyard.com/hc/en-us/articles/360058316912-Cloud-Recording-Individual-Audio-Tracks))
- **Quick recipe:** a listener guest in Chrome, tab-captured (§7). Alternatively, open the host's own StreamYard studio tab and capture it. Guests are heard there, but the host's own mic is not.

---

## 6. Jitsi and Whereby (brief)

These two are the interesting exception: **their browser SDKs give our own web page per-participant `MediaStream`s**, because we would be the client.
- **Jitsi (lib-jitsi-meet, self-hosted or 8x8 JaaS):** remote tracks arrive per participant, so a web page can run one ASR stream per track with the display name attached. JaaS also offers server-side transcription. [M] ([ljm JaaS example](https://github.com/jitsi/ljm-jaas-example), [webrtcHacks guide](https://webrtchacks.com/the-ultimate-guide-to-jitsi-meet-and-jaas/))
- **Whereby Browser SDK:** `useRoomConnection().state.remoteParticipants[i].stream` is a per-participant MediaStream with `displayName`. [H] ([useRoomConnection](https://docs.whereby.com/reference/react-hooks-reference/useroomconnection))
- **Implication:** if we ever host the call ourselves (a "join the debate on antidebate.xyz" room), per-speaker live audio is trivial and entirely in the browser. The trade-off is that participants are no longer on the platform they know.

---

## 7. Simplest robust recipe today (any platform): the listener tab

What you get: one mixed feed of every *remote* participant, live, in our app's browser. It needs no app approval and no bot.

Hardware: ideally a second laptop (the "listener"), or at least a separate Chrome window on the operator's machine. Use Chrome or Edge, because only Chromium browsers support audio in `getDisplayMedia`. [H] ([Chrome docs](https://developer.chrome.com/docs/extensions/how-to/web-platform/screen-capture), [caniuse](https://caniuse.com/mdn-api_mediadevices_getdisplaymedia_audio_capture_support))

Steps for the host or operator:
1. On the listener laptop, open the meeting link in **Chrome** and choose the browser option:
   - Zoom: "Join from your browser".
   - Meet and Teams: the web version.
   - Riverside and StreamYard: join as a guest.
2. Name the participant "Map (listening)". **Mute the mic and turn the camera off.** Leave the speaker volume up; tab capture does not depend on the device volume.
3. In another tab, open the app's capture page and click **Start listening**. In Chrome's picker, choose the **"Chrome Tab"** view, select the meeting tab, and make sure **"Also share tab audio"** is on. Then click Share.
4. Keep the meeting tab open. Don't mute the tab, and don't let the laptop sleep (plug it in and disable sleep).

Why a separate listener participant matters: tab audio contains only what that tab *plays out*, which is every other participant but not the tab owner's own microphone. If the facilitator captures their own meeting tab, their own voice is missing. A muted listener participant hears everyone, including the facilitator. [M, based on how WebRTC playback works]

Why "Chrome Tab" and not "Entire screen": on macOS, system audio via `getDisplayMedia` only exists from Chrome 141 on macOS 14.2+. Tab audio has worked on every OS since Chrome 74. [M] ([addpipe, 2026-05](https://blog.addpipe.com/getdisplaymedia-allows-capturing-the-screen-with-system-sounds-on-chrome-on-macos/))

Desktop-app alternative (for example when Zoom's web client is disabled): route the app's output through a virtual device (BlackHole 2ch is free; Loopback is paid) and capture it in the browser with `getUserMedia` for that device. This is harder for a non-technical host, because it means installing an audio driver and setting a Multi-Output device so the host can still hear. It is the fallback, not the default. [M]

Attribution with this recipe: it is a mixed feed, so we run streaming diarization with **pre-enrolled voiceprints** (30 s per debater at sound check). The capture design in ARCHITECTURE §Capture already covers this. Expect lower attribution confidence than channel-per-speaker. Overlapping speech is the main failure case and gets held for the operator to confirm. [L, until measured]

---

## 8. What this means for the app

1. **For 2026-10-11 itself, this is mostly moot.** Lighthaven is in person, and the capture path is the multichannel interface. Everything below is about remote and hybrid debates and replaying online Anti-Debates.
2. **Add a browser capture adapter as the platform-agnostic default.** Build a `/capture` page that takes `getDisplayMedia({audio:true, video:true})` (keep video to satisfy Chrome, then drop the video track), resamples to 16 kHz, and streams to the ASR. Label the source `mixed` so fusion forces diarization plus voiceprints and holds low-confidence turns (ATTRIBUTION pending). This works for Zoom web, Meet, Teams, Riverside and StreamYard with one set of instructions.
3. **Better quick win: the companion mic link (my proposal; the mechanism is standard, but it is not vendor-verified for this use).**
   - Each remote debater also opens `antidebate.xyz/mic/<token>` in their browser. It captures *their own* mic via `getUserMedia` and streams it as that person's channel, independent of the meeting platform.
   - That gives true channel-per-speaker attribution, the same model as the in-room interface, with no platform approval. It is the Riverside idea, done live.
   - Risks: debaters must wear headphones (browser echo cancellation only cancels that browser's own playback, not Zoom's). Some OS or mic combinations dislike two apps sharing one mic. It adds one more step for each debater.
   - Pair it with the listener tab as a fallback mixed channel.
4. **Future robust integration: Zoom RTMS first.** It is the only official API that gives per-participant audio *and* named transcripts, with auto-start and no bot in the meeting. Cost is trivial (about 1–2 credits per debate). It needs a long-running server (the worker, not Vercel functions), a Zoom General App in the host's account, and the Developer Pack. Build an `rtms` source adapter that maps `user_id` to a participant and emits per-channel audio into the existing capture pipeline.
5. **Owning the room is the most robust option of all.** Hosting the call ourselves on Whereby or Jitsi (or Zoom Video SDK plus RTMS) gives per-participant streams directly in our page. That is a bigger product decision.
6. **Skip Meet Media API** (every participant must be enrolled in the Developer Preview) and **Teams media bots** (C#/Windows/Azure, and Microsoft discourages them for AI agents) unless a client requires those platforms. For those, use the listener tab live and the post-meeting transcript APIs for the canonical pass.
7. **Canonical post-call pass:** add an importer that accepts per-participant files and maps file to participant by filename:
   - Zoom local `Audio Record/*.m4a`
   - Riverside WAV tracks
   - StreamYard local WAVs

   Send them through the existing offline transcription with channel = speaker. For Meet and Teams, import the composite MP4 plus the speaker-labelled transcript (the Meet REST entries or the Teams VTT) as the attribution prior.
8. **Host checklist to hand Stephanie** (a one-page version of §7, plus: "If on Zoom, tick *Record a separate audio file for each participant* and record *on this computer*").

### Ranking

**(a) Quick win for October 2026 (remote or hybrid):**
1. Listener tab plus diarization and voiceprints: works on all platforms, today.
2. The same, plus companion mic links for debaters: per-speaker channels, needs about 2–3 days of building.
3. Post-call canonical pass from Zoom local, Riverside or StreamYard per-participant tracks.

**(b) Robust future integration:**
1. Zoom RTMS adapter.
2. Our own room (Whereby, Jitsi, or Zoom Video SDK).
3. Riverside or StreamYard per-track import automation (Riverside Business API).
4. Meet Media API, once it leaves preview.
5. Teams media bot (only if a client demands it).

### Stale or unverified items to recheck before relying on them
- Zoom per-participant audio in *cloud* recording for Meetings (sources conflict).
- The dollar price per RTMS credit (not on a primary page I could fetch).
- Riverside plan names and prices (they changed in 2026; the plan is now "Grow", not "Standard").
- Meet Media API preview status (docs dated 2026-09-03).
- Chrome macOS system-audio behaviour (Chrome 141+).
