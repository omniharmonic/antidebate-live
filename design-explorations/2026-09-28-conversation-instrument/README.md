# Anti-Debate — conversation instrument studies
Design exploration for Benjamin Life (@omniharmonic) · 2026-09-28

**Status: first-round concepts for feedback. Nothing here is an approved implementation specification.**

The proposed direction is **Section**: a dark, precise instrument for seeing the structure of a conversation. **Field** tests a more open, installation-like spatial expression. Both retain human-readable claims and immediate access to source words.

## Review the images
1. [Section: spatial explorer](mockups/01-section-spatial.png) — recommended starting direction.
2. [Field: spatial explorer](mockups/02-field-spatial.png) — compare the spatial aesthetic on the same content.
3. [Section: timeline](mockups/03-section-timeline.png) — test the language against the existing temporal view.
4. [Section: facilitator cockpit](mockups/04-section-cockpit.png) — test whether the direction stays calm at a glance.

[Open the comparison gallery](index.html). The images are generated visual studies, not screenshots of working software. All dialogue and mappings depicted are hypothetical. Fine text, data relationships, and controls require correction in a deterministic prototype.

## Read alongside
- [Direction and provisional UX](DIRECTION.md): findings, visual rules, interactions, accessibility, and implementation boundaries.
- [Sample dialogue and copy](COPY.md): an explicitly fictional content set and state-specific interface language.
- [Review notes](REVIEW.md): image-specific limitations and questions for the next iteration.
- [Generation prompts](PROMPTS.md): exact prompts, using the built-in image generation tool.

## Isolation
Only this directory was created for the study. Application code, shared tokens, dependencies, source-of-truth docs, event logs, and the other agent's work are outside scope. No production changes, deployments, commits, or messages to another agent are part of this exploration.

Source reading reflects the working tree on 2026-09-28. The other build agent is active; re-read current files before implementation. The current UI was reviewed through its source, not through a live browser test.

## Decisions to make before the full handoff
- Section's visible structure or Field's open space?
- How much spatial structure should remain visible when nothing is selected?
- Does the cockpit retain enough character while staying readable?
- Does the palette feel sufficiently distinct, or should participant colors separate further?

After feedback: refine selected images, build a small isolated interaction prototype, then write the complete implementation specification against the finished build agent's data and component contracts.
