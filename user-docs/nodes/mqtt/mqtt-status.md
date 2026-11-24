# MQTT Status

Samples the MQTT runtime and reports whether the broker connection is currently up.

## Inputs

None — the node has no inputs and no controls.

## Outputs

| Port | Type | What it emits |
|---|---|---|
| `Connected` | `bool` | `true` while the runtime holds an open socket to the broker |

## Behaviour

- No init phase and no connection of its own: the MQTT service owns start, stop and reconnects.
- Loop: reads the live flag, so the output drops as soon as the pump detects a dead socket or the
  controller disconnects.
- The flag says the link is up, not that the broker accepted a particular publish — use the console
  output of a write node for that.

## Example

1. Wire `Connected` into `Logic` with `not` to light an LED while the link is down.
2. Or wire it into `Print` to see link drops in the console without reading the runtime log.

## See also

- [MQTT package](index.md) — connection settings and diagnostics
- [MQTT Read](mqtt-read.md) — `Default on Dis.` hides stale values after a drop
- [MQTT Will](mqtt-will.md) — what the broker publishes when the link dies badly
