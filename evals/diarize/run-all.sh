#!/bin/sh
# Launch every (fixture, window, shift) as its own process; results append to .data/diarize-sweep/*.jsonl
cd "$(dirname "$0")"
OUT=../../.data/diarize-sweep; mkdir -p $OUT
run() { for shift in 0.5 0.25; do node sweep.mjs --fixture "$1" --start "$2" --dur "$3" --shift $shift --out $OUT/$1.$4.$shift.jsonl > $OUT/$1.$4.$shift.log 2>&1 & done; }
run ball-kokotajlo-ai-governance 2700 180 3min
run ball-kokotajlo-ai-governance 87 1200 20min
run belief-in-god 3030 180 3min
run belief-in-god 0 1200 20min
run open-source-ai 3090 180 3min
run open-source-ai 0 1200 20min
wait
