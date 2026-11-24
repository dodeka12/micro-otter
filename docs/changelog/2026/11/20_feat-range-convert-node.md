# Changes since version 1.30.0

## New Features
- **Range Convert node** — maps a value from one min/max range to another with a linear,
  power (gamma), exponential, or stepped transfer · `Exponent`, `Sigma`, `Steps`, and
  `Quantization` appear only in their own mode · out-of-range values are clamped and reversed
  bounds invert the transfer · stepped levels hold until the next step starts by default, and
  `Quantization` can also pick the nearest level or switch at the step start.
