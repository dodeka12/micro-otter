# Date Parts

Outputs year, month, day and weekday for an epoch, by default for the device clock.

## Inputs

| Port | Type | What it receives |
|---|---|---|
| `Epoch` | `int` | UTC epoch in seconds |
| `Timezone` | `float` | UTC offset in hours (-12 to +14) |

## Outputs

| Port | Type | What it emits |
|---|---|---|
| `Year` | `int` | local year |
| `Month` | `int` | local month (1 to 12) |
| `Day` | `int` | local day of month (1 to 31) |
| `Weekday` | `int` | local weekday (0 = Monday, 6 = Sunday) |

## Behaviour

- Pure conversion in the loop: `Year`..`Weekday` are computed from `Epoch` and `Timezone` on every
  pass, with no init phase and no state.
- `Epoch` `-1` (default) means the service's current time; any given value is used as is, and
  negative epochs are valid dates before 1970.
- `Timezone` `-100` (default) inherits `Time Service`; −12…+14 is a literal offset and values above
  +14 are clamped.
- `Weekday` is ISO order: 0 is Monday and 6 is Sunday — add one if your display counts from Sunday.
- `Month` is 1–12 and `Day` is the day of the month, not the day of the year.

## Example

1. Leave both inputs unwired for the local date of the device clock.
2. Wire `Weekday` into a comparison to run something only on weekdays.
3. Wire `Day` and `Month` into `Format Time`-style text for a date without a time.

## See also

- [Time package](index.md) — epoch, timezone and weekday conventions
- [Clock Parts](time-clock-parts.md) — the time of day from the same epoch
- [Format Time](time-format.md) — a whole date as one string

