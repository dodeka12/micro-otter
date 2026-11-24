# Home Assistant Node System

Describes the `hass` node package and its runtime module. The package turns the general
MQTT primitives (`docs/dev/nodes/mqtt-node-system.md`) into Home Assistant MQTT discovery
entities.

## Scope

- `src/micro_otter/nodes/device/node_pkgs/hass/`
- Node definitions: `node_definitions.json`
- Generators: `node_generators.js`
- Runtime: `otter_hass/runtime.py` (imported as `from otter_hass import runtime as _hass`)
- Graph rules: `node_capabilities.js` (registered through `globalThis.GraphRules`)

The package requires the `mqtt` package (`requiredPackages: ["mqtt"]`), so `otter_mqtt/*` is
always on the device, and the `["wifi", "ethernet"]` capability alternative.

### Registration

Two files must list the package, or its nodes never appear in the editor and its runtime
never ships:

- `src/micro_otter/nodes/device/node_pkgs/index.json` — resolves the `hass` id to its folder.
- `src/micro_otter/nodes/device/runtime/general/manifest.json` → `nodePackages.global` — the
  list the editor actually loads (and firmware staging uses to ship `otter_hass/*`). `hass`
  must come **after** `mqtt`.

Node type ids are package-prefixed on the graph (`hass.hass-bridge`, `mqtt.mqtt-read`); the
topic collector and graph rules strip that prefix before matching — see
`docs/dev/nodes/graph-resource-validation.md`.


## Topic scheme

| Purpose | Topic |
|---------|-------|
| Discovery config | `<discovery_prefix>/<component>/<device_id>/<object_id>/config` |
| State | `<topic_prefix>/<device_id>/<component>/<object_id>/state` |
| Command | `<topic_prefix>/<device_id>/<component>/<object_id>/set` |
| Availability | `<topic_prefix>/<device_id>/availability` (`online` / `offline`) |
| Flag availability | `<topic_prefix>/<device_id>/availability/<flag_id>` (`online` / `offline`) |
| Birth | `<discovery_prefix>/status` (Home Assistant publishes `online` / `offline`) |

Defaults: `discovery_prefix = homeassistant`, `topic_prefix = otter`. The device id and every
object id are sanitised (`[^A-Za-z0-9_-]` → `_`) before they become a topic segment, because a
topic segment must survive MQTT wildcards.

## Discovery payload

`register_entity()` merges the caller's `config` with the defaults, and **caller keys always
win**:

| Key | Value |
|-----|-------|
| `name` | the node's `name` control, else the object id |
| `unique_id` | `<device_id>_<component>_<object_id>` — stable across renames, never derived from a topic or an index |
| `device` | `{identifiers: [device_id], name, manufacturer, model, sw_version}` |
| `origin` | `{name: 'Micro-Otter', sw: <sw_version>}` |
| `state_topic` | derived (or an explicit `state_topic=`); **omitted** when `report_state=False` |
| `command_topic` | only for `number`, `switch`, `select`, `text`, `button` |
| `availability_topic`, `payload_available`, `payload_not_available` | `online` / `offline` when availability is on |
| `expire_after` | only when a positive value is configured; the runtime then repeats the state every half window (see below) |

The config is published with `publish_deferred(..., retain=True)` (Phase 1), so it exists
exactly once on the broker after **every** successful connect, and again whenever the birth
message arrives.

## Availability

Three mechanisms, all of them used:

1. **Retained `online`** on `<topic_prefix>/<device_id>/availability`, published through
   `publish_deferred()` so it is replayed after each connect.
2. **LWT** — `configure()` calls `mqtt.configure_will(<availability>, 'offline', retain=True,
   qos=0)` before `start()` runs, so an unclean disconnect leaves `offline` behind.
3. **`expire_after`** per entity, as a liveness watchdog: Home Assistant drops a state that is
   older than this many seconds. The state here is retained and de-duplicated, so a value that
   never changes sends exactly one message — `publish_state()` therefore repeats the unchanged
   value once per half window while the entity has a positive `expire_after`
   (`_state_memo()`). Expiry means "the app stopped running", never "the value stopped
   changing"; see [State publication](#state-publication).

`configure(availability=False)` removes all three (no will, no availability topic), and
`will=False` additionally calls `clear_will()` so a bridge cannot inherit another node's will.

### Device flag, named flags and the availability list

The bridge owns exactly one availability topic (**the device flag**) and exactly one will —
one MQTT connection carries one last will, so a second will node can only replace it (see
`hass-bridge-will-conflict`). Named flags are separate retained topics that any node can
publish; the runtime only knows their topic scheme:

```python
_hass.availability_topic()            # otter/dev1/availability          (device flag)
_hass.availability_topic('heating')   # otter/dev1/availability/heating  (named flag)
_hass.availability_topic('')          # otter/dev1/availability          (empty → device flag)
```

`register_entity()` accepts both forms and keeps them apart:

```python
_hass.register_entity('sensor', 'temperature')                       # scalar, today's shape
_hass.register_entity('sensor', 'temperature', availability=True,
                      availability_flags=['heating'], availability_mode='all')
```

- **No entries (device only).** The scalar keys are emitted exactly as before:
  `availability_topic`, `payload_available`, `payload_not_available`.
- **At least one entry.** Home Assistant forbids the scalar topic and the list together, so the
  config carries `availability: [{topic, payload_available, payload_not_available}, …]` and
  `availability_mode`, and the scalar keys are omitted.
- The entity’s `availabilityFlags` list carries the device topic as the reserved
  `__device__` entry (`Device`). The generator strips that value and maps it to the
  `availability` boolean; `availability_flags` contains only the named flag ids. The device
  topic is entry 1 *only* when `__device__` is selected **and** the bridge has availability
  enabled; the named flag topics follow in the given order.
- **Empty list.** `availability=False` is emitted: the entity announces no availability topic at
  all. This is the one shape an empty list can express that the old checkbox could not.
- Flag ids are sanitised (`[^A-Za-z0-9_-]` → `_`); an id that sanitises to empty is dropped, and
  a config whose flags all sanitise to empty falls back to the device decision alone.
  `__device__` is reserved and cannot be used as a named flag id.
- `availability_mode` is `all` (default, entity is available only when *every* topic says
  `online`), `any`, or `latest`. Unknown values fall back to `all`.
- Both flags declare `payload_available: 'online'` and `payload_not_available: 'offline'`, the
  payloads `hass-availability` publishes.

Existing graphs migrate when the runtime definition snapshot is refreshed:
`availabilityFlags` declares `valueMigration: { fromControl: 'availability', entry: '__device__' }`.
A stored legacy `availability: true` inserts `__device__`, `false` removes it, and the legacy
control is dropped. A node without the legacy key keeps its stored list, so an explicit `[]`
stays “no availability”. See `valueMigration` in the
[node definition reference](node-definition-reference.md).

## State publication

`publish_state(component, object_id, value, retain=True, qos=0, if_changed=True)` publishes
retained and de-duplicated: the memo key is `hass_state_<component>_<object_id>`, so an unchanged
value produces **one** message, not one per loop iteration. That keeps the broker and the log
quiet, and it is what Home Assistant wants for a normal entity.

`expire_after` changes the contract: HA starts its expiry timer with every *message*, so a
single retained message would age out on a perfectly live device (the binary sensor with
`Expire After = 10` went `unavailable` ten seconds after boot although every availability topic
said `online`). `_state_memo()` therefore returns "no memo" — an unconditional publish of the
current value — once per **half** window:

| Situation | Publish |
|-----------|---------|
| No `expire_after` (or `0`) | on change only; the clock is never read |
| `expire_after = 10`, value unchanged | once at the change, then again every 5 s |
| `expire_after = 10`, value changes at t=4 s | immediately, and the next repeat is due at t=9 s |
| `if_changed=False` | every call, unchanged behaviour |

The clock is `utime.ticks_ms()` with `ticks_diff()` (falling back to `time` on the host), so a
tick wraparound cannot suppress a refresh. A loop that blocks longer than half the window still
flaps — the graph, not the runtime, decides how often `publish_state()` runs.

### State-less entities (`report_state=False`)

`register_entity(..., report_state=False)` announces an entity **without** a `state_topic`: the
discovery config carries no `state_topic` key, the runtime registers no publish topic for it, and
`publish_state()` returns `False` without touching the broker. Home Assistant then keeps the value
the user picked ("optimistic"), which is the only honest shape for a value the device cannot
measure and the required shape for a `button`.

- The command topic and its subscription are unchanged, so a state-less entity is still writable.
- Only the components with a command topic (`number`, `switch`, `select`, `text`, `button`) may
  omit the state topic. A `sensor` or `binary_sensor` has no command topic either, so it would end
  up with neither direction: the runtime logs
  `[error] hass: entity: sensor.<id> cannot omit the state topic: component 'sensor' has no command topic either, so the entity would have neither direction (report_state=True used instead)`
  and keeps its state topic.
- `expire_after` is ignored: there is no state message whose timer could expire, and the heartbeat
  of `_state_memo()` never runs for such an entity.
- The registration log names the decision once at boot:
  `entity: button.reset state=none command='otter/dev1/button/reset/set' expire=none availability='…'`.
- A graph written for an older package version that still calls `publish_state()` for such an
  entity logs
  `[warning] hass: state: <component>.<object_id> has no state topic (report_state=False)` once and
  publishes nothing.

## Birth re-announce

Home Assistant publishes `homeassistant/status` = `online` when it starts (not retained).
`configure()` subscribes to it **and** registers `_on_message` as an `otter_mqtt` message hook.
The hook consumes the `poll_birth()` cursor and, when the payload is `online`, calls
`announce_all()` (every stored config, forced re-publish). That is the ESPHome behaviour: an HA
restart re-discovers the device even when the broker lost the retained configs.

`poll_birth()` remains as the pull-based fallback for code generated by an older package version
that still emits the loop statement. Both paths share the `_hass_birth` cursor, so whichever runs
first consumes the message and the other stays silent — there is never a double re-announce.
`configure()` uses `getattr(mqtt, 'on_message', None)`, so a `hass` package compiled against an
older `mqtt` package without message hooks degrades to today's polling behaviour instead of failing
inside `init_mqtt()`.

## Fail loudly

Calling `state_topic()`, `command_topic()`, `register_entity()` or `publish_state()` before
`configure()` raises `RuntimeError('hass: configure() must run before …')`. A graph that uses
entity nodes without a bridge node therefore logs an error instead of publishing to
`homeassistant/...` with an empty device id.

## Diagnostics

| Line | Severity | Meaning |
|------|----------|---------|
| `configure: device='…' name='…' discovery='…' topic='…' availability=…` | info | Bridge settings in effect. |
| `configure() called again; the last hass-bridge wins (device='…')` | info | Two bridge nodes; the second replaces the first. |
| `entity: <component>.<object_id> state='…' command='…' expire=<n>s availability='…' mode=…` | info | One discovery config was registered. `state=none` marks a state-less entity (`report_state=False`), `expire=none` and `availability=none` mean the entity announces no expiry and no availability; `mode=` appears only in HA's list form (device entry plus named flags). |
| `connected: entities=<n>` | info | The `on_connect` hook ran; retained payloads were replayed by the MQTT runtime. |
| `birth: re-announcing <n> entities` | info | The birth message hook saw `online` and re-published every config. |
| `entity: <component>.<object_id> publish[ and subscribe] with MQTT disabled (enabled=false in /mqtt_settings.json), so every topic stays on the device: state='…' command='…'` | warning | An entity was registered while MQTT is switched off. The discovery config, the state topic and the command subscription are queued by `otter_mqtt` and never connect; printed once per entity. Enable MQTT in the runtime settings. |
| `state: <component>.<object_id> publish with MQTT disabled (enabled=false in /mqtt_settings.json), topic='…' is queued only` | warning | The first state publish of an entity while MQTT is off; printed once per entity, not per value. |
| `entity: <component>.<object_id> cannot omit the state topic: component '<component>' has no command topic either, so the entity would have neither direction (report_state=True used instead)` | error | `report_state=False` on a component that has no command topic. The entity keeps its state topic; nothing else changes. |
| `state: <component>.<object_id> has no state topic (report_state=False)` | warning | `publish_state()` was called for a state-less entity. Nothing is published; printed once per entity. |

The two warnings exist because a disabled transport is silent by design: `otter_mqtt` accepts
every publish and subscription, stores it and never connects, so without them a healthy-looking
log and an empty Home Assistant are the same picture.

## "Home Assistant shows nothing" — what this package can fix

| Symptom | Cause | Fix |
|---------|-------|-----|
| No entity at all | Bridge missing, so no discovery config | Add `hass-bridge`; the package's graph rule flags entity nodes without a bridge |
| Entity disappears after an HA restart | Broker lost the retained configs | The bridge re-announces on `<discovery_prefix>/status` |
| Entity `unavailable` after a power cut | Will did not arrive | `will` must stay enabled and the availability payload must reach the broker |
| Entity `unknown` | State not retained and nothing published since HA subscribed | Entity nodes publish retained state |
| Entity `unavailable` a few seconds after it appeared | The entity carries `expire_after` and its graph loop does not call `publish_state()` often enough (or the runtime on the device is older than `hass` 0.10.0 and never repeats the value) | Set `Expire After` to `0` and let the availability flags decide, or keep the loop faster than half the window |
| Entity duplicates after a reboot | `unique_id` derived from something volatile | `unique_id` is built from device id + component + object id only |
| Bool always `off` | `payload_on`/`payload_off` mismatch | The package pins them to `true`/`false`, matching the runtime's own bool encoding |
| `value_template` errors | JSON payload but no `value_json`, or the reverse | Use `json-store` payloads together with `value_json` templates, or plain scalars |

## Related

- `ldev/ideas/2026-11-04-homeassistant-mqtt-entities.md` — the HA analysis behind this package.
- `docs/dev/nodes/mqtt-node-system.md` — the runtime primitives
  (`configure_will`, `publish_deferred`, `on_connect`, `json_payload`).
- `docs/dev/nodes/node-validation-architecture.md` — where a check belongs (graph rules, L3);
  `docs/dev/nodes/graph-resource-validation.md` — the graph-rule registry details.

## Node shapes

Three shapes cover every Home Assistant integration. Pick the shape first, then the controls.

| Shape | Nodes | Topics | Discovery |
|-------|-------|--------|-----------|
| send only | `hass-sensor`, `hass-binary-sensor` | state only | announced, the device publishes |
| send + receive | `hass-number`, `hass-switch`, `hass-select`, `hass-text` | state + command | announced, both directions |
| receive only (event) | `hass-button` | command only | announced **without** `state_topic` |
| receive only (free topic) | `mqtt-read` (not a `hass-*` node) | any topic, no discovery | nothing announced |

A pure listener needs **no** `hass-*` node at all: `mqtt-read` subscribes to any topic, offers
`valueType` and `jsonKey`, and its `Updated` output is the same one-cycle edge. Use it when the
device only consumes something Home Assistant (or another system) publishes and the entity must
not appear in the dashboard as a controllable device.

### Authority matrix

`hass-number`, `hass-switch`, `hass-select` and `hass-text` are identical here; only the value type
differs.

| `Authority` | `Value` (0) | `Command` (1) | `Updated` (2) | State published |
|-------------|-------------|---------------|---------------|-----------------|
| `device` (default) | the input | last command, or the input before the first command | `true` in the cycle a new command arrived | the input |
| `homeassistant` | last command, or the input before the first command | repeats `Value` | `true` in the cycle a new command arrived | the input when wired, else `Value` |

**When to use which.**

- **Home Assistant** when the device value is *derived* from the command: a timer that Home
  Assistant sets and the device counts down, an optimistic control whose real value the device
  cannot measure, a fan speed the device only forwards.
- **Device** when the device owns the value: a setpoint the device measures back, a relay the
  graph drives from a button or a schedule, a mode the device picks itself. The Home Assistant
  command then arrives on `Command`/`Updated` instead of silently overwriting `Value`.

### The one-cycle edge

`Updated` — and `Pressed` on `hass-button` — is `true` in exactly one loop iteration per new
message. Both consume the command topic under a **per-node** key (`hass_cmd_<nodeId>`), not under
the runtime's default key (the command topic): two nodes that watch the same entity would otherwise
steal the edge from each other, and only one of them would ever see it. A graph that needs the
*value* of a command should read `Value`/`Command`; `Updated` only answers "did something arrive?".

### Legacy default of `authority`

The control ships with `"default": "device"` **and** `"legacyDefault": "homeassistant"`, so a node
saved before the control existed keeps the old behaviour when the collection is loaded, while a
newly created node starts with `device` (see `legacyDefault` in the
[node definition reference](node-definition-reference.md)). The generator adds the same fallback
for a node whose `controlValues` never went through the migration: a **missing** `authority` means
`homeassistant`.

## Nodes

All nine nodes declare `initFunction: "init_mqtt"`, so the transpiler emits one shared init
function with every block before the single `_mqtt.start()` execute block.

| Priority | Contribution | Source |
|----------|--------------|--------|
| 1 | `_hass.configure(...)` | `hass-bridge` |
| 5 | `_hass.register_entity(...)` | `hass-sensor` / `-binary-sensor` / `-number` / `-switch` / `-select` / `-text` / `-button` |
| 5 | `_mqtt.register_publish(<flag topic>)` | `hass-availability` |
| 10 | `_mqtt.configure_will`, `_mqtt.register_subscription`, `_mqtt.register_publish` | `mqtt-will`, `mqtt-read`, `mqtt-write`, `mqtt-announce`, entity subscriptions |
| execute | `_mqtt.start()` | any node with an `execute` block (emitted once) |

Because `configure()` is `priority: 1` and every `register_entity()` is `priority: 5`, a `hass-bridge`
in a **different** graph of the same collection still runs before every `register_entity()` — the
blocks are merged collection-wide and sorted by priority, not by the order the editor iterated the
graphs.

### `hass-bridge`

- Controls: `deviceId` (required), `deviceName`, `discoveryPrefix` (default
  `homeassistant`), `topicPrefix` (default `otter`), `availability` (default on), `will`
  (default on), `manufacturer` (default `Micro-Otter`), `model`, `swVersion`.
- No inputs, no outputs.
- Init (`priority: 1`): `_hass.configure(...)`, then `_mqtt.start()`.
- Loop: none — the node is init-only (the generator emits a comment); the birth re-announce runs in
  the runtime message hook, so the bridge may sit in an `Init` (startup) graph.
- Two bridges: the second `configure()` replaces the first and logs
  `configure() called again; the last hass-bridge wins`.

### `hass-availability`

- Controls: `id` (required, "Availability ID").
- Inputs: `value` (bool, default `false`); no outputs.
- Init (`priority: 5`): `_mqtt.register_publish(topic=_hass.availability_topic('<id>'), qos=0)`
  — bookkeeping only, so the topic shows up in the device log.
- Loop: `_mqtt.publish_deferred(topic=_hass.availability_topic('<id>'), payload=('online' if
  (<value>) else 'offline'), qos=0, retain=True, key='_hass_avail_<node>',
  if_changed='_hass_avail_last_<node>')` — the same on-change contract as `mqtt-announce`, so the
  retained payload is written once on the first connect and thereafter only when the input flips.
- **No will, no entity.** The node is a topic provider: it never calls `configure_will()` and
  never registers a discovery config. The id is passed to the runtime **unsanitised**; the
  runtime's `_sanitize_id()` (`[^A-Za-z0-9_-]` → `_`, trimmed, case preserved) builds the topic
  segment, so the generator and the graph rules can never disagree about the topic.
- Empty `id`: init and loop both degrade to `# hass availability: id is empty`, and the graph
  rule `hass-availability-invalid-id` badges the node.
- Palette icon: `icons/cloud_alert_24dp.svg` (Material Symbols `cloud_alert`, outlined 24dp, added
  with the workflow in `docs/workflow/adding-icons.md`). The node
  reports the state of a *connection*, not a sensor reading, so it must not reuse the
  `binary_sensor` glyph it shared with `hass-binary-sensor`; `tests/data/node-icon-material-mappings.test.js`
  pins the mapping and the themed `fill`.

### Collection layout

One `hass-bridge` per collection, typically in the `Init` graph; the `hass-*` entity nodes may live
in any graph. `init_mqtt()` is collection-wide: the bridge configures the device card and the entity
nodes register themselves into it, in that order, regardless of which graph holds which node.

### Entity nodes

Shared controls: `objectId` (required), `name` (empty → the object id), `icon`
(`mdi:…`, picked through the searchable MDI picker), `availabilityMode` (default `all`) and
`availabilityFlags` (multi-select, default `['__device__']`). The topics are derived — no node
asks for one.

`availabilityFlags` lists the collection's availability topics. The first entry is always the
reserved `Device` value (`__device__`); named flags from `hass-availability` nodes
follow. The list expresses the whole availability policy:

| Selection | Generated registration |
|-----------|------------------------|
| `['__device__']` | scalar form (device topic, today’s default) |
| `['__device__', 'heating']` | `availability=True`, `availability_flags=['heating']` |
| `['heating']` | `availability=False`, `availability_flags=['heating']` |
| `[]` | `availability=False` (no availability topic) |

`availabilityMode` only matters once a named flag is present; `availabilityFlags` is
collection-wide (`availabilityRefs`).

The `authority` control decides who owns the value. A node **without** an `authority` value
behaves like `homeassistant` — the behaviour every node had before the control existed — while the
definition's `default` (`device`) applies only to a node created from the current definition.
Existing collections reach `homeassistant` through `legacyDefault`, so both paths agree; a
transpile that is fed a node whose `controlValues` never went through the runtime migration (a
fixture, an old export) keeps the legacy behaviour too.

| Node | Component | Input | Outputs | Extra controls |
|------|-----------|-------|---------|----------------|
| `hass-sensor` | `sensor` | `value` (any) | – | `deviceClass`, `unit`, `stateClass`, `expireAfter` |
| `hass-binary-sensor` | `binary_sensor` | `value` (bool) | – | `deviceClass`, `expireAfter` |
| `hass-number` | `number` | `value` (any) | `value` (float), `command` (float), `updated` (bool) | `min`, `max`, `step`, `mode`, `unit`, `authority`, `reportState` |
| `hass-switch` | `switch` | `value` (bool) | `value` (bool), `command` (bool), `updated` (bool) | `payloadOn`, `payloadOff`, `authority`, `reportState` |
| `hass-select` | `select` | `value` (string) | `value` (string), `command` (string), `updated` (bool) | `options` (comma separated), `authority`, `reportState` |
| `hass-text` | `text` | `value` (string) | `value` (string), `command` (string), `updated` (bool) | `min`, `max` (length in characters), `pattern`, `mode` (`text` / `password`), `authority`, `reportState` |
| `hass-button` | `button` | – | `pressed` (bool) | `payloadPress`; no `authority`, no `reportState`, no `expireAfter` |

`registerEntityStatement()` in `node_generators.js` owns the emit and stays backward-compatible:
a node without the new list (or with only `__device__`) produces the same scalar call as before.
A legacy `availability` value that is still stored wins over the list until the runtime migration
rewrites the node.

```python
# device entry only — unchanged scalar form
_hass.register_entity('sensor', 'temperature', config={})

# device entry plus one named flag — the runtime switches to HA's list form
_hass.register_entity('sensor', 'temperature', config={}, availability=True,
                      availability_flags=['heating'], availability_mode='all')

# no availability at all
_hass.register_entity('sensor', 'temperature', config={}, availability=False)
```


Generated code:

```python
# init_mqtt()
_hass.register_entity('sensor', 'temperature',
                      config={'icon': 'mdi:thermometer', 'device_class': 'temperature',
                              'unit_of_measurement': 'C'},
                      name='Temperature')

# loop
_hass.publish_state('sensor', 'temperature', (node_3_out0), retain=True)
```

The `icon` key is the first config entry and is emitted verbatim (no `mdi:` normalisation — a
bare `thermometer` reaches Home Assistant and is reported by the `hass-icon-invalid` graph rule).
An empty or absent icon control emits **no** `icon` key at all, so the generated Python of a
collection without icons is byte-for-byte what it was before the picker existed, and Home
Assistant falls back to its own default icon for the component.

### Writable entities: authority, outputs and state

`hass-number`, `hass-switch` and `hass-select` (plus `hass-text`) own a value that both sides can
change, so they carry three outputs and two extra controls. The whole contract hangs on one
question: **who owns the value?**

| Control | Values | Meaning |
|---------|--------|---------|
| `authority` | `device` (default) / `homeassistant` | who owns the `Value` output |
| `reportState` | on (default) / off | publish the input as the entity state |

| # | Output | Type | Meaning |
|---|--------|------|---------|
| 0 | `Value` | the node's value type | the input under **Device**, the last command under **Home Assistant** |
| 1 | `Command` | same as `Value` | last value Home Assistant sent, or the input before the first command |
| 2 | `Updated` | `bool` | `true` in the single cycle in which a new command arrived |

Authority `device` — the device owns the value, an HA command is only an event:

```python
node_5_out0 = node_3_out0
node_5_out1 = _hass.latest_command('number', 'target', value_type='float', default=(node_3_out0))
node_5_out2 = _hass.take_command('number', 'target', value_type='float', key='hass_cmd_5')
_hass.publish_state('number', 'target', (node_3_out0), retain=True)
```

Authority `homeassistant` — the value Home Assistant set is the value the graph works with
(the behaviour every writable node had before the control existed):

```python
node_5_out0 = _hass.latest_command('number', 'target', value_type='float', default=(node_3_out0))
node_5_out1 = node_5_out0
node_5_out2 = _hass.take_command('number', 'target', value_type='float', key='hass_cmd_5')
_hass.publish_state('number', 'target', (node_5_out0), retain=True)
```

- Each output is emitted **only when it is wired**, in output order, so a graph that reads
  nothing pays nothing and the generated code of an old graph does not grow a single line.
- `Command` reuses the `Value` variable while Home Assistant owns the value — one runtime call
  for two outputs.
- `Updated` consumes under `hass_cmd_<nodeId>`, **not** the runtime's topic default: two nodes on
  the same entity would otherwise steal the edge from each other (the default key is the command
  topic).
- A node **without** an `authority` value behaves like `homeassistant` (see
  [Entity nodes](#entity-nodes)). A definition default of `device` must never leak into an old
  node, which is why the generator spells the legacy fallback out.
- `Report State` off emits no `publish_state(...)` line at all and appends `report_state=False` to
  the registration — a write-only control (see
  [State-less entities](#state-less-entities-report_statefalse)).

### `hass-text`

The fourth writable component. It is the same node shape as `hass-select` with a string value and a
length contract instead of an option list:

```python
_hass.register_entity('text', 'label',
                      config={'icon': 'mdi:tag', 'min': 0, 'max': 32,
                              'pattern': '[a-z]+', 'mode': 'text'},
                      name='Label')
```

- `min` and `max` are the accepted length in characters and are **always** emitted — they are the
  node's contract, and Home Assistant's own defaults (0…255) are not the contract. `pattern` is an
  optional regular expression and is omitted while empty (`configLiteral` drops empty values).
- `mode: password` is the one Home Assistant side effect users notice: the dashboard masks the
  field, the payload is still plain text on the device side.
- `mode` is the only dropdown, so the connector types do not follow it — a `hass-text` node always
  has a string input and string value/command outputs.

### `hass-button`: press is an edge

The receive-only shape. A Home Assistant `button` has no value: it is pressed, the device gets one
message on the command topic, and Home Assistant keeps no state (its own entity state is a
timestamp).

```python
# init_mqtt() — report_state=False is the point: no state topic is announced
_hass.register_entity('button', 'restart',
                      config={'icon': 'mdi:restart', 'payload_press': 'PRESS'},
                      name='Restart', report_state=False)

# loop — the press is consumed once per node, not once per entity
node_7_out0 = _hass.take_command('button', 'restart', value_type='string', key='hass_cmd_7')
```

- `Pressed` is `true` for exactly **one cycle** per press, like `Updated` on a writable node, and it
  uses the same per-node consume key. An unconnected `pressed` output emits a comment instead of a
  runtime call.
- `Report State` and `Authority` do not exist here: there is no value to own and nothing to publish.
  `report_state=False` is hard-wired in the generator, and the runtime accepts it because `button`
  is in `WRITABLE_COMPONENTS`.
- `Payload Press` (default `PRESS`) is the payload Home Assistant publishes. The runtime `button`
  component has no other config; `expire_after` is pointless and therefore not offered.

**State source rule.** When the `value` input is wired, the state published is the graph's
value (the device is authoritative) and the command is still offered on the output. When the
input is unwired, the entity is *optimistic*: HA's command becomes the output and is echoed
back as the state. The connection flag (`inputsMeta`), not the input literal, decides — an
unconnected input still carries the node's default literal. Both authorities use the same rule:
under `device` the `Value` output *is* the input, so an unwired input publishes its literal.

**Payload encoding.** `hass-binary-sensor` and `hass-switch` pin `payload_on: 'true'` and
`payload_off: 'false'`, matching the runtime's own bool encoding (`b'true'` / `b'false'`).

**Icon values.** Every entity node's `icon` control is a searchable MDI picker
(`type: "icon"`). The value grammar is `<set>:<name>` (`mdi:thermometer`); a bare name
means the `mdi` set, a foreign set (`ph:house`, `hue:light`) is passed through untouched,
and free text is always accepted — the picker only helps, it never validates the field.
The picker searches icon names **and** MDI aliases (`user` finds `account`). The bundled
index is pinned to MDI 7.4.47 (`tools/generate-mdi-icons.mjs`), so an icon that only
exists in a newer MDI release is not listed but can still be typed by hand; the picker
shows a soft hint instead of rejecting the value. Icons ship with the app (vendored
WOFF2 + generated index), so the picker works offline.

**Empty `objectId`.** Both the init and the loop statement degrade to a comment
(`# hass sensor: objectId is empty`), so a half-configured node never publishes to a topic
with an empty segment.

### Graph rules

`node_capabilities.js` registers six graph rules through the shared registry
(`globalThis.GraphRules`; see `docs/dev/nodes/graph-resource-validation.md`). The canonical table
with every rule id, scope and message is
`docs/dev/nodes/node-validation-architecture.md`; the behaviour in practice:

- `hass-requires-bridge` — with no `hass-bridge` anywhere in the collection, every `hass-*`
  entity node of the current graph gets the badge
  `Home Assistant entities need a hass-bridge node in the collection: nothing is announced without it.`
  With more than one bridge in the collection, every bridge of the current graph gets
  `More than one hass-bridge in the collection: the last one wins and replaces the device card.`
  Because node ids are per graph, the badge only ever lands on a node of the graph on screen.
- `hass-bridge-will-conflict` — the bridge brings its own will (`availability` and `will` both
  default to `true`), so a competing `mqtt-will` node in the collection is flagged. The will
  node gets `Only one will fits into the MQTT connect: the hass-bridge in the collection already sets '<topic>'. This node's will replaces it.`; the bridge gets
  `Only one will fits into the MQTT connect: the MQTT Will node(s) in the collection set '<topics>'. The last one configured wins.`
  A bridge with `will: false` or `availability: false` owns no will and stays silent.
- `hass-availability-duplicate-id`, `hass-availability-invalid-id`,
  `hass-availability-missing-flag` — the availability-flag trio; `docs/dev/nodes/hass-node-system.md`
  "Availability flags" section and the architecture page carry the messages. The missing-flag
  rule ignores the reserved `__device__` entry, which is not backed by a `hass-availability`
  node.
- `hass-icon-invalid` — a `graph`-scoped syntax check on all seven entity nodes: an icon must be
  `<set>:<name>` (`mdi:thermometer`, `ph:lightbulb-on`, `hue:light`), so a bare `thermometer`, an
  empty name (`mdi:`), upper case (`MDI:Thermometer`), a space (`mdi:thermo meter`) or an extra
  colon (`mdi::x`) badges the node with
  `icon '<value>' must be written as '<set>:<name>', e.g. 'mdi:thermometer'.` An empty icon is
  fine (the generator emits no `icon` key), and an **unknown but well-formed** name
  (`mdi:brand-new-icon`) is deliberately *not* an error: `run()` is synchronous while the MDI
  index is an async fetch, so the picker carries that hint instead (Phase 3 soft hint).

### Known limitation

`hass-select` (and any node fed by `select`) receives a **string** when the value input is
unwired: the input's `defaultControl` is a text widget, so an unconnected input always
contributes a string literal. Typed defaults need a `const` node.
