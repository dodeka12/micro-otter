# Changes since version 1.26.0

## New Features
- **All six RGB color orders** — the NeoPixel node's `Color Order` dropdown now offers `GRB`,
  `RGB`, `BRG`, `RBG`, `GBR`, and `BGR`; the generator whitelists them and falls back to `GRB`
  with a warning for unknown values.
- **Advisory pin claims** — device targets can now record board-level pin facts (`console.tx` /
  `console.rx`, `usb.dminus` / `usb.dplus`, and an optional `onboard.led` namespace). The
  ESP32-S3 Mini and ESP32-WROOM targets declare their console and native-USB pins, the Arduino Uno
  target declares its onboard LED (D13), and the pin picker annotates claimed pins
  (`GPIO43 — UART0 TX (console)`) without hiding them.
- **Duplicate pin detection** — a pin assigned to the same capability by two nodes is now flagged
  instead of passing silently.

## Fixes
- **Loud hardware failures** — a missing `neopixel`/`machine` module now raises `RuntimeError` on
  MicroPython (and warns once while simulating on a host) instead of silently darkening the strip.
- **Portable write path** — `neopixel.buf` is demoted from a requirement to an optional fast path:
  when the driver exposes it, frames are rendered straight into that buffer (no per-frame
  allocation); otherwise the documented `np[i] = (r, g, b[, w])` API is fed from a reused scratch
  buffer. Every image we build freezes micropython-lib's pure-Python driver, so the fast path is the
  one taken on hardware; the indexed fallback is a portability guard for implementations without
  `buf`.
- **`count` vs value-count diagnostics** — a channel shorter or longer than `Count` warns once
  instead of silently padding/truncating; scalar channels broadcast to every LED.

## Performance
- **Frame throttling** — identical LED frames are skipped (a WS2812 write costs ~30 µs per LED),
  with `write(..., force=True)` to retransmit after a peripheral reset.
