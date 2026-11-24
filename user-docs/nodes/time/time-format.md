# Format Time

Formats an epoch with a small strftime-like pattern.

## Inputs

| Port | Type | What it receives |
|---|---|---|
| `Epoch` | `int` | UTC epoch in seconds |
| `Timezone` | `float` | UTC offset in hours (-12 to +14) |

## Outputs

| Port | Type | What it emits |
|---|---|---|
| `Text` | `string` | the formatted local time |

## Parameters

| Control | Type | Default | Effect |
|---|---|---|---|
| `Pattern` | text | `%Y-%m-%d %H:%M:%S` | pattern with %Y %m %d %H %M %S %j %% support |

## Behaviour

- Pure formatting in the loop: the string is built from `Epoch` and `Timezone` on every pass.
- Supported specifiers are `%Y %m %d %H %M %S %j %%`; an unknown one such as `%q` is emitted
  unchanged instead of raising, so a typo cannot break the loop.
- The result is local time, so the default pattern renders `2025-06-01 14:05:09` from the configured
  offset rather than UTC.
- `Epoch` `-1` and `Timezone` `-100` behave as in the other conversion nodes: current time and the
  collection's timezone.
- The output is a `string`, so it can go straight into a store, a topic or an entity attribute.

## Example

1. Set `Pattern` to `%H:%M` for a clock display and wire `Text` into a `Web Value Write`.
2. Use `%Y-%m-%dT%H:%M:%S` for an ISO-like timestamp in an MQTT payload.
3. Feed `Epoch` from `Time Status` when the text must show the reading from the top of the pass.

## See also

- [Time package](index.md) — the full specifier table
- [Clock Parts](time-clock-parts.md), [Date Parts](time-date-parts.md) — the values behind the text
- [MQTT Write](../mqtt/mqtt-write.md) — publish the formatted string

