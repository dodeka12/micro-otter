# Clock Parts

Outputs hour, minute and second for an epoch, by default for the device clock.

## Inputs

| Port | Type | What it receives |
|---|---|---|
| `Epoch` | `int` | UTC epoch in seconds |
| `Timezone` | `float` | UTC offset in hours (-12 to +14) |

## Outputs

| Port | Type | What it emits |
|---|---|---|
| `Hour` | `int` | local hour (0 to 23) |
| `Minute` | `int` | local minute (0 to 59) |
| `Second` | `int` | local second (0 to 59) |

## Behaviour

- Pure conversion in the loop: the three outputs are computed from `Epoch` and `Timezone` on every
  pass, with no init phase and no state.
- `Epoch` `-1` is the default and means the service's current time; any other value is used as given,
  including negative epochs before 1970.
- `Timezone` `-100` is the default and means "inherit the timezone of `Time Service`"; a value inside
  −12…+14 is a literal offset and anything above +14 is clamped to +14.
- `Hour`, `Minute` and `Second` are local values, so they follow the offset rather than UTC.
- There is no daylight-saving rule: a fixed offset has to be adjusted by hand across a DST change.

## Example

1. Leave both inputs unwired to read the device clock with the collection's timezone.
2. Wire `Hour` into `Time Between` to build a daylight window.
3. Wire all three outputs into `Format Time`-style text or into comparisons.

## See also

- [Time package](index.md) — the `-1` and `-100` sentinels
- [Date Parts](time-date-parts.md) — the same epoch as a calendar date
- [Time Between](time-between.md) — compare the clock against a daily window

