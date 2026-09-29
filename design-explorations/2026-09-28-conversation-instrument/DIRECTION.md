# Direction study: a conversation instrument
For Benjamin Life (@omniharmonic) · 2026-09-28 · Draft for feedback

## 1. Intended feeling
A quiet workstation for navigating ideas. The interface feels technical because its structure can be inspected. Every line connects something meaningful; every selected claim can be checked against the recording. Spatial depth supplies a sense of discovery. Typography and stable controls make that depth usable.

The user's references suggest the analytical density of an intelligence workstation and the restraint of a hacker art installation. Take the precision, scale, and navigability from those references. Avoid surveillance imagery, military targeting language, decorative telemetry, and generic cinematic HUDs.

Keep **Anti-Debate** as the product name in these studies. Section and Field name design directions, not new brands, features, or ontology entities. The intended reviewer is understood to be Liv Boeree from the user's description and the local reference document; this does not change the documented Oct 11 facilitation roles.

## 2. What the existing work already gives us
These findings come from local files, not a production usability audit.

| Source | Current behavior or decision | Design implication |
|---|---|---|
| `packages/ui/tokens.css` | Open Field uses light surfaces, warm rust for A, blue for B, violet convergence, Instrument Serif display | Replace the editorial mood at the system level after direction approval |
| `apps/web/app/globals.css` | All headings inherit the serif; arrival is a fade/settle; connection indicator breathes | Typography change must cover global and explicit display uses; propose static connection status |
| `apps/web/app/page.tsx` | Session archive uses 52px serif title and 24px serif session names | Make the archive a precise list of conversations, with a clear primary action |
| `components/arc/ArcView.tsx` | SVG temporal view; two stance lanes, five strata, median channel, scrubbing and side detail | Preserve the useful reading model; improve hierarchy, selection, and evidence access |
| `components/cockpit/CockpitView.tsx` | Fixed quadrants; 38px serif crux; 22px body; source expansion | Preserve quadrant locations and large type; redesign rhythm rather than increasing information density |
| `components/console/ConsoleView.tsx` | Transcript, review queue, insight/round column; event-backed decisions | Operator work needs dense, legible rows and explicit action states |
| `components/SessionBar.tsx` | Shared header switches Cockpit / Arc / Console | Explore a distinction between role surfaces and reading lenses |
| `docs/ONTOLOGY.md` | Speaker-independent propositions, per-person stances, quote anchors, separate derived structures | The visual language must reveal these distinctions |
| `docs/UX.md`, `docs/ARCHITECTURE.md` | Spatial strata, time depth, cinematic mode; projection constraints | Spatial beauty has to coexist with readable 2D and list views |
| `docs/NEXT_STEPS.md` | Active 4D and broader frontend workstream | Coordinate-model details remain provisional until that work lands |
| `docs/client/stephanie-feedback.md` | Clarity first; screen distraction is a failure; audience dark by default | No spatial animation in default facilitator glance mode |
| `packages/core/src/visibility.ts` | Explicit audience projection | Reskinning never broadens the audience data boundary |

The legacy handoff contains older build-status claims. Current components and the running workstream document are better evidence of what is already implemented. No extraction-quality claims are made by this design study.

## 3. Two expressions to compare
**Section — recommended.** Open wireframe strata, a stable orientation, a narrow evidence panel, precise brackets around selection. The map resembles a section through a complex argument. The structure teaches itself. Its risk is looking too much like CAD; sparse grids and large readable prose keep it human.

**Field — alternative.** More open space, lighter registration marks, a sparse spatial constellation. The selected neighborhood brings order into focus. Its advantage is atmosphere and exploration; its risk is a beautiful network whose spatial semantics are hard to infer.

Use the same content and evidence inspector when comparing them. A difference in data density should not determine the aesthetic decision. The image generator may vary density; a future prototype should hold it constant.

The strongest likely combination is Section's navigation and hierarchy with Field's restraint about drawing every edge. This remains a recommendation awaiting user feedback.

## 4. Provisional visual system
### Color
| Role | Candidate | Rule |
|---|---|---|
| Canvas | `#090D11` | Almost black, slightly cool |
| Raised working surface | `#111820` | Inspector and active control regions |
| Primary text | `#E8EEF2` | Readable cool white; avoid pure white everywhere |
| Secondary text | `#B0BCC7` | Source metadata and explanatory copy |
| Muted text | `#8393A3` | Still readable; never reduce its opacity for essential text |
| Decorative rule | `#293440` | Only separators that do not carry essential meaning |
| Control boundary | `#637485` | Interactive outlines and essential chart geometry |
| Participant A | `#8CD5E8` | With name/letter, never color alone |
| Participant B | `#A4B8F5` | With name/letter; separation needs user testing |
| Shared/higher ground | `#B9A4E3` | Candidate versus confirmed remains explicitly labeled |
| Keyboard focus | `#D1E8FA` | Visible 2px ring, offset from the target |

A local sRGB calculation gives primary text 16.66:1 on the canvas and 15.27:1 on the working surface; muted text 6.19:1 and 5.67:1 respectively. Control boundaries are 4.05:1 and 3.72:1. These are calculations for opaque flat colors, not validation of the generated images or a claim of full accessibility compliance. Blending and opacity must be checked again in implementation.

The two participant colors are deliberately restrained but close in hue. Explicit participant labels and stance symbols are mandatory. Try a more separated pair in a later revision if the user finds the initial pair too similar. Never use red/green to code who is right.

### Type
Use the existing **Inter** family for the first implementation prototype, including headings. Use existing **JetBrains Mono** for times, short identifiers, and compact keyboard hints. Removing serif display use is a deliberate departure from UX §2 that the user has requested exploring; the binding design docs remain unchanged until approval.

Give the interface character through scale, alignment, and whitespace rather than an aggressively futuristic typeface. Sentence case for prose and actions; uppercase only for short navigation or metadata labels. No stretched techno lettering or monospace paragraphs.

| Context | Starting size / line height |
|---|---|
| Desktop primary proposition | 26–30 / 34–38px |
| Desktop body and source quote | 15–16 / 22–24px |
| Metadata | 12–13 / 17–18px |
| Cockpit proposition / prompt | 32–38 / 40–46px |
| Cockpit body | At least 22 / 30px |
| Cockpit labels | 17–18 / 24px |
| Stage content | At least 28px; rehearse in the venue |

These are starting values, not a promise that every string fits. Long content must be tested; never squeeze the cockpit to fit by making its prose smaller.

### Geometry and texture
Use a 4px spacing unit; typical gaps 8, 12, 16, 24, 32. Separate regions with rules and spacing. Controls can use 2–4px corners; primary data panels need no rounded containers. No glass, gradients, bloom, scanlines, chromatic aberration, animated grain, bevels, or decorative reticles. Selection brackets identify a real selected object. The screen is not a spacecraft prop.

## 5. What the spatial view means
**“4D” here means a three-dimensional map whose state changes with time.** It is not a claim to measure four independent psychological quantities.

There is an unresolved contract: ARCHITECTURE §6 currently assigns X to stance arrangement, Y to stratum, and Z to first assertion time. NEXT_STEPS describes a 3D agreement/disagreement/depth space across time. The images use the documented X/Y/Z reading as a temporary scaffolding. A time scrubber and time-depth axis are two presentations of time, not independent fourth and third measurements. Align the final axis definitions with the active build before implementation.

- Keep strata ordered per the ontology: praxis, empirical/predictive, axiology, epistemology, ontology, with derived higher ground above.
- One proposition has one identity. Participant-colored stance attachments can show who accepts or rejects it. Do not imply that each speaker has a separate version of truth merely because they occupy opposite sides.
- Any hemisphere positions indicate a layout convention, not political orientation.
- Explain exactly what geometric distance encodes. Where it is merely layout spacing, say so in the legend/help; do not imply quantified conceptual disagreement.
- Use a shared median only when the underlying common-ground definition is satisfied.
- Higher-ground candidates remain outlined and labeled Candidate. Proximity or elevation never implies mutual confirmation or intellectual superiority.
- Crux frames are derived annotations on the graph. A frame should not obscure the proposition or its evidence.
- Uniform node size is the safe initial choice. A future centrality encoding needs an explicit visible definition and a legend; never use apparent importance without explaining it.
- Relations use existing relation types. Short labels on selection distinguish supports, rebuts, undercuts, and undermines. Do not invent a “tension edge.”
- The geometry must be deterministic and stable. New evidence should not reshuffle the whole scene.

Separate four visual layers: neutral proposition geometry; participant stance attachments; inferred/stated evidence encoding; approval/release/confirmation status in readable text. A thin outline alone cannot carry all four concepts.

## 6. Explore: spatial and timeline
A proposed desktop shell has a compact header, one lens bar, a flexible visualization, a 320–400px inspector, and a persistent temporal dock. The percentages in the generated images are compositional guides; real layout must respond to content.

Role navigation: **Explore / Facilitate / Operate**. Lens navigation inside Explore: **Spatial / Timeline / Positions** initially. These are provisional labels, not route changes. Preserve existing URLs when feasible and add aliases only through the final implementation plan.

### Selection and evidence
1. Hover previews a short canonical proposition without moving the camera.
2. Click or keyboard activation selects it; its ID stays selected across lenses.
3. The inspector shows canonical text, proposition type and stratum, per-person stance/strength, and provenance status.
4. Below, show exact source words, speaker identity, media time, and speech act when consequential.
5. “View in transcript” reveals the anchored span. “Play source” is available only when playable media exists. It must not silently jump media merely because the user hovers.
6. “Focus neighborhood” reduces visible edge clutter and focuses the camera only on deliberate activation.
7. Escape closes transient detail; Reset view restores a known orientation. Never lose selection during a view switch.

Do not make hover the only path to evidence. Every canvas interaction needs an equivalent list or Positions view action and accessible description.

### Time
The transport indicates **Replay** or **Following live** separately from the data interpretation **Canonical / As seen live**. Those are different concepts. Do not claim canonical results exist when the post-event pass has not run.

Scrubbing pauses following live. Returning requires an explicit “Return to live” action. Keep node selection if it still exists at the selected time; otherwise explain that it is not present yet. Future conclusions are hidden in as-seen-live playback. A deliberately enabled whole-session overview must be unmistakably labeled; faint future marks can still leak information.

The timeline retains the existing two lanes and shared corridor. Deep strata remain readable. Selection shows relevant cross-lane relations, rather than drawing all crossings. Candidate higher ground occupies a distinguishable subregion; it must never look like established shared agreement.

Persist current time, selected object, camera orientation, and filters across lens changes where meaningful. A user should not have to reconstruct their place in the conversation.

### Motion
No passive orbit in interactive Explore or facilitator mode. A user-controlled focus can ease over roughly 250–400ms; arriving released content may retain the existing 400–700ms fade/settle. Respect reduced motion with immediate transitions. Stage cinematic orbit already exists as a documented option; retaining it requires explicit presentation mode, a pause control on the operator side, and a static reduced-motion alternative.

## 7. Facilitate: glance before exploration
Keep the existing four quadrants in the existing places:
- Top left: The crux now.
- Top right: Higher ground.
- Bottom left: Already shared.
- Bottom right: Try asking.

There is no miniature spinning map. The facilitator's job is to listen to the people. One clear claim or question per quadrant, with a compact status line and access to evidence.

Show only an operator-sent or otherwise policy-authorized state. New candidates should not silently replace a question while it is being read. A later prototype should evaluate whether updates are held while the panel is expanded, with an explicit update indicator.

Source detail should be a stable expansion or sheet with an obvious close action. UX §3 currently prescribes auto-collapse after 20 seconds; propose changing this because it can dismiss material mid-reading. This is a proposed UX change, not implemented behavior.

Keep audience state and **Blackout** visible at all times. Blackout is immediate and scoped clearly to audience outputs; it does not erase the facilitator's evidence. Changes to display level or Reveal should indicate the target channel and acknowledge completion only after the underlying event succeeds.

For long crux text: preserve the full canonical sentence in accessible detail, retain readable sizing, and use a deliberate expanded layout. Do not auto-generate a shorter paraphrase to solve overflow. Test a tablet with long names and long propositions before accepting the design.

## 8. Operate, audience, archive
### Operator
Retain transcript, review queue, and map/insight/output regions. Dense rows are appropriate here. Make the currently reviewed item's exact quote visible beside the claim. Separate **Approve**, **Send to facilitator**, and **Reveal**; they are different operations.

Held attribution, failed checks, and inferred links need readable labels. A failed save remains pending or failed and does not appear approved. Capture, transcript, map freshness, and output connection are separate states; a connected transport is not proof that the map is current. Show measured ages/latencies only when their definitions and timestamps are available.

### Audience
Every channel still receives only `audienceView()` output. The full inspector in the mockups is an authorized exploration design, not permission to expose internal state to a public route.

Level 0 remains black/title slate; Level 1 frame; Level 2 positions; Level 3 clash/shared ground; Level 4 approved map; Level 5 approved map and transcript. The new language can remove serif display across these levels. Default audience mode remains dark. Source detail, if offered publicly, must be supported by a deliberate audience-safe projection; never fetch raw proposals to populate it.

A stage scene needs fewer labels and stronger lines than a laptop. Validate at distance, not by shrinking the desktop screenshot. No operational health notices on stage. Livestream overlay uses transparent background and the same approved payload boundary.

### Session archive and setup
Make the archive a clean table/list: title, participants, recording/live state, last meaningful activity, then a primary Explore action and role links. Avoid backend event counts as decoration. Errors say what the user can do; database/environment diagnostics belong in operator detail.

Do not redesign ingest, pairing, or permissions until the build agent's current flows are understood. Use the new tokens and hierarchy consistently once approved.

## 9. State and accessibility requirements
- Keyboard focus must remain visible on graph marks, transport, tabs, and evidence links.
- Provide at least 44px touch targets for cockpit controls. A small visual point may have a larger invisible hit target.
- Offer list/Positions equivalents for spatial content and make source spans reachable without a pointer.
- Distinguish color, stance, uncertainty, and review status with text/glyphs. Candidate does not mean agreed.
- Do not lower source-text opacity to communicate inferred status; keep the label readable and change the geometry treatment.
- At narrow widths, use one primary pane plus a detail sheet. Do not compress three desktop columns into a phone.
- At 200% zoom, selected claims and primary controls remain available without overlap.
- Empty: explain what has not been identified or released; do not imply a processing state unless known.
- Stale: preserve last verified state and label its age on authorized operational surfaces.
- Missing media: show the text span; disable the seek action with a reason.
- Contested: retain the record and visible status. Canonical does not mean participant-confirmed.
- Large/slow scene: degrade to synchronized 2D/list view without losing selected object or playhead.
- Reduced motion: no animated orbit, travel, pulsing status, or settling.

## 10. What happens after feedback
The next handoff should specify exact responsive layouts, typography tokens, all control states, encoding legends, interaction/state diagrams, content overflow, component ownership, keyboard bindings, and visual regression cases. It should reconcile the coordinate model with the build agent, then update the approved design source-of-truth docs before code changes.

Implementation order after approval:
1. Inventory the completed branch and its new spatial component; preserve data and visibility contracts.
2. Revise approved design docs and map tokens and display typography.
3. Build one selected-proposition vertical slice across spatial, timeline, and evidence inspector.
4. Rehearse the four-quadrant cockpit with real content.
5. Extend to operator/archive/audience surfaces.
6. Verify accessibility, evidence fidelity, long content, temporal visibility, stable layout, and projection readability.

Visual acceptance: no serif display, earthy fills, decorative telemetry, or ungrounded summaries; exact quotes remain distinguishable from canonical claims; candidate and confirmed states cannot be confused. Functional acceptance uses the repository's existing quality gates and appropriate checks after actual code changes. No application tests are required or claimed for this isolated image/document study.
