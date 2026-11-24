# Changes since version 1.23.0

## New Features
- **Square-fuzz `mix` control** — a new loop input (0…1, default 0.5) blends the dry input with
  the squared wave, so the effect can be dialled from a subtle edge to a full square wave instead of
  always destroying the voice; `0` is a bit-exact pass-through and `1` reproduces the previous
  full-square output.

## Bug Fixes
- **No more loud glitch at power-on** — `AudioChain` now discards the first `warmup_blocks` blocks
  (default 2) as silence without running the effect chain, and ramps the next `fade_in_blocks`
  blocks (default 3) from 0 to unity gain. Stale I²S RX DMA content and the microphone's power-on
  pop therefore never reach the speaker, and the square-fuzz can no longer binarize them into a
  full-scale burst.
- **Amplifier no longer pops when it unmutes** — `I2SOutput` holds the `sd_pin` shutdown low until the
  first block has been written, so the amplifier comes up onto a TX DMA ring that already contains
  the chain's warm-up silence.
- **Square-fuzz no longer over-distorts voice** — the default mix of 0.5 keeps the input
  waveform and its intelligibility while still adding fuzz character; the blend works on magnitudes,
  so the output stays sign-symmetric (no DC offset).
