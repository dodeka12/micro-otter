# Changes since version 1.23.0

## New Features
- **Variable store (`vars` package)** — a collection-wide, synchronous, named variable
  store with a general `vars.array` data type and `var-declare`/`var-read`/`var-write`
  nodes. Graphs can declare a typed variable once, read it, transform the value, and
  write it back to keep state across loop iterations and across graphs.
- **LED and LED-strip nodes (`led` package)** — single-color and multi-color
  (RGB/RGBW) LEDs and addressable strips. Per-LED patterns are float arrays produced by
  source nodes (`led-fill`, `led-hat`, `led-sin`, `led-ramp`, `led-steps`) and transform
  nodes (`led-shift`, `led-scale`, `led-offset`, `led-add/sub/mul/div`, `led-clamp`,
  `led-invert`), animated via the `time` node and rendered by `led-neopixel-output`,
  `led-pwm-strip-output`, and `led-single-output`.
- **Variable validation** — declare-once and undeclared-reference checks surface
  collection-level errors in the editor and block deploy.