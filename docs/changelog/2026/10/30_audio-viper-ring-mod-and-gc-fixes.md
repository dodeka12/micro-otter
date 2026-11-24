# Changes since version 1.23.0

## New Features
- **`ring-mod` audio node** — a sine-carrier ring modulator with `frequency` (10–4000 Hz),
  `depth` (0 = dry pass-through, 1 = full ring modulation), and `sampleRate` controls. The
  carrier is a 512-entry Q7.8 sine table driven by a 16.16 phase accumulator, so the per-sample
  loop is fixed-point and allocation-free.

## Bug Fixes
- **Bitcrusher is now audible and correctly labelled** — the `bits` control is relabelled
  "Bits to Drop" (default 10) and applies the reference `(v >> bits) << bits`; max crush keeps a
  1-bit ±full-scale signal instead of going silent.
- **Square fuzz gained a dB `level` control** — a new loop input (default −6 dB) attenuates the
  square-wave output so it no longer binarizes at full envelope peak with no way to tame it.
- **Audio streaming robustness** — the generated `_audio_task` now survives transient I²S errors
  (drops one block instead of killing audio), short reads zero-fill their buffer tail (no stale
  sample stutter), and the audio chain's per-block allocations were reduced (one `create_task`
  per block, cached memoryviews, cached source reader).
