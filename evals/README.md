# evals/

The evaluation harness and gold sets. Spec: [docs/QUALITY.md](../docs/QUALITY.md).

To build (WS2, IMPLEMENTATION_PLAN §3):
- `gold/<set>/<segment>.events.jsonl`: human-annotated event logs (the same event types the pipeline emits, `actor: "operator"`), so the same projections and diffs apply
- `run.ts --set G2 --segment held_out --passes L1,L2,L3,L4`: replay a segment through the worker and score it against gold
- `score/*.ts`: one scorer per metric in QUALITY §4 (proposition P/R with span overlap, faithfulness sampling, hedge and scope fidelity, speech-act accuracy, identity F1, relation F1, crux agreement, higher-ground recall)
- `results.md`: an append-only table of runs (prompt versions, model, effort, cost, latency, scores)

**Held-out rule:** one segment per set is never used for prompt iteration. Report numbers only on held-out segments.
