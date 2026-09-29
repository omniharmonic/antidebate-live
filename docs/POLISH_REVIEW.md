# UX polish review — 2026-09-29

Author: Benjamin Life (@omniharmonic) · Status: deployed to https://antidebate.xyz on 2026-09-29.

Production deployment: `dpl_BbvqW2SPpFqTnDBBN1KGU6PKgqsm` (Vercel CLI upload of the polished working tree). Remote build passed. The `.vercelignore` file excludes local recordings, caches, environment files and design artifacts from deployment inputs.

This pass refines the existing Section design language across the current application. It changes presentation and navigation in `apps/web`; the ontology, extraction pipeline, graph derivation, audience filter and stored sessions are unchanged.

## What changed

| Surface | Problem addressed | Result |
|---|---|---|
| Session shell | Long titles, role links and playback controls competed for phone width. | Compact two-row mobile header; reachable role/lens links; responsive transport; 1× default playback; direct round selection. |
| Spatial | Minimum map height pushed controls off screen; projected prose crowded phones. | Flexible viewport, wider camera framing on phones, explicit Orbit/Reset controls, bounded reading key, phone prose overlays removed, rendering-error fallback to Positions. |
| Timeline | Touch dragging intercepted scrolling; evidence competed with the map. | Touch pans the timeline while the separate scrubber changes time; selection opens a shared evidence sheet. |
| Positions | Desktop columns became unreadable on narrow screens. | Named stance cards below 1280 px, desktop comparison columns above it; phone filter select; search and recoverable empty states. |
| Evidence | Small controls and separate source seeking could discard the proposition being inspected. | Larger controls; verbatim source words beside expandable neighboring transcript lines; historical inspector uses state at the playhead; native modal focus handling below 1280 px. |
| Facilitator | Four constrained panels were difficult to read and scroll on phones. | Wide-screen quadrants, tablet columns, natural phone document flow, sticky phone navigation and Blackout, section jump links, explicit source expansion. |
| Operator | Three simultaneous columns collapsed on phones. | Transcript / Review queue / Insights & rounds panels below 1280 px; all three on wide screens. Default queue focuses on unreviewed items. Search finds transcript text or speakers across the full transcript, showing up to the latest 300 matches. |
| Sessions | Table proportions and identifiers obscured useful content. | Better desktop proportions, mobile cards, larger actions, less identifier clutter. Earlier runs remain available. |
| Setup | Dense participant rows, editable implementation keys, small inputs and inconsistent role/side selection. | Stacked labeled participant fields, compatible role/side selection, required title, format-aware minimum speaker count, mobile-safe input sizing, actionable submission errors and safely quoted recording commands. |
| Older routes | `/setup` and `/play/:event` led to obsolete experiences. | Redirect to `/new` and the current Timeline, preserving valid time/selection parameters for playback links. |
| Stage | Implementation notes appeared in the audience slate. | Clean responsive slate copy. Audience feature scope and visibility rules are unchanged. |

## Interaction contract

- Spatial, Timeline and Positions share one playhead and selection. Switching lenses retains the current moment; browser Back/Forward restores URL state.
- Explore state remains separate from the facilitator and operator's newest log state. Switching roles pauses playback.
- On wide screens, sources stay in a right-hand pane. On phones/tablets, selecting a proposition opens a modal sheet; Back to map or Escape dismisses it and focus returns to the trigger.
- Source context expands in place. Its timestamp labels describe the recording moment; they do not move playback to a time before extraction introduced the selected proposition.
- A phone can pan the Timeline without accidentally scrubbing. The bottom transport remains accessible while the visual workspace scrolls.
- Spatial geometry and participant/stratum semantics are unchanged. Phone users can use Positions for a readable list of the same propositions and their sources.
- No operator mutations were applied to stored sessions during verification. Form submission failure was tested through an intercepted HTTP response.

## Verification

- `pnpm check`: passed, including workspace TypeScript checks and 48 unit tests.
- `pnpm --filter @adl/web lint`: passed.
- `pnpm --filter @adl/web build`: passed; production server exercised on port 3101.
- Production browser screenshot audit: Sessions, Spatial, Positions, Timeline, Cockpit, Console and New session at 1440×1000 and 390×844. No page JavaScript errors or document horizontal overflow.
- All five session surfaces checked at 320, 768, 1024, 1280 and 1920 px with the single-speaker Ignite recording. The two-speaker Ball × Kokotajlo recording also checked at 320, 768 and 1024 px, in addition to the screenshot widths.
- Browser interactions checked: source selection, sheet dismissal and focus restoration, expandable transcript context, proposition search and reset, phone filters, round jump, playback/pause, lens time preservation, direct links, operator panel switching, transcript search, sticky facilitator navigation and visible Blackout, setup validation, role/side compatibility, submission failure recovery, recording command quoting, and legacy redirects.
- Browser checks used isolated headless Chrome against the local production build. Mobile checks emulate touchscreen viewports; they are not physical-device Safari validation.

## Remaining limits

The stage still renders its existing slate/blackout behavior; the full L1–L5 audience layouts in UX.md are a separate feature stream. This pass does not declare them complete or change audience exposure gates.

The recording setup flow still gives the operator a local command; it does not start a server-side ingestion job. Playback animates the argument map; this pass does not add a synchronized media player.

The timeline intentionally retains a horizontally pannable canvas on phones. Dense 3D points are most precise with a pointer; Positions and the evidence sheet provide a touch-friendly reading path. Test final touch gestures and projection legibility on the actual event devices before the live session.

The source data and model quality gates were not re-evaluated as part of this visual and navigation pass.
