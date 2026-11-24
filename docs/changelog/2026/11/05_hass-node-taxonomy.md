# Changes since version 1.26.0

## New Features

- **`Authority` on every writable Home Assistant entity** — `HA Number`, `HA Switch`, `HA Select`
  and the new `HA Text` gained a dropdown that answers one question: who owns the value? `Device
  wins` makes the `Value` output follow the node's input and lets a Home Assistant command arrive
  on `Command`/`Updated`; `Home Assistant wins` keeps the sticky last command (the behaviour every
  writable node had before). The definition ships `"default": "device"` with `"legacyDefault":
  "homeassistant"`, so a collection saved before the control existed keeps its old behaviour, and
  a generator fallback (`missing authority` → `homeassistant`) covers nodes whose `controlValues`
  never went through the runtime migration.
- **`Command` and `Updated` outputs** — appended after `Value` (index 1 and 2, so no existing wire
  moves). `Command` carries the last Home Assistant value (and repeats `Value` while Home Assistant
  owns it, without a second runtime call); `Updated` is `true` in exactly one loop cycle per new
  command and is consumed under a per-node key (`hass_cmd_<nodeId>`), so two nodes on the same
  entity each see the edge once.
- **`Report State` checkbox** — off announces a write-only control: the discovery config carries no
  `state_topic`, `publish_state()` returns `False` and logs
  `state: <component>.<id> has no state topic (report_state=False)` once, and `Expire After` is
  ignored. The registration log now says `state=none` instead of a topic.
- **`HA Text`** — the fourth writable component (`text`), with `Min Length`, `Max Length`,
  `Pattern` and `Mode` (`Text`/`Password`) controls and the same authority/report-state contract.
- **`HA Button`** — the receive-only entity (`button`): no inputs, one `Pressed` bool output that is
  `true` for one cycle per press, `Payload Press` (default `PRESS`), and a hard-wired
  `report_state=False`, so nothing is announced that the device cannot measure.

## Improvements

- **`legacyDefault` for new controls** — the runtime node-definition migration
  (`buildControlValuesForRuntimeSnapshot()`) takes the node's saved control snapshot and seeds
  `legacyDefault` for any control the node predates. Precedence is stored value → `legacyDefault` →
  `default`; a newly created node still gets `default`. Scalar controls only — list controls keep
  using `valueMigration`.
- **The writable entity generators are one generator** — `hassNumber`, `hassSwitch`, `hassSelect`
  and `hassText` are thin wrappers around `codeGeneratorForWritableEntity()`, and a node whose loop
  would be empty (write-only, nothing wired) emits a comment instead of failing the transpiler.
- **Graph rules cover the new nodes** — `ENTITY_NODE_TYPES` now names all seven entity nodes, so
  `hass-icon-invalid` and `hass-availability-missing-flag` also check `hass-text` and `hass-button`;
  the shared definition walker fails when a node type escapes the assertions.
- **Docs follow the behaviour** — `docs/dev/nodes/hass-node-system.md` gained a *Node shapes*
  section (send only / send + receive / receive only, authority matrix, the one-cycle edge, the
  `legacyDefault` rule), the `hass-text` and `hass-button` contracts, the state-less-entity section
  and three new diagnostics rows; `docs/user/mqtt-and-home-assistant.md` gained *Who owns the
  value?* with the two scenarios and the *press is an edge* explanation; the demo collection now
  shows all three shapes.
- **Versions** — `hass` package **0.17.0**. A firmware rebuild is required: the device runs
  precompiled bytecode, so an older `otter_hass.mpy` rejects `report_state=` and keeps announcing a
  state topic for write-only entities. (The per-commit device-version hook bumps the package once
  per commit that touches it, which is why the number is higher than a single feature bump.)
