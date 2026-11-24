# Changes since version 1.23.0

## New Features
- **`mix` dry/wet control on bitcrusher and downsampler** — both effects get the same 0…1 `mix`
  control the square-fuzz already had (`0` = bit-exact pass-through, `1` = full effect), so they can
  be faded into a voice instead of only switched on.
- **Click-free effect bypass** — `mix` and `enabled` are no longer applied as a step at a block
  boundary. The new `otter_audio_viper.mix_ramp` module fades the wet share over ~128 samples
  (≈8 ms at 16 kHz), so toggling an effect or dragging a slider no longer clicks or zippers.
  Bitcrusher, downsampler and square-fuzz share it.
- **Downsampler anti-alias filter** — the input is band-limited by two cascaded one-pole low passes
  at `rate / (2 · hold)` before it is decimated (−11.8 dB of folded energy at `hold = 4` on an HF-only
  source, versus −6.2 dB for one pole). The new `antiAlias` switch (default on) turns it off for the
  raw, aliasing-heavy character.

## Bug Fixes
- **Bitcrusher no longer crackles with a DC offset** — quantization now rounds the sample magnitude
  to the nearest step and restores the sign, instead of truncating with `(v >> bits) << bits`. The
  old truncation rectified quiet samples to zero and biased every block negative: at the old default
  of 10 dropped bits the output carried a constant −460.8-count DC offset with 55 % of samples
  clipped to zero (SNR ≈ 0.7 dB at an 800-count peak). Measured after the fix: exactly zero DC, +4.9
  dB SNR at an 800-count peak and +32.3 dB at 20 kHz.
- **Downsampler no longer buzzes at the block rate** — the hold phase and the held sample now carry
  across block boundaries instead of restarting with `i % hold` at every block. Only hold values that
  divide the 256-sample block used to stay periodic; the other 57 slider positions produced a
  62.5 Hz buzz (and a phase-continuous grid sounds up to 17 dB cleaner).
- **Downsampler `hold` is clamped to the block length** — `hold = 300` on a 256-sample block used to
  emit a full-scale block-rate square wave.
- **Square-fuzz `level` is documented as a wet-path gain** — it attenuates the squared wave only;
  the dry share of the `mix` blend passes untouched.

## Behaviour Changes
- **Bitcrusher `bits` defaults to 4** (was 10). 4 dropped bits ≈ 12-bit resolution, which is audibly
  lo-fi without destroying intelligibility; 8 ≈ 8-bit and 15 is the 1-bit extreme.
- **Square-fuzz `strength` is renamed to `mix`** so the whole effect family uses one name for the
  dry/wet control (same range, same default of 0.5). Graphs saved with `strength` need the input
  rewired.
- **Bitcrusher max crush keeps full scale** — `bits = 15` now maps `±32768` to `±32767/−32768` and
  quiet samples to 0, instead of mapping everything to `{0, −32768}`.
