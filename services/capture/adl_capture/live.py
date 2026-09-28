"""Live capture loop (WS1, IMPLEMENTATION_PLAN §3). NOT BUILT YET.

Build order (ARCHITECTURE §2.1):
  1. open the CoreAudio multichannel device (sounddevice) + continuous multitrack WAV
  2. Silero VAD per channel
  3. gate.assign_owner on aligned speech regions
  4. Parakeet (parakeet-mlx) on the owner segment, word timestamps
  5. voiceprint similarity vs sound-check enrollment
  6. fusion.fuse → utterance.final (+ attribution.pending when needs_operator)
  7. emit.Emitter spool + drain
"""


def main() -> None:  # pragma: no cover
    raise NotImplementedError("Live capture is WS1 work; see the module docstring and docs/ARCHITECTURE.md §2.")


if __name__ == "__main__":  # pragma: no cover
    main()
