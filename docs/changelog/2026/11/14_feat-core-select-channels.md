# Changes since version 1.25.0

## New Features
- **`Select` nodes can publish up to ten channel pairs from one condition** — the new `Channels`
  dropdown (1–10) shows only the selected input pairs and outputs, with channel 1 keeping the
  existing IDs and `ON`/`OFF` defaults so saved graphs keep working. Channels 2–10 add
  `trueValue_n` / `falseValue_n` inputs and `value_n` outputs, and every output is typed as the
  union of its own pair instead of `bool`.
