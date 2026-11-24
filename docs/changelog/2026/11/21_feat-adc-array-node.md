# Changes since version 1.36.0

## New Features
- **ADC Block node** — `core.adc-array` samples one ADC pin at `1 kHz`, `2 kHz`, `5 kHz` or
  `10 kHz` (default `5 kHz`) and publishes a block of `16`, `32`, `64` or `128` samples (default
  `64`) as a `vars.array` of 0–3.3 V readings, oldest sample first · the pin dropdown is filtered by
  the target's `adc.wifiSafe` capability, and attenuation is fixed at `ADC.ATTN_11DB`.
- **Paced capture** — an absolute deadline, advanced with `time.ticks_add` and waited on with
  `time.sleep_us`, keeps the sample spacing drift-free; an overrun yields a non-positive
  `ticks_diff` and skips the sleep instead of bursting.
- **Blocking by design** — the capture runs inline in the graph loop, so it blocks the rest of the
  graph for `samples / rate`: about 13 ms at the default 64 samples / 5 kHz, up to 128 ms at 1 kHz
  with 128 samples. Keep blocks short when other nodes must stay responsive.
- **One allocation per start** — the buffer is created once in the initialization phase and
  overwritten in place on every pass, so a consumer must copy the block if it needs a history.
- **Plots with the Line Graph** — wire `Samples` into a `graph-display` `y` input, leave `x`
  unconnected (the plot uses the sample index), set a manual `0..3.3` y range for a stable scale,
  and keep `maxPoints` at or above the block size.
- **Package version** — the `core` device package is now `1.28.0`, produced by
  `hooks/device_version_hook.py`.
