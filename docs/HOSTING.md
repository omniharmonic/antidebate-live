# Hosting a session

For facilitators (Stephanie, Liv). Everything runs in Chrome on a laptop. Live sessions and recordings are transcribed on your own laptop, and the analysis is paid for by your own Anthropic account.

## Message to send

> Hi Stephanie and Liv. You can now map a debate yourselves, live or from a recording, no help from me needed. Open https://antidebate.xyz/host in Chrome on a laptop and sign in with the host password I sent you separately. The page walks you through the rest: connecting an Anthropic key (you pay Anthropic directly; about $12–15 for a 90-minute debate (measured 2026-09-28), so $25 of credit is comfortable), then preparing the laptop once on good Wi-Fi. Please do the Anthropic account and the laptop preparation a day or more ahead. The full step-by-step guide is attached. For a live debate, the new-session form offers three setups (a mic for each speaker, a video call, or one mic in the room); the guide has the hardware list and steps for each. For a recording, you choose the file.

## Set up on a fresh laptop

1. Open **antidebate.xyz/host** in Google Chrome (Microsoft Edge also works). Other browsers are not supported.
2. Enter the host password you were sent. The laptop stays signed in for 30 days. On a shared laptop, choose **Sign out** in the bar at the top when you finish.
3. Connect your Anthropic key. The page (`/host/key`) shows the same steps:
   1. Create an account at console.anthropic.com. Do this a few days before your event: new accounts can start with lower limits.
   2. Open **Billing** and buy credits. $25 is a comfortable start. A 90-minute debate used about $12–15 in our measurements (2026-09-28).
   3. Open **API keys**, choose **Create key**, and name it "antidebate". Optional: create it in its own workspace and set a monthly spend limit there.
   4. Copy the key (it starts with `sk-ant-`), paste it into the page and choose **Check and save**. The check makes one tiny request to Anthropic to prove the key, the credit and the connection.

   The key stays in this browser and goes only to Anthropic, never to antidebate.xyz. Anyone who uses this browser profile can run sessions on the key. Choose **Forget key** when you finish on a shared computer.
4. **Prepare this laptop.** On the home page choose **Prepare this laptop**. Do it once, on good Wi-Fi, ideally the day before. It:
   - checks the browser;
   - downloads the transcription model once and keeps it on the laptop. The model is about 670 MB. It runs on the laptop's CPU, using all its cores;
   - runs a speed test (5 seconds to warm up, then 30 seconds timed);
   - loads speaker separation (about 58 MB).

   When all four rows say Ready, the page shows "This laptop is ready". If the speed test says the laptop is under 2× real time, recordings take longer than their own length there.

## Process a recording

1. Get the recording as a file. The site cannot fetch YouTube links: YouTube blocks servers from downloading. Ask the creator for their own copy, or download the video first with a tool such as yt-dlp. An .mp4, .m4a, .mp3 or .wav file works best.
2. Home page, **Process a recording**. Enter the title, choose the format, list the participants and their seats, keep "A recording" as the audio source, choose the file and choose **Create and start**.
3. **Name the voices.** The laptop separates the recording into voices. For each voice, play the sample stretches and choose who it is. A voice marked "Someone else (don't attribute)" stays in the transcript but is never counted as a participant's claim. Choose **Confirm voices and continue**. Voices with under 10 seconds of speech are not listed; they are left unattributed, and the page says how many.
4. Wait while it transcribes and analyses. The page shows the stage: Reading the file, Separating speakers (with the time so far), Name the voices, Transcribing (chunk N of M), Analysing (N of M minutes), then Done. It also shows the estimated spend so far.
5. **Keep the tab open, in front, and the laptop awake.** Closing the tab pauses processing, and Chrome warns you first. A tab in the background is slowed down by Chrome, and the page says so. Nothing that has finished is lost. To resume, open the session from **On this laptop** on the host home page. If the transcript was finished, the analysis continues by itself; otherwise choose the same file again. A different file is refused.

## Share the map

When the stage says **Done: open the map**, choose **Open the map** or **Open the cockpit**. A finished session is not on the public list of antidebate.xyz until you choose **Publish to the public list** on that page (and **Unpublish** takes it off again). The links work either way, so you can check a run before anyone else sees it. The address is `https://antidebate.xyz/s/<session id>/<view>`. The session id is in the address bar. The views:

| View | Address ending | For |
|---|---|---|
| Explore (spatial map) | `/spatial` | Audiences after the fact. The best link to send. |
| Timeline | `/arc` | The pattern of the debate over time |
| Positions | `/positions` | Who stands where |
| Facilitate | `/cockpit` | The facilitator's view |
| Operate | `/console` | Transcript, extraction queue, approvals |

The public views show only what is approved for the audience.

## Live sessions

On the host home page choose **New live session**. Enter the title, format and participants, then choose how the audio reaches the laptop:

- **Each speaker has their own mic**
- **A video call**
- **One mic in the room**

Every live session then goes through the same steps: set up the audio, record each person's voice, rehearse for 30 seconds, and start. The session is created only when you choose **Looks right: start the session**. Before any live session, do **Prepare this laptop** (the model is about 670 MB; on a recent MacBook transcription ran about 8 times faster than real time when we measured it on 2026-09-29). The laptop must stay awake, plugged in, with the tab in front.

### Each speaker has their own mic

Use this when each debater can have their own microphone. It gives the most reliable map, because the app knows who is speaking from which input.

Hardware, from our browser-audio research (2026-09-29):

- **A 2-input USB audio interface** such as a Focusrite Scarlett 2i2. Chrome reads its inputs 1 and 2 as the left and right channels, so debater 1 goes in input 1 and debater 2 in input 2. Use dynamic or directional mics close to each speaker.
- **Chrome reads at most two channels from one device.** Inputs 3 and up of a larger interface cannot be reached. For three or four people, use two 2-input interfaces, or several separate USB mics. The page opens each device separately: choose one device, then use **Add this device** for the next.
- **Recorders that mix.** Some recorders (Zoom PodTrak, RØDECaster on a Mac) send one mixed signal over USB. The PodTrak P4 sends only the stereo mix to the computer, not each mic. If both meters move together whoever speaks, use **One mic in the room** instead. On Windows, the RØDECaster Pro II and Duo can show each fader as a separate input device.
- Separate devices keep separate clocks. Over a long session two devices can drift slightly apart, so one interface with two channels is the safer choice for two debaters.

Steps:

1. Plug the interface into the laptop. Put each debater's mic in its own input. Turn off any auto-gain or "Air" setting on the interface.
2. Choose **Use this device**. Chrome asks to use the microphone: allow it.
3. Ask each person to say their name and watch the meters. For each input, choose who is speaking into it. Each debater needs exactly one input. The moderator can have one too.
4. Choose **Continue**.
5. Voices: ask each person in turn to talk for about 20 seconds (their name and what they hope to get from today), choosing **Record**, then **Stop**. It is recommended, because it lets the app double-check the mics. **Skip** is available in this setup. A person with no input is not recorded.
6. Rehearsal: talk for a moment and check the names against the transcript. Choose **Check again** if you need another 30 seconds, then **Looks right: start the session**.

### A video call

Use this when the debaters are in a call. The app hears the call through a shared browser tab, as one mixed feed, and tells voices apart by their sound. It is a little less certain than separate mics, so expect more lines to wait for you to confirm.

Steps (Chrome or Edge only; other browsers cannot share audio):

1. On the laptop, join the call from a second Chrome window: Zoom's "Join from your browser", or the web version of Meet or Teams; on Riverside and StreamYard, join as a guest. Mute your mic and turn your camera off. Name yourself "Anti-Debate notes" so people know why you are there.
2. Why a separate participant: a shared tab carries only what the tab plays out, which is every other participant but not the tab owner's own microphone. A muted listener in the call hears everyone, including you.
3. In the new-session page choose **Share tab audio**. In Chrome's picker choose the **Chrome Tab** pane, pick the call's tab, and make sure **Also share tab audio** is ticked, then Share. Keep that tab open.
4. If the call is in the Zoom app instead, choose **Share system audio**. This works on Windows (choose Entire Screen and tick the option to share system audio), and on macOS 14.2 or later with Chrome 141 or later. On a Mac, also open System Settings, then Privacy & Security, then Screen & System Audio Recording, and enable Google Chrome, then relaunch Chrome. System audio includes notifications and every app, so turn on Do Not Disturb.
5. Watch the **Call audio** meter, then choose **Continue**.
6. Voices and rehearsal are as above. Every person is recorded from the one call feed, one at a time; no one can be skipped in this setup.

For a cleaner map afterwards, record the call as a separate audio file for each person and process that recording here. In Zoom (desktop app, recording on this computer) tick "Record a separate audio file for each participant" in Settings, then Recording, before the meeting. Riverside records each person separately. StreamYard records each person locally on all plans; its cloud tracks need the Advanced plan and must be switched on before going live.

### One mic in the room

Use this when there is one mic or just the laptop's own mic, and speakers are told apart by voice only. This is the least certain setup: more lines will wait for you to confirm.

Steps:

1. Put the laptop (or the one mic) between the speakers, facing them, away from any loudspeakers.
2. Choose **Use this device**, allow the microphone, and watch the **Input 1** meter.
3. Choose **Continue**. Record each person's voice, rehearse, and start as above.

### During the session

- **Keep the tab in front and the laptop awake** (plugged in, sleep off). Chrome slows a tab in the background, and the page says so. Closing the tab stops capture.
- The status line reads "Listening" with the number of inputs. It also shows how far behind the transcript is.
- **Pause** stops listening and **Resume** continues. **End session** closes the audio and finishes the session.
- **Waiting for you** lists lines the app is not sure about, and new voices. Nothing the app is unsure about reaches the map until you choose who spoke. You can play each line before choosing.
- **Open the map** and **Open the cockpit** open in a new tab while the session is live, so capture keeps running here. Use them from this page rather than typing addresses.
- If the audio stopped (a device unplugged, sharing ended), choose **Resume audio**. After a reload, choose **Click to resume listening**. The browser asks again for the microphone or the tab to share.
- A live session can only be resumed on the laptop that started it.
- After **Session ended**, publishing works as for recordings (see below).

## When something goes wrong

Messages are shown exactly as written on the page.

| Message | Where | What to do |
|---|---|---|
| That password is not right. | Sign-in | Retype it from the message you were sent. Ask Benjamin if it still fails. |
| Too many attempts. Wait ten minutes and try again. | Sign-in | Wait ten minutes, then try once more. |
| Hosting is not set up on this server yet. | Sign-in | Tell Benjamin: the server is missing its host settings. |
| Could not reach the server. Check the internet connection and try again. | Sign-in | Check the Wi-Fi and retry. |
| Sign in as a host first. | Creating a session | Your sign-in expired. Sign in again at antidebate.xyz/host. |
| Anthropic keys start with sk-ant-. Check that the whole key was pasted. | Key | Copy the whole key again from console.anthropic.com. |
| That key wasn't accepted. Copy it again from console.anthropic.com → API keys. | Key | Copy the key again. If you deleted it, create a new one. |
| The account has no credit yet. Add credits under Billing, then check again. | Key | Buy credits in the Anthropic console (Billing), wait a minute, then check again. |
| Anthropic is rate-limiting this key. New accounts start with low limits; wait a minute and check again. | Key | Wait a minute and retry. For a new account, create it days before the event. |
| Anthropic is having trouble right now. Try again in a few minutes. | Key | Retry later. See status.anthropic.com. |
| The browser couldn't reach Anthropic. Check the internet connection and try again. | Key | Check the Wi-Fi. Some networks and browser extensions block api.anthropic.com. |
| Anthropic refused the check (N). | Key | Read the number in the Anthropic docs, or send it to Benjamin. |
| Use Google Chrome (or Microsoft Edge) on a laptop. | Prepare | Open the page in Chrome on a laptop. |
| The download stopped. Choose Download again to resume. | Prepare | Choose **Download again**. It resumes. Stay on good Wi-Fi. |
| The transcription model could not start on this laptop. Reload the page and try again; if it keeps failing, use a different laptop or browser. | Prepare | Reload the page and choose Download again. If it fails again, use another laptop, or Chrome. |
| The speed test did not finish. Choose Run the speed test to try again. | Prepare | Close other tabs and apps, then choose **Run the speed test**. |
| Speaker separation did not load. Reload the page and try again. | Prepare, session | Reload the page and choose **Try again** on the row. |
| Speaker separation could not start. | Prepare, session | Reload the page. Use Chrome. |
| Recordings will take longer than their own length here; live sessions need a faster laptop. | Prepare | A note, not an error. Recordings still work; plan for the wait. |
| Session not created: N | New session | Read the reason after the colon. If it is a sign-in message, sign in again. Otherwise retry. |
| Choose the recording file. | New session | Choose the file before Create and start. |
| Add your Anthropic key first. | Session | Go to /host/key and add your key. |
| Could not open this session (N) | Session | Reload the page and choose **Try again**. If it repeats, tell Benjamin. |
| This session was not found on the server. | Session | The session was not created. Make a new one from the host home page. |
| Could not load this session (N) | Session | Check the connection, reload, choose **Try again**. |
| This browser could not read that file. Try an .mp4, .m4a, .mp3 or .wav export. | Session | Convert the file to one of those formats and start again. |
| That file has no audio we can read. | Session | The file has no audio track. Get a different file. |
| Speaker separation is not available on this page. | Session | Reload the page and choose the file again. |
| That is a different file. This session was started with NAME. | Resume | Choose the same file it was started with, or start a new session. |
| Processing stopped | Session | The message under it says why. Choose **Try again**. Finished chunks are kept, so it continues where it stopped. |
| N analysis requests did not get an answer; those turns stay off the map. | Session | Anthropic did not answer for some turns (limits or connection). The rest of the map is unaffected. The estimated spend still counts what was answered. |
| N events waiting to upload | Session | The laptop has not delivered some results to the server yet. Keep the tab open and online: they upload automatically. When processing has finished, the page shows the reason and a **Retry** button; the session is only Done once they are uploaded. Opening the session page again also uploads them. |
| The server refused these events (N) | Session | Choose **Retry** once. If it repeats, send the number to Benjamin. |
| Your Anthropic key was rejected. Add a working key to continue. | Session | The key was deleted or disabled in the Anthropic console. Choose **Add a working key**, paste a new one; the analysis then continues where it stopped. |
| This tab is in the background. Keep it in front so processing isn't slowed. | Session | Bring the tab back to the front. |
| Choose the recording file to continue. | Session | Choose the file the session was started with. |
| This browser decoded the audio at N Hz, not 16000 Hz. Use Google Chrome or Microsoft Edge. | Session | Open the page in Chrome. |
| The microphone is blocked for this site. Allow it from the icon in the address bar, then try again. | Live setup | Click the icon at the left of the address bar, allow the microphone, and try again. |
| That device is not connected. Plug it in and choose it again. | Live setup | Check the USB cable, then choose the device again. |
| No audio input was found. Plug one in and reload the page. | Live setup | Plug in the interface or mic, then reload. |
| This device gives one channel, so both mics are mixed together. Choose the 2-input interface, or use the one-mic setup. | Live setup | Choose the interface's own device in the list, not a USB mic or a virtual device. If it is a recorder that mixes, use One mic in the room. |
| This device gives one channel. If it is a recorder mixing several mics, use the one-mic setup instead. | Live setup | A note. A single USB mic is fine: it counts as one input. |
| The browser is cleaning up the audio (echo cancellation), which hurts transcription. Reload the page and allow the microphone again. (The same with "filtering out noise" and "adjusting the volume automatically".) | Live setup | Reload and allow the microphone again. If it persists, close other tabs or apps that use the microphone. |
| Each debater needs exactly one input. | Live setup | Choose one input for each debater, and never the same person on two inputs. |
| The shared tab had no audio. Share again and tick "Share tab audio". | Live setup | Choose Share again, pick the **Chrome Tab** pane and tick **Also share tab audio**. Sharing a window or screen without system audio gives none. |
| We heard less than 10 seconds of speech from NAME. Record again. | Live voices | Choose Record and have them talk for about 20 seconds, close to the mic. |
| The transcription model did not load: N. Open Prepare this laptop and try again. | Live rehearsal | Open **Prepare this laptop** and do it again on good Wi-Fi. |
| Speaker separation did not load, so every line will wait for you to confirm who spoke. | Live rehearsal | Live still works, but every line waits for you. Run Prepare this laptop again beforehand. |
| Session not started: N | Live rehearsal | Read the reason after the colon. If it is a sign-in message, sign in again. Otherwise retry. |
| This session was set up on another laptop. Open it there to keep listening. | Live session | A live session can only be continued on the laptop that started it. |
| This session has no stored audio setup on this laptop. | Live session | The laptop's stored setup was cleared. Start a new live session. |
| Audio stopped | Live session | The device was unplugged or sharing ended. Fix that, then choose **Resume audio**. |
| Click to resume listening | Live session | Shown after a reload. Choose it and allow the microphone or the tab again. |
| Input N (NAME) has been silent for a minute while others speak. NAME will be identified by voice until it recovers. | Live session | Check that mic's cable, mute switch and gain. Lines from that person are identified by voice meanwhile, so more may wait for you. Choose **Dismiss** to hide the message. |
| Input N (NAME) is working again. | Live session | Nothing to do. |
| Input N sounds like NAME. Swap inputs N and M? | Live session | Two mics are probably plugged into each other's inputs. Choose **Swap** to exchange them for the rest of the session, or **Dismiss**. |
| Voice matching is not working. Unsure lines are held for you to confirm. | Live session | Lines wait under **Waiting for you** until you choose who spoke. Nothing is lost. |
| A new voice is speaking (Voice N). Name them? | Live session | Choose **Play**, then choose who it is. All of that voice's lines are confirmed at once. |
| Transcription is running more than 4 seconds behind on this laptop. Close other apps, or switch to a faster laptop. | Live session | Close other tabs and apps, plug in the laptop and keep this tab in front. |
| This tab is in the background. Keep it in front so capture isn't slowed. | Live session | Bring the tab back to the front. |
| A line at M:SS was not saved: REASON | Live session | Choose **Retry** beside it. |
| Analysis delayed: N requests did not get an answer; those turns stay off the map. | Live session | Anthropic did not answer for some turns (limits or connection). The rest of the map is unaffected. |
| Your Anthropic key was rejected. Add a working key to continue. | Live session | Choose **Add a working key**. That leaves this page, so the audio stops: after adding the key, open the session from **On this laptop** and choose **Click to resume listening**. Do this before the event, not during it. |
| N events waiting to upload | Live session | Keep the tab open and online; they upload on their own. |
| The session did not finish ending: N | Live session | The page says "Capture has stopped; the session has not finished ending." Capture does not restart. Fix the connection, then choose **Try ending again**. |
| N events are still waiting to upload. Check the connection and try again. | Live session | Reconnect to the internet, then choose **Try ending again**. |

If the tab was closed mid-run, or the laptop slept, open the session from **On this laptop**, choose the same file if asked, and it resumes. The transcript chunks are stored on the laptop, so a resume does not redo them. On another laptop, or after clearing the browser's data, choosing the file continues with the analysis of the transcript already on the server.
