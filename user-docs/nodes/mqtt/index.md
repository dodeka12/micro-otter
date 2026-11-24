# MQTT package

Broker publish and subscribe nodes: read a value from a topic, publish one, report the link, set the
last will, and announce retained payloads that survive reconnects.

## Setup

| Requirement | Detail |
|---|---|
| MQTT switched on | Device tab → `General Runtime Configuration` → `MQTT Settings` (collapsed) → `Enable MQTT`, then `Upload Changes` |
| Broker address | `Broker Host` (for example `broker.local`) and `Port` (1–65535) |
| Credentials | `Username` and `Password`, optional |
| Client id | `Client ID`; an empty field generates one |
| Timing | `Keepalive (s)`, `Pump Delay (ms)` (1–60000), `Resync Interval (s)` (1–600) |
| Network | the package requires a target with `wifi` or `ethernet` |
| Companion package | `vars` is deployed with the package |

- The switch is off by default. Saved settings with `Enable MQTT` off raise the
  `Saved, But Not Enabled` notice, and every publish and subscription then stays on the device
  without an error in the console — a healthy-looking log and an empty broker look the same.
- `Upload Changes` writes the settings and asks for a hard reset; `Reload from Device` reads them
  back.
- All MQTT nodes share one connection: the package collects their registrations into a single init
  block that runs before the graphs, so node order in the graph does not matter.

## Nodes

| Node | What it does |
|---|---|
| [MQTT Read](mqtt-read.md) | subscribes to a topic and emits the latest value plus a one-cycle `Updated` flag |
| [MQTT Write](mqtt-write.md) | publishes an input value, retained by default |
| [MQTT Status](mqtt-status.md) | reports whether the broker connection is up |
| [MQTT Will](mqtt-will.md) | sets the broker-side last will for an unclean disconnect |
| [MQTT Announce](mqtt-announce.md) | publishes a retained payload now, after every reconnect and on a trigger topic |

## Shared concepts

Topics are picked, not typed: every `Topic` control lists the topics already used in the graph plus
`New topic…`, which reveals a text field for the full path. A node that published a topic keeps it in
the list even after it is deleted, so a rename never loses the old path silently.

`Payload Mode` decides what crosses the wire: `Single value` sends one scalar, `JSON` modes send or
receive one object. In the JSON modes the node works on a store namespace from the [vars
package](../vars/index.md), and an empty `Store` makes the node emit nothing instead of guessing.

| Publish path | Used by | When the link is down |
|---|---|---|
| direct | MQTT Write | the publish is skipped and logged once per topic |
| deferred | MQTT Announce, Home Assistant discovery and availability | queued once per topic and replayed after every successful connect |

- `QoS` defaults to `0 — At most once`; `1 — At least once` is available on every publishing node.
- Retain defaults to on for state-like payloads, so a subscriber that connects later still sees the
  last value.
- The console logs the first successful publish per topic, the first skip per topic, and one queue
  line per deferred topic.

## Related

- [Home Assistant package](../hass/index.md) — discovery entities on top of this transport
- [MQTT Read](mqtt-read.md) and [MQTT Write](mqtt-write.md) — the everyday pair
- [Device view](../../app/device-view.md) — where `MQTT Settings` lives
