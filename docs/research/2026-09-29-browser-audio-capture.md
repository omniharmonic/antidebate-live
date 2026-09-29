# Browser-only audio capture for speaker attribution

Research date: 2026-09-29. Question: what can a host's browser tab (Chrome first, also Safari, Firefox, Edge) capture live, and how do we get per-speaker audio into it?

Companion doc: `2026-09-29-video-call-audio.md` covers per-participant audio from Zoom, Meet and Teams. This doc covers the browser capture layer itself.

Confidence tags: **[H]** stated in a primary source (spec, MDN, vendor docs, browser bug tracker, blink-dev) that I fetched today. **[M]** from a reputable secondary source that tests browsers (for example addpipe.com, which publishes dated browser tests), or several consistent sources. **[L]** inferred, or sources conflict. *Stale?* means the source is older than 2024.

---

## Summary

1. **Several USB mics at once works in Chrome, Edge and Firefox. Safari on macOS supports it only from Safari 26.4 (March 2026).** Each mic needs its own `getUserMedia` call with `deviceId: {exact}`. [H]
2. **Chrome and Edge deliver at most 2 channels from a single device.** Channels 3 and up of a multichannel interface cannot be reached. The Chromium feature request has been open since 2015 (status New, P3). Firefox can deliver more than 2 channels, at least on macOS. Safari delivers mono only. [H/M]
3. **The best in-room option in Chrome:** a 2-input interface (for example a Scarlett 2i2, or inputs 1 and 2 of a 4i4) with processing disabled and `channelCount: 2`, split into L and R with a `ChannelSplitterNode`. That gives two isolated speakers on one hardware clock. For 3 or 4 speakers, use two 2-channel interfaces, or several USB mics, with one `getUserMedia` call per device. [M]
4. **Tab audio** (`getDisplayMedia`, "Also share tab audio") works in Chrome and Edge on macOS, Windows, Linux and ChromeOS. **System audio** works on Windows and ChromeOS when sharing the entire screen, and on macOS from **Chrome 141 with macOS 14.2 or later**. Firefox and Safari give no audio from `getDisplayMedia`. Mobile has no `getDisplayMedia`. [H/M]
5. **Phones as wireless lavaliers are unreliable.** iOS mutes capture when the tab is backgrounded or another tab starts capturing. Android Chrome has an open bug: capture stops about 5 s after going to the background. Only promise this with the screen on, the page in front, and a Wake Lock. [M/H]
6. **Turn off `echoCancellation`, `noiseSuppression` and `autoGainControl` on every ASR-bound track.** Google's STT guidance says noise reduction "typically reduces recognition accuracy" and says not to use AGC. Isolate speakers with the hardware (close dynamic or directional mics), not with browser DSP. [H]

---

## 1. Several audio input devices on one page

| Browser | Several mics at once | Source |
|---|---|---|
| Chrome / Edge (macOS, Windows) | Yes. One `getUserMedia` call per device, merged or kept separate in Web Audio. AWS published a two-mic browser demo (June 2025) tested on Chrome 135. [H] | [AWS blog](https://aws.amazon.com/blogs/machine-learning/stream-multi-channel-audio-to-amazon-transcribe-using-the-web-audio-api/) |
| Firefox | Yes, since **Firefox 101** (bug 1238038 fixed; "use as many microphones as you want at the same time"). [H] | [Bugzilla 1238038](https://bugzilla.mozilla.org/show_bug.cgi?id=1238038) |
| Safari macOS | Yes, since **Safari 26.4 (2026-03-24)**: "On macOS, `getUserMedia` now supports capturing audio from multiple microphones simultaneously while intelligently managing echo cancellation." The same release fixed a bug where `getUserMedia` with echo cancellation disabled "could unintentionally affect existing audio tracks." Before 26.4, a second capture muted the first. [H] | [WebKit: Safari 26.4](https://webkit.org/blog/17862/webkit-features-for-safari-26-4/) |
| Safari iOS | No. A new capture on a different device stops the previous one ("the current API we are using does not allow to capture both at the same time"). [H, *stale?* 2022 comment] | [WebKit 179363](https://bugs.webkit.org/show_bug.cgi?id=179363), [WebKit 180748](https://bugs.webkit.org/show_bug.cgi?id=180748) |

**Pattern.** Call `getUserMedia({audio: true})` once to unlock device labels. Then `enumerateDevices()`. Then, for each chosen mic, call `getUserMedia({audio: {deviceId: {exact: id}, echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: {ideal: 2}}})`. Then `track.getSettings()` to confirm what was actually applied. `deviceId` can't be changed later with `applyConstraints`. [H] ([W3C Media Capture](https://w3c.github.io/mediacapture-main/getusermedia.html), [MDN getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia))

**Processing interactions.**
- Chrome's audio processing module is mono. With any processing on, input is downmixed. Turning processing off is what allows stereo capture (Chromium developer comment, 2015). [H, *stale?*] ([chromium-bugs thread](https://groups.google.com/a/chromium.org/g/chromium-bugs/c/OUWw8OtkcGc))
- Stereo capture needs `echoCancellation`, `noiseSuppression` and `autoGainControl` all set to `false`. This applies to both Chrome and Firefox (tested May 2026). [M] ([addpipe stereo](https://blog.addpipe.com/recording-true-stereo-audio-using-getusermedia/))
- Chrome 141 added `echoCancellation: "all" | "remote-only"`. That doesn't matter here, because we want `false`. [H] ([Chrome 141](https://developer.chrome.com/release-notes/141))
- macOS hardware noise suppression is a system-wide setting per device. Chrome's echo-cancellation path toggles it for all streams on that mic. [H, *stale?* 2017] ([Chrome blog](https://developer.chrome.com/blog/disabling-hardware-noise-suppression))

**Sample rate.**
- Chrome resamples a `MediaStreamSource` into the `AudioContext` rate. [M]
- Firefox threw "Connecting AudioNodes from AudioContexts with different sample-rate is currently not supported" until **Firefox 148** fixed it (bug 1674892). On older Firefox, create the `AudioContext` without a `sampleRate`. [H] ([Bugzilla 1674892](https://bugzilla.mozilla.org/show_bug.cgi?id=1674892))
- The Zoom PodTrak P4 runs at 44.1 kHz and most interfaces run at 48 kHz, so don't assume 48 k. Resample to 16 kHz in an AudioWorklet or on the server. Don't depend on the `sampleRate` constraint. [M]
- **Clock drift:** two separate USB devices run on independent clocks. Over 90 minutes, expect the two tracks to drift apart by a small amount (tens to hundreds of ms). Timestamp each device stream separately. One interface with several channels avoids the problem. [L, inferred from how USB audio works]

## 2. Multichannel from one device (interfaces, podcast mixers)

**Chrome and Edge: 2 channels at most, and in practice the device's first two channels.**
- [Chromium 40403559](https://issues.chromium.org/issues/40403559), "Support multichannel input from audio device via getUserMedia()", opened 2015-01-30. Its tracker payload shows type Feature Request, status New, priority P3, last touched 2026-06-11. It has not shipped. [H: I read the tracker's JSON directly, because the page needs a login to render]
- A July 2026 report against Chromium/Electron found that `channelCount: 1` gives "only the device's first channel", so a mic on channel 2 or higher is dropped. The fix they proposed is `channelCount: 2`, reading `input[1]`. [M] ([amical #165](https://github.com/amicalhq/amical/issues/165))
- **Consequence:** a macOS aggregate device, or a 4-to-16-channel interface, doesn't help in Chrome. Only channels 1 and 2 arrive. [M]

**Firefox:** Firefox supports `channelCount` greater than 2, depending on the OS. A Firefox audio developer closed bug 1393401 as WORKSFORME in 2024: "it depends on the OS… works well here on macOS." [H] ([Bugzilla 1393401](https://bugzilla.mozilla.org/show_bug.cgi?id=1393401), [Mozilla blog 2017](https://blog.mozilla.org/webrtc/channelcount-microphone-constraint/) *stale?*) Windows and Linux are untested. [L]

**Safari:** mono only ("Safari currently supports only 1-channel audio", May 2026). [M] ([addpipe](https://blog.addpipe.com/recording-true-stereo-audio-using-getusermedia/))

**What this means for specific hardware:**

| Device | USB input to computer | What Chrome gets |
|---|---|---|
| Focusrite Scarlett 2i2 / 4i4 (4th gen) | 4i4: inputs 1–2 are mic/combo preamps, 3–4 are line inputs, and it has loopback. [H] ([Focusrite](https://userguides.focusrite.com/hc/en-gb/articles/18676425481362-Scarlett-4i4-Hardware-Features)) | **Mic 1 on L and Mic 2 on R: two isolated speakers.** Inputs 3 and 4 are unreachable. [M] |
| Zoom PodTrak P4 | A 2-in/2-out USB interface at 44.1 kHz/16-bit. The 4 mic inputs are separate only on the SD card. [M] ([Zoom P4](https://zoomcorp.com/en/us/podtrak-recorders/podcast-recorders/podtrak-p4/)) | The stereo mix only. Not per-speaker. |
| Zoom PodTrak P4next | 12 in / 2 out over USB, 48 kHz/24-bit. [H] ([Zoom P4next](https://zoomcorp.com/en/us/podtrak-recorders/podcast-recorders/podtrak-p4next/)) | Channels 1–2 only. Which signal is on 1–2 (the mix, or mic 1 and 2) is unverified. [L] |
| Zoom PodTrak P8 | Reported as 2-in to the computer (sources conflict). [L] | The mix. |
| RØDECaster Pro II / Duo | Multitrack mode: 16 channels on USB 1. Channels 1–2 are the main mix, then the mono combo inputs. On **Windows**, the RØDECaster Virtual Devices driver exposes each fader as a separate input device. [M] ([RØDE layout](https://help.rode.com/hc/en-us/articles/15412830674959-The-R%C3%98DECaster-Pro-II-Duo-Multitrack-Channel-Layout), [RØDE virtual devices](https://help.rode.com/hc/en-us/articles/15514570006927-The-R%C3%98DECaster-Pro-II-Duo-Virtual-Devices-Multitrack-Output)) | macOS: the main mix only. Windows with Virtual Devices: **one device per fader, so several `getUserMedia` calls give per-speaker audio.** [M, test first] |

**Split recipe (Chrome):**

```
src = ctx.createMediaStreamSource(stream)   // track settings: channelCount 2
split = ctx.createChannelSplitter(2)
src -> split
split[0] -> worklet A (speaker A)
split[1] -> worklet B (speaker B)
```

Check `track.getSettings().channelCount === 2` before trusting the split. If processing ends up on, Chrome silently downmixes to mono.

## 3. Tab and system audio (`getDisplayMedia`)

| | Tab audio | Window audio | Whole-system audio |
|---|---|---|---|
| Chrome / Edge, Windows | Yes (Chrome 74+) | Via the `windowAudio` hint from Chrome 141 [L on exact OS coverage] | Yes, when sharing **Entire Screen** (Chrome 74+) |
| Chrome / Edge, macOS | Yes | `windowAudio` from Chrome 141 [L] | **Chrome 141+ on macOS 14.2+**. Chrome 140 had no toggle. [M] |
| Chrome, Linux / ChromeOS | Yes | — | ChromeOS: yes (screen). Linux: [L] |
| Firefox | No audio from `getDisplayMedia` at all | No | No |
| Safari | No audio | No | No |
| Mobile (all) | `getDisplayMedia` isn't supported on mobile | | |

Sources: [MDN getDisplayMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia) (audio "might contain no audio track even when `audio` is `true`"), [caniuse audio capture](https://caniuse.com/mdn-api_mediadevices_getdisplaymedia_audio_capture_support) (Chrome 74+, Edge 79+; Firefox and Safari none), [addpipe demo](https://addpipe.com/getdisplaymedia-demo/), [addpipe macOS system audio](https://blog.addpipe.com/getdisplaymedia-allows-capturing-the-screen-with-system-sounds-on-chrome-on-macos/) (2026-02, updated 2026-05), [Chrome screen-sharing controls](https://developer.chrome.com/docs/web-platform/screen-sharing-controls), [Chrome 141 beta](https://developer.chrome.com/blog/chrome-141-beta) (`windowAudio`, `restrictOwnAudio`).

**Options worth setting:**
- `audio: {echoCancellation: false, noiseSuppression: false, autoGainControl: false, suppressLocalAudioPlayback: false}`
- `systemAudio: "include"` and `selfBrowserSurface: "exclude"`
- `restrictOwnAudio: true` (Chrome 141+), so any sound our own page plays is excluded from captured system audio.
- **Audio pre-selection hint:** Chrome 152+ (blink-dev Intent to Ship, 2026-07-22) adds a `DisplayMediaStreamOptions` hint that pre-ticks the audio checkbox on the Screen and Window panes. The Intent calls the attribute `audioPreference`, while a merged PR (2026-09-19) uses `audioSelection: "preferred"`. **The name is unverified [L]: check it against chromestatus or the spec before shipping.** Unknown members are ignored, so passing it is harmless. ([blink-dev](http://www.mail-archive.com/blink-dev@chromium.org/msg17022.html), [PR](https://github.com/murtaza-nasir/speakr/pull/387))
- Calling it needs a user click (transient activation) and HTTPS. Permission is never persisted, so the host goes through the picker every session. [H] (MDN)

**Host steps (Chrome):**
- **Tab:** Click "Capture call audio" and choose the **Chrome Tab** pane. Pick the tab with the call or stream. Leave **"Also share tab audio"** ticked (pre-ticked on the Tab pane), then Share. Keep that tab open. Muting the tab is fine, because captured audio still flows while local playback continues (`suppressLocalAudioPlayback: false`). [M]
- **System audio, Windows:** Choose **Entire Screen**, tick **"Also share system audio"** (unticked by default before Chrome 152), then Share. [M]
- **System audio, macOS:**
  1. Update to Chrome 141 or later on macOS 14.2 or later.
  2. Open System Settings, then Privacy & Security, then **Screen & System Audio Recording**, and enable Google Chrome. Relaunch Chrome.
  3. In the picker, choose Entire Screen (or a Window) and turn on **"Share system audio"**. [M]

  System audio includes notifications and every app, so the host should turn on Do Not Disturb.

## 4. Virtual audio routing (Zoom desktop app and similar into the browser)

Use this only when §3 isn't available: Firefox or Safari, macOS older than 14.2, or when the host wants a named input device instead of screen sharing.

| Tool | OS | Cost | Status |
|---|---|---|---|
| **BlackHole** (Existential Audio) | macOS 10.10+ (Intel and Apple Silicon) | Free, GPL-3.0 | v0.7.1, 2024-07-03. Variants: 2, 16, 64, 128 and 256 channels. `brew install blackhole-2ch`. [H] ([GitHub](https://github.com/ExistentialAudio/BlackHole), [releases](https://github.com/ExistentialAudio/BlackHole/releases)) |
| **Loopback** (Rogue Amoeba) | macOS 14.5–27 | **$99** (upgrade $49). The trial overlays noise after 20 minutes of use. [H] | v2.5.0, 2026-08-31. Captures per-app sources (for example only zoom.us) into a virtual device, with built-in monitoring. ([Loopback](https://rogueamoeba.com/loopback/), [buy](https://rogueamoeba.com/loopback/buy.php), [trial](https://rogueamoeba.com/support/knowledgebase/?showArticle=Misc-AboutAppTrials&product=Loopback)) |
| **VB-CABLE** (VB-Audio) | Windows XP–11 (incl. ARM64). A macOS build exists (2021, *stale?*) | Donationware | Windows pack 45 (2024-10). Creates "CABLE Input" (playback) and "CABLE Output" (recording). Install as admin, then reboot. [H] ([VB-CABLE](https://vb-audio.com/Cable/)) |
| **Voicemeeter** (Standard / Banana / Potato) | Windows only | Donationware (prompts after 30 days) | A virtual mixer with virtual I/O. Use it when you need to hear the audio and route it at the same time. [H] ([Voicemeeter](https://vb-audio.com/Voicemeeter/)) |

**macOS with BlackHole (free):**
1. Install BlackHole 2ch.
2. Open **Audio MIDI Setup**. Click **+**, then **Create Multi-Output Device**. Tick your speakers or headphones **and** BlackHole 2ch. Set the speakers as the clock source, and tick **Drift Correction** on BlackHole.
3. In Zoom, go to Settings, then Audio, then Speaker, and choose the Multi-Output Device. (Or right-click it in Audio MIDI Setup and choose "Use This Device For Sound Output" to route all system audio.)
4. In our app, pick **BlackHole 2ch** as an input device.
5. Note: macOS can't change the volume of a Multi-Output device. Set the level per device in Audio MIDI Setup. [H]

**macOS with Loopback ($99):** create a new virtual device, add **zoom.us** as a source, and add your headphones under Monitors. Pick that device in the app. This is cleaner because it captures only Zoom, not notifications. [H/M]

**Windows with VB-CABLE:**
1. Install VB-CABLE and reboot.
2. In Zoom, go to Settings, then Audio, and set **Speaker** to **CABLE Input**.
3. To still hear the call: open Sound settings, then More sound settings, then Recording. Open **CABLE Output**, then Properties, then Listen, tick **Listen to this device**, and choose your headphones. (This is a standard Windows feature and isn't in VB-Audio's docs. [M])
4. In the app, pick **CABLE Output** as an input device.

Alternatively, use Voicemeeter: set Zoom's output to "Voicemeeter Input", A1 to the headphones, B1 to the virtual output, and choose "Voicemeeter Out B1" in the browser. [M]

**Caveat:** any routed call audio is still a mixed feed. It doesn't identify speakers. Attribution then depends on diarization and voiceprints (see the companion doc).

## 5. Phones as speaker devices

- **HTTPS is required.** `navigator.mediaDevices` is `undefined` on insecure origins. The `localhost` exception doesn't help phones on LAN, so serve from the real domain (antidebate.xyz) or an HTTPS tunnel. [H] (MDN, last modified 2025-11-30)
- **iOS (Safari, and every iOS browser, because all of them use WebKit):**
  - Only one tab can capture at a time. Tracks in other capturing tabs are muted. [H, *stale?* 2017] ([WebKit blog](https://webkit.org/blog/7763/a-closer-look-into-webrtc/))
  - Capture is muted when the page or app is backgrounded. WebKit and Apple forums document muting on background and on audio-session interruptions such as a phone call or Siri. [M] ([WebKit 180748](https://bugs.webkit.org/show_bug.cgi?id=180748), [Apple forum](https://developer.apple.com/forums/thread/689182))
  - Mono only. [M]
  - Safari's permissions are the least persistent of the browsers, so expect a re-prompt on every visit. [M] ([addpipe 2026](https://blog.addpipe.com/getusermedia-getting-started/))
  - The Screen Wake Lock API works in Safari (and in home-screen apps since iOS 18.4). It is released whenever the page is hidden and has to be re-requested on `visibilitychange`. [H] ([web.dev](https://web.dev/blog/screen-wake-lock-supported-in-all-browsers))
- **Android Chrome:**
  - [Chromium 374374232](https://issues.chromium.org/issues/374374232), "WebRTC microphone stops working about 5 seconds in background", was filed 2024-10 against Chrome 130. The tracker shows it open (Assigned). [H] Screen lock counts as background.
- **Realistic constraints for phone-as-lavalier:**
  - The phone stays unlocked with the screen on and our page in front, on charge, with Wake Lock held.
  - The mic is 20–40 cm from the mouth in a shirt pocket or on the table. That gives worse isolation than a lav.
  - Transport runs over venue Wi-Fi. For WebRTC you need a TURN server for restrictive networks. For chunked upload, send AudioWorklet PCM or Opus over a WebSocket (MediaRecorder gives webm/Opus in Chrome; Safari 26 added PCM/ALAC in MediaRecorder [H], [WebKit 26.0](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/)).
  - Clocks differ per phone, so alignment needs server timestamps plus cross-correlation against a room mic.
  - Watch the `mute` and `ended` events and show a "phone X lost audio" alarm in the console.
  - Verdict: use this as a fallback or an extra, never the primary live path. [M]

## 6. Echo and bleed in the room

- **Mic choice:** for several talkers where bleed matters, use **directional** mics. Shure says omnidirectional mics "are not recommended for situations with multiple talkers where feedback and bleed are concerns." [H] ([Shure lavalier guide](https://www.shure.com/en-US/insights/how-to-choose-the-best-lavalier-microphone))
  - Best: a **dynamic cardioid handheld, or a headset, 5–10 cm from the mouth.** Close placement with fast level falloff gives the largest own-voice to neighbour ratio.
  - Next best: a cardioid or supercardioid lav.
  - Worst: an omni lav, which is the default on most wireless kits.
- **Spacing:** the 3:1 rule. The distance between mics should be at least 3 times each mic's distance to its talker. [H] ([Shure](https://www.shure.com/en-US/insights/of-mics-and-monitors-live-sound-reinforcement-tips-for-choirs))
  - Seat debaters apart, and aim each mic's null (the back of a cardioid) toward the other debater.
  - Keep PA speakers out of the mics' front lobes.
  - If the venue mixer is used, take **pre-fader direct outs** or aux sends into the interface, not the house mix.
- **Browser DSP:**
  - Google: "Applying noise-reduction signal processing to the audio before sending it to the service typically reduces recognition accuracy". "Do not use automatic gain control (AGC)". "Position the microphone as close as possible". "If… each person is recorded on a separate channel, send each channel separately." [H] ([Google STT best practices](https://docs.cloud.google.com/speech-to-text/docs/best-practices))
  - Browser AEC also can't cancel another talker's live voice. It only removes what this machine is playing. So it doesn't help with bleed, and it forces a mono downmix in Chrome.
  - Keep all three constraints off. Handle bleed in software instead: per-channel energy gating, where the loudest channel owns the frame. The capture service already plans a channel ownership margin for this.
  - The one exception is a phone or laptop mic in a room where a speaker plays the remote call. There, `echoCancellation: true` on that single device is better than feeding the call back into ASR. [M]

---

## What this means for the app

**Recommended capture modes**

| Scenario | Mode | Speaker attribution |
|---|---|---|
| **In-room, 2 debaters (Lighthaven default)** | One 2-input interface (Scarlett 2i2/4i4, inputs 1–2), `channelCount: 2`, processing off, split L/R. The host laptop runs Chrome. | Channel ownership (strong). |
| In-room, 3–4 mics (plus moderator and audience) | Two 2-channel interfaces, or 3–4 USB mics, each opened with its own `getUserMedia` call in Chrome or Edge. Or (Windows only) a RØDECaster Pro II with Virtual Devices. | Channel ownership, with drift handled per stream. |
| In-room, a 4+ channel interface is the only hardware | Chrome can't do it. Either Firefox on macOS with `channelCount: N` (test first), or the native capture service (`services/capture`, CoreAudio) as planned. | Channel ownership. |
| Remote call (Zoom/Meet) in a browser tab | `getDisplayMedia` with tab audio (Chrome/Edge, any desktop OS). | Diarization and voiceprints (mixed feed). |
| Remote call in the Zoom desktop app | Chrome system audio (Windows, or macOS 14.2+ with Chrome 141+). Or BlackHole/Loopback (macOS) or VB-CABLE (Windows) as an input device. | Diarization (mixed). |
| Host has no hardware | One laptop mic, processing off. | Diarization only. Label the result low-confidence. |

**Host setup checklist (in-room, Chrome):**
1. Plug in the interface. Put Debater A's mic on input 1 and Debater B's on input 2. Turn off the interface's own "Air", auto-gain and direct-monitor-to-USB mixing features. Set gain so peaks sit around −12 dBFS.
2. Open the app over HTTPS, allow the microphone, and choose the interface in the device picker.
3. The app shows two meters labelled L and R. Each debater speaks in turn, and the host confirms which meter moves. This writes the channel map.
4. The app checks `getSettings()`: `channelCount` is 2, and echo cancellation, noise suppression and auto gain are all false. If not, it blocks with a specific error.
5. Turn on Do Not Disturb, and keep the laptop plugged in with this tab in front.

**What NOT to promise:**
- Don't promise more than 2 channels from one interface in Chrome, Edge or Safari. Don't claim a macOS aggregate device helps in Chrome.
- Don't promise that a PodTrak P4/P8 gives per-speaker audio over USB. It sends a mix.
- Don't promise system or tab audio capture in Firefox or Safari, or any `getDisplayMedia` on phones.
- Don't promise that phones work as lavs with the screen locked, the app backgrounded, or on iOS with a second capturing tab. Don't promise several mics at once on iOS.
- Don't promise that browser noise suppression or echo cancellation "cleans up" bleed. It lowers ASR accuracy and doesn't remove the other debater.
- Don't promise the audio-preselect hint by name until the attribute name is verified.
- Don't promise Safari multi-mic below 26.4, or Safari stereo at all.

**To verify on hardware before 2026-10-11** (each takes about 10 minutes):
- A Scarlett L/R split in Chrome stable. Confirm the split channels are true inputs 1 and 2, not a summed stereo signal.
- Two USB mics at once in Chrome on the host's laptop, including drift over 90 minutes.
- Chrome system audio on the host's macOS version.
- Which signals the PodTrak P4next places on USB channels 1–2.
