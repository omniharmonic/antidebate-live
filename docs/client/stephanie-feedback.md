# Client feedback: Stephanie Lepp (Synthesis Media)

**Received:** 2026-09-28, via the proposal page's feedback form ([docs/history/2026-09-25-proposal-page.html](../history/2026-09-25-proposal-page.html)).
**Recorded by:** Benjamin Life (@omniharmonic)
**Status:** These are baseline requirements and defaults for her Oct 11 event. The product vision goes beyond them (see [PRD](../PRD.md), decision D1 in [README](../README.md)).

## Her answers, verbatim

```
Audience sees the map: Only me, as facilitator
Debaters see it while speaking: No
Setting: In person

Features:
  Same word, different meanings: Nice to have
  The crux: Must have
  Steelman check: Nice to have
  Higher ground: Must have
  Facilitator prompts: Must have
  Audience phone view: Skip
  Take-home explorer: Nice to have

Rounds: Here's the format -- see 'shorter' or 'longer' depending on how much detail you want: https://www.anti-debate.org/how-to-guide.html
Date, venue, audience: Sunday 10/11 from 2-3:30pm at the Progress Conference: https://rootsofprogress.org/conference/
Past recordings: https://www.synthesismedia.org/p/anti-debate-on-ai-governance-dean
Consent: I don't know but I can ask them
What makes it a yes / worries: Clear yes: that it adds *clarity* -- clarifies the arguments being made, and the points of disagreement & synthesis

Clear no: it muddles the experience, and people aren't sure what to pay attention to (whether the screen or the live Anti-Debate)

Additionally: But ultimately....feels like we need to try it before we know all the answers! Would it be possible for you to feed existing anti-debates into it and see what comes out? E.g. this one: https://www.synthesismedia.org/p/anti-debate-on-ai-governance-dean

Or others from the anti-debate playlist: https://www.youtube.com/playlist?list=PLRN1pe0US2hS-mWZAiYJ8OMII8BcB6UXc
```

## What it means for the build

| Her input | Oct 11 default | Product implication |
|---|---|---|
| Audience sees: only me | Every audience channel at dial level 0 ("Dark") | The dial (levels 0–5, per channel) still exists; she can raise it live if she chooses |
| Debaters see it: no | No debater-facing surface | Optional steelman-confirmation tablet stays off |
| In person | Multichannel mics; channel gate + voiceprints + operator | Remote/hybrid comes in R3 |
| Must-haves: crux, higher ground, facilitator prompts | The four cockpit quadrants: crux, higher ground, shared ground, prompt | These have the strictest quality gates (QUALITY §4) |
| Nice-to-haves: drift, steelman, take-home explorer | Drift on expand; steelman in the ledger strip; playback after the event | Playback is a first-class product (R2, 10/25) |
| Skip: audience phone view | Off | Built in R3 for other facilitators |
| Clear yes = clarity; clear no = muddle | Glance-first cockpit, operator-curated, no audience output | This is the top success metric (PRD §9) |
| "Feed existing anti-debates into it" | Milestone M1 / R0 (Fri 10/2) | See [prior-debates.md](./prior-debates.md) |

## Open follow-ups with Stephanie
- [ ] Round structure: read the how-to guide (shorter and longer versions) and encode it as the Anti-Debate template (PRD §7)
- [ ] Oct 11 debaters and topic
- [ ] Debater consent: live mapping (for her cockpit) and a published playback
- [ ] Who moderates on Oct 11. The user has said the moderator is a game-theory expert; confirm the name and whether Stephanie facilitates alongside them.
- [ ] Review of the R0 replay output (target: send Fri 10/2, feedback by Mon 10/5)
- [ ] A 15-minute cockpit rehearsal on Fri 10/9 or Sat 10/10
