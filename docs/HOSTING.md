# Hosting a session

For facilitators (Stephanie, Liv). Everything runs in Chrome on a laptop. Your recordings are transcribed on your own laptop, and the analysis is paid for by your own Anthropic account.

## Message to send

> Hi Stephanie and Liv. You can now map a recorded debate yourselves, no help from me needed. Open https://antidebate.xyz/host in Chrome on a laptop and sign in with the host password I sent you separately. The page walks you through the rest: connecting an Anthropic key (you pay Anthropic directly; about $12–15 for a 90-minute debate (measured 2026-09-28), so $25 of credit is comfortable), then preparing the laptop once on good Wi-Fi. Please do the Anthropic account and the laptop preparation a day or more ahead. The full step-by-step guide is attached. Live capture from the browser is coming next; today the flow is for recordings.

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
   - downloads the transcription model once and keeps it on the laptop. The button shows the size for this laptop: about 1.3 GB where the graphics chip supports it (it then runs on the graphics chip), about 670 MB otherwise;
   - runs a speed test (5 seconds to warm up, then 30 seconds timed);
   - loads speaker separation (about 58 MB).

   When all four rows say Ready, the page shows "This laptop is ready". If the speed test says the laptop is under 2× real time, recordings take longer than their own length there.

## Process a recording

1. Get the recording as a file. The site cannot fetch YouTube links: YouTube blocks servers from downloading. Ask the creator for their own copy, or download the video first with a tool such as yt-dlp. An .mp4, .m4a, .mp3 or .wav file works best.
2. Home page, **Process a recording**. Enter the title, choose the format, list the participants and their seats, keep "A recording" as the audio source, choose the file and choose **Create and start**.
3. **Name the voices.** The laptop separates the recording into voices. For each voice, play the sample stretches and choose who it is. A voice marked "Someone else (don't attribute)" stays in the transcript but is never counted as a participant's claim. Choose **Confirm voices and continue**.
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

Live capture from the browser is coming next. The New live session button on the host home page is disabled until then.

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

If the tab was closed mid-run, or the laptop slept, open the session from **On this laptop**, choose the same file if asked, and it resumes. The transcript chunks are stored on the laptop, so a resume does not redo them. On another laptop, or after clearing the browser's data, choosing the file continues with the analysis of the transcript already on the server.
