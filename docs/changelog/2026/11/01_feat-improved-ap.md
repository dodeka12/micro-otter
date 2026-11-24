# Changes since version 1.24.0

## New Features
- **Improved AP server plan** — added the design plan for the improved AP server.
- **`mo fw` can build (if needed) and deploy** — a new menu action `4` and the `--build-if-stale` flag rebuild the firmware when the current source is newer than the latest build, then flash it; the flow skips the build when the firmware is up to date.

## Bug Fixes
- **NeoPixel unconnected inputs no longer crash** — unconnected channels are treated as zero, arrays are reduced to the shortest connected channel, and frames are padded or truncated to `Count`.
- **RGBW NeoPixel strips work with the existing color-order options** — a missing white position is appended for three-letter orders (`GRB` → `GRBW`).

## Refactor
- **NeoPixel driver renders in place** — channel bytes are written directly into `neopixel.buf`, removing the per-frame payload allocation and buffer copy while still honoring the configured color order.
