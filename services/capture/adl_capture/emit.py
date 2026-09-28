"""Emit utterance events to the web API with a durable local queue (ARCHITECTURE §2.1 step 9).

Events are appended to a JSONL spool first; a sender drains it with retries, so
network loss never drops speech. Idempotent by eventId on the server.
"""
from __future__ import annotations

import json
import time
from pathlib import Path

import httpx


class Emitter:
    def __init__(self, api_base: str, token: str, spool: Path):
        self.api = api_base.rstrip("/") + "/api/events"
        self.headers = {"Authorization": f"Bearer {token}"}
        self.spool = spool
        self.sent = spool.with_suffix(".sent")
        spool.parent.mkdir(parents=True, exist_ok=True)

    def enqueue(self, event: dict) -> None:
        with self.spool.open("a") as f:
            f.write(json.dumps(event) + "\n")

    def drain(self, batch: int = 50) -> int:
        """Send unsent events; returns how many were acknowledged."""
        if not self.spool.exists():
            return 0
        lines = self.spool.read_text().splitlines()
        done = int(self.sent.read_text()) if self.sent.exists() else 0
        pending = lines[done:]
        acked = 0
        for i in range(0, len(pending), batch):
            chunk = [json.loads(line) for line in pending[i : i + batch]]
            try:
                r = httpx.post(self.api, json={"events": chunk}, headers=self.headers, timeout=5.0)
                r.raise_for_status()
            except httpx.HTTPError:
                break
            acked += len(chunk)
            self.sent.write_text(str(done + acked))
        return acked

    def run_forever(self, interval_s: float = 0.25) -> None:  # pragma: no cover
        while True:
            self.drain()
            time.sleep(interval_s)
