# Changes since version 1.26.0

## Features

- **MQTT last will (`mqtt-will`)** — the broker now publishes `offline` on the device's
  behalf when the link dies uncleanly, so Home Assistant (and every other subscriber) sees a
  definitive state instead of a stale retained value. The will travels inside the MQTT
  `CONNECT` packet, so `mqtt-will` configures it in `init_mqtt()` **before** `_mqtt.start()`
  and it is re-applied on every reconnect. Only one will fits into one connection; the last
  `mqtt-will` node wins.
- **Retained replay and re-announce (`mqtt-announce`)** — a payload that must exist on the
  broker *after every connect* can now say so. `publish_deferred()` publishes immediately
  when connected, keeps the entry for the session and re-publishes it after each successful
  connect; `mqtt-announce` adds an optional trigger topic (classic use:
  `homeassistant/status` = `online`) that forces one re-assertion without waiting for a value
  change.
- **`payloadMode: json-store` for `mqtt-read` / `mqtt-write`** — one MQTT message now carries
  a whole variable namespace as a JSON object (`{"temp":21.5,"ok":true}`) instead of a single
  scalar. `mqtt-write` publishes `_store.items(namespace)` through the new `json_payload()`,
  `mqtt-read` unpacks one JSON object into a namespace and keeps `int`/`float`/`bool`/`str`
  types intact.
- **Graph topic dropdowns** — every MQTT `topic` control is now a dropdown of the topics
  already used in the graph plus a **New topic…** entry that reveals a text field. The list
  refreshes while the editor is open, so a topic typed in one node appears in the others.
- **Topic-coherence badges** — empty topics, competing `mqtt-will` nodes, an `mqtt-read` on a
  topic nobody publishes and an unretained `mqtt-announce` now show the same node badge as a
  pin conflict, with a precise message.
- **`select` node** — the missing mux: one boolean chooses between two values, so "publish
  `ON` or `OFF`", "publish one of two labels" or a threshold-dependent number is a two-node
  construct instead of an `if` block. Its output is typed as the **union** of both value
  inputs (`typeInputSources`), which means it is only connectable where both members fit.
- **`round` math operation** — `math` gains `Round` next to `Fraction`. It returns an `int`,
  so a payload reads `21` instead of `21.0`, and halves round **half to even**
  (`round(2.5) == 2`, `round(3.5) == 4`) exactly like CPython and MicroPython.
- **New `hass` package** — Home Assistant MQTT discovery without typing a single topic:
  `hass-bridge` (device card, availability, birth re-announce) plus `hass-sensor`,
  `hass-binary-sensor`, `hass-number`, `hass-switch` and `hass-select`. Topics are derived from
  the device id and the entity's `objectId`; discovery configs are retained and replayed after
  every connect and after each Home Assistant restart.

## Improvements

- **Union output typing** — a node definition can list `typeInputSources: ["a", "b"]` and its
  output is then typed as the union of what actually arrives at those inputs. Connection
  validation requires *every* member to be acceptable, and an unconnected union behaves like
  `any` so a freshly placed node is never unconnectable.
- **`mqtt` requires `vars`** — `json-store` emits `import otter_vars.store as _store`, so a
  deployment that uses the MQTT package always ships the store runtime.
- **JSON helpers** — `json_payload()` / `json_value()` are the single encode/decode pair for
  the runtime, `payloadMode: json-store` and the `hass` package; an unencodable value is
  published as its `str()` with one error line instead of being dropped.
- **Hass graph rule** — entity nodes without a `hass-bridge` show a node badge. The rule
  registry behind it (`GraphTopicRules`) is public, so packages can add their own topic rules.

## Fixes

- **A retained payload composed before `_mqtt.start()` is no longer lost** — `publish()`
  drops silently while the link is down; `publish_deferred()` keeps the payload and replays
  it after the first successful connect (and after every later one).
- **Two nodes on one will topic no longer fail silently** — the duplicate is reported as a
  badge, and identically configured `mqtt-will` nodes contribute their init block once.

## New Features

- **`hass-bridge` is a collection singleton** — one bridge node — typically in the `Init`
  graph — serves `hass-*` entity nodes in every graph of the collection; the device card,
  availability and the birth re-announce are announced once.

## Bug Fixes

- **Bridge ordering** — `configure()` now always runs before every `register_entity()`,
  regardless of the order in which the graphs of a collection are processed.
- **Birth re-announce without a loop** — the re-announce moved from a loop statement to the
  MQTT message hook, so it also works from a startup graph that never loops.
- **Bogus bridge badge** — an entity graph no longer reports "needs a hass-bridge" when the
  bridge lives in another graph; a second bridge is now flagged instead.
- **Duplicate will** — only one will fits into the MQTT connect, and the `hass-bridge`
  already installs one, so an `mqtt-will` node next to it is now flagged; the example
  collection no longer demonstrates the redundant combination.
- **Web View structure badges on permissive targets** — "only one Web Root per graph" and "a
  multi-page contract needs a Web Root" now report on targets without a pin table
  (`generic_micropython`), where they were silently skipped.
- **Fewer false "nobody publishes this topic" badges** — a topic published in another graph of
  the collection is no longer reported as unpublished, and a second `mqtt-will` in another
  graph is now reported at all.

## Refactor

- **`otter_mqtt.on_message()`** — message hooks next to the connect hooks.
- **Graph rules instead of topic rules** — topic coherence, node/collection shape checks and
  package checks share one registry with a declared `'graph' | 'collection'` scope; the
  per-node capability path keeps pins and target capabilities only. The `webview` root checks
  that used to sit on that path (and were dead on open-pin targets) are graph rules now.

## Documentation

- **Node validation architecture** — a new developer page
  (`docs/dev/nodes/node-validation-architecture.md`) states where a check belongs: declarations,
  per-node capability checks, graph rules, or the cross-node resource validator, for every node
  package; a doc/code consistency test keeps it in step with the registries.
