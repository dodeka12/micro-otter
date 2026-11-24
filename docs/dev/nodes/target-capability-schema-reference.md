# Target Capability Schema Reference

**Status:** Contract
**Scope:** The device-target capability model — canonical ids, pin addressing, capability keys,
resources, and the registry/checker design decisions.

## Purpose

Authoritative reference for the device-target capability schema and the conventions that all target
JSON files and capability consumers must follow. This document is the single source of truth for the
extended model introduced in
`ldev/todos/2026-10-23-extended-device-target-capabilities/`.

## Canonical Bus / Port / Peripheral Ids

| Kind | Canonical ids | Coercion |
|---|---|---|
| I2C buses | `i2c0`, `i2c1` | numeric `0` → `i2c0`, `1` → `i2c1` |
| UART ports | `uart0`, `uart1`, `uart2` | numeric `0` → `uart0`, … |
| SPI buses | `vspi`, `fspi` | `"v"` → `vspi`, `"f"` → `fspi` |
| ADC units | `1`, `2` | integer only |
| I2S controllers | `0`, `1` | integer only |

Rules:

- Unknown strings pass through unchanged.
- Non-string / non-number input (and numeric SPI ids) normalize to `null`.
- Canonical ids are **emitted** everywhere; numeric ids are only ever *accepted* on input
  (`normalizeBusId`).

## Pin Addressing

- Integer pin ids are canonical (`7`, `21`, …). Numeric strings (`"7"`) normalize to integers.
- Non-numeric string ids (`"PA0"`, `"GP0"`) are accepted and preserved as string keys, so port-based
  boards (STM32, RP2040) are modelable.
- Port + pin tuples (`{ "port": "B", "pin": 1 }`) normalize to the stable string key `"B1"`.
- Invalid input (`null`, empty objects) normalizes to `null` and is skipped during loading.

## Pin Claims

Each pin may carry an advisory `claims` array describing board-level facts a capability check
cannot infer from the pin's capabilities alone:

```jsonc
"43": {
  "label": "GPIO43",
  "claims": [
    {
      "role": "console.tx",
      "conflicts": ["digital.output", "pwm.output"],
      "severity": "warn",
      "note": "UART0 TX bridged to the USB serial console; driving it as an output disables the console."
    }
  ]
}
```

Fields:

- `role` — a dotted, machine-readable label in a reserved namespace: `console.tx` / `console.rx`
  (serial console), `usb.dminus` / `usb.dplus` (native USB), or `onboard.led` (plus `.red` /
  `.green` / `.blue` for a discrete RGB LED).
- `conflicts` — capability keys the claim applies to; an empty array matches every capability.
- `severity` — `warn` (breaks a core function) or `info` (cosmetic, e.g. a shared onboard-LED
  indicator).
- `note` — human-readable consequence.

Rules:

- Claims are **advisory**: they produce diagnostics and pin-picker annotations, never hide or
  disqualify a pin (a claim true for one board revision may be false for another).
- For bundled targets, claims only restate facts already recorded in the file's prose.
- Onboard-LED pins are recorded **only where known** (custom configs and future boards); the
  bundled ESP32 targets omit `onboard.led` because the pin differs between revisions (GPIO48 vs
  GPIO21). No LED pin defaults are ever derived automatically.

## Backward-Compatibility Contract

- All new fields are optional; absent fields default to `null` / `false` / `[]` and never break
  loading.
- `capabilityToPins` keeps every current aggregate key (`digital.*`, `pwm.*`, `pull.*`, `adc`,
  `uart`, `i2c`, `spi`) and only *adds* granular keys.
- `pull` remains a string array (`["up","down"]`); resistor values live in a separate
  `pullValuesOhm` field.
- Normalizers accept both camelCase and snake_case variants (`frequency_hz`/`frequencyHz`,
  `resolution_bits`/`resolutionBits`).

## Typed Structure Decision

Capabilities are modeled with **data types, not a class hierarchy**:

- A discriminated union `CapabilityDefinition` (one `kind` tag per capability).
- A `CapabilityDescriptor` interface (plain data: `id`, `derivedKeys`, `icon`, `limitKey`, `check`,
  optional `normalize`).
- A `CapabilityRegistry` class mirroring `DataTypeRegistry` (`register`, built-ins,
  `get`/`has`/`getAll`).
- A `CheckStrategy` union for the only behavior that varies (`membership` | `count` | `constraint`).

Do not introduce a `Capability` class hierarchy; new capabilities are data registered through the
registry, not subclasses.

## Layered Checker Strategy

Validation is one generic pipeline, not one checker per capability:

1. **Membership** — `hasPinCapability(pin, key)`.
2. **Count** — declared usage counted against `resources` via `descriptor.limitKey`.
3. **Constraint** — declarative cross-capability rules (`{ when, forbid }`), evaluated by one engine.
4. **Bespoke handler** — the imperative `capabilityCheck`, reserved for node-specific logic; never
   per-pin-type.

## Capability Registry

`CapabilityRegistry` (`src/micro_otter/nodes/html/js/data/capability-registry.ts`) mirrors
`DataTypeRegistry`: `register(descriptor)`, `get(id)`, `has(id)`, `getAll()`.

Descriptors are authored as **JSON** under `src/micro_otter/nodes/device/capabilities/`
(`pins.json`, `general.json`; listed by `index.json`). This JSON is the **single source of truth**,
read by both the TypeScript `CapabilityRegistry` and the Python firmware resolver
(`src/micro_otter/tools/firmware_compile/capability_registry.py`). Adding a new domain file
requires updating `index.json` (Python) and the static import list in `capability-registry.ts` (JS).

Built-in descriptors: `digital`, `pwm`, `pull`, `adc`, `dac`, `touch`, `uart`, `i2c`, `spi`,
`i2s`, `rtc`, and the general capabilities `math`, `viper`, `wifi`, `bluetooth`, `ethernet`.

A `CapabilityDescriptor` carries: `id`, `kind`, `domain` (`pin` | `general`; default `pin`),
`derivedKeys`, `icon`, `glyph` (a single-character text badge used when `icon` is absent),
`limitKey`, `check` (`membership` | `count` | `constraint`), and optional `constraints`.
`normalize` is a code-only field and is not carried in the JSON descriptors. A `general`
capability is checked against `generalCapabilities`; a `pin` capability is checked against the
pin capability map.

`register()` rejects duplicate ids and malformed descriptors (missing id / empty `derivedKeys`).

## Extended Per-Pin Fields

| Field | Shape |
|---|---|
| `digital.openDrain` | `boolean` |
| `pullValuesOhm` | `{ up?: number; down?: number }` |
| `fixedPull` | `"up" \| "down" \| null` — pin's internal pull is hard-wired to this direction |
| `adc.unit` | `1 \| 2` |
| `adc.wifiConflict` | `boolean` |
| `dac` | `{ channel?: number; resolution_bits?: number }` |
| `touch` | `{ channel?: number }` |
| `uart` | `{ port?: string; roles: string[] }` |
| `i2c` | `{ bus?: string; roles: string[]; frequency_hz?: { min?: number; max?: number } }` |
| `spi` | `{ bus?: string; roles: string[] }` |
| `i2s` | `{ controller?: number; roles: string[] }` |
| `rtc` | `{ gpio: boolean }` |
| `strapping` | `{ role?: string; safeLevel?: 'high' \| 'low' \| 'either' \| null }` |
| `reserved` | `{ reason?: string }` |
| `voltage` | `{ maxV?: number; tolerant5v?: boolean; analogMaxV?: number }` |

All fields are optional; invalid values normalize to `null` / the safe default rather than throwing.

`dac` exists only on the classic **ESP32** (GPIO25/GPIO26) and the **ESP32-S2** (GPIO17/GPIO18,
8-bit, channels 1 and 2). The ESP32-S3 and ESP32-S3 Mini expose **no** DAC pins. A target with zero
`dac` pins has two visible consequences: the DAC pin picker resolves to `disabled: true` with no
options, and `dac-output` fails its derived pin requirement with
`Missing required capability: dac` (the per-pin `does not support dac` line is suppressed because no
pin could ever satisfy it).

Target authors set `fixedPull: "up"` or `fixedPull: "down"` when a board hard-wires an internal
pull resistor on a pin; the node UI then disables the `pull` dropdown and shows the fixed value.

Matrix-routed peripherals (`uart`, `i2c`, `spi`, `i2s`) use a `roles` array because a single pin can
serve multiple roles (e.g. `"i2s": { "roles": ["bclk", "ws", "din", "dout"] }`).

## Open Pin Set (built-in targets only)

A built-in target can declare a top-level `openPins` range instead of a per-pin capability map:

```jsonc
"openPins": { "min": 0, "max": 255 }
```

When present, `DeviceTargetInfo.isOpenPinSet` is true: every pin-select dropdown offers the whole
range for every capability, `getPinCapability` synthesizes a permissive capability (digital in/out,
pull up/down), and capability/graph validation is bypassed — correctness is the user's
responsibility.

`openPins` is **built-in only**: user-uploaded target configs that declare `openPins` are rejected
(`ERR_TARGET_OPEN_PINS`) so uploads always remain validated. A derived user target inherits its
base's `openPins` (it cannot set its own).

## Derived Targets (shipped + user, no Custom target)

Shipped target files live in `device/targets/` and are listed by `device/targets/index.json`:
`generic_micropython.json` (open pin set, validation bypassed), `esp32_wroom.json` (classic ESP32),
`esp32_s2.json` (ESP32-S2, DAC on GPIO17/18), `esp32_s3.json` (chip-level ESP32-S3) and
`esp32_s3_mini.json` (a delta over `esp32_s3`).

A derived target is a **base plus sparse overrides**, not a full hardware descriptor. A user target
stores that shape in IndexedDB; a shipped target declares the same shape directly in its
`device/targets/<id>.json` file (with `targetId`/`displayName`/`description` at the top level):

```jsonc
{
  "id": "my_esp32_wroom",
  "displayName": "My ESP32-WROOM",
  "baseTargetId": "esp32_wroom",
  "targetData": {
    "pinCapabilities": { "5": null },
    "metadata": { "notes": ["Pin 5 removed."] }
  }
}
```

`baseTargetId` must name a shipped target (no `custom`). The sparse `targetData` is merged onto the
base by `mergeTargetPayload()` (`target-resolution.ts`) and its Python mirror
(`firmware_compile/target_resolution.py`): scalars replace, `pinCapabilities[pin]` merges per pin
(`null` removes the pin), `resources`/`generalCapabilities`/`capabilityToPins` merge key-wise with
the override winning, `metadata` merges key-wise with `notes` concatenated (base first), and
`openPins` is inheritable-only. One `TargetResolver` walks the chain to an effective payload plus a
terminal **build base id**; the chain is guarded (unknown base, cycle, depth 8, duplicate
`openPins`). The Custom target was removed in M4w — its two jobs are now a derived target
(validation-off profiles are gone; validation always runs) and `generic_micropython` (the "board
unknown" answer). An imported payload carrying `metadata.isCustomTarget` is rejected
(`ERR_TARGET_CUSTOM_DEPRECATED`).

## Stored `active_target.json` Payload

The file the app writes to `/device/targets/active_target.json` is a *resolved effective payload*:
the derived-target merge already happened on the host, so the file contains the complete pin and
resource data plus the four delivery header fields `targetId`, `displayName`, `description` and
`configVersion`.

A stored payload must carry pin information — a non-empty `pinCapabilities` map, or an `openPins`
range for the open-pin target. A payload without it (the legacy firmware bootstrap skeleton:
`targetId`, `displayName`, `description`, `configVersion`, `capabilities`) is treated as **not
configured** by the app: the reader does not build a `DeviceTargetInfo`, the device is reported as
needing a target, and the onboarding dialog rewrites the file. The rule is
`isCompleteActiveTargetPayload()` in `js/data/target-payload.ts`, used by both the writer and the
reader.

`capabilityToPins` is a **derived** map built from the per-pin records — never a stored
`capabilities` blob. The payload therefore has no `capabilities` key any more, and no host code
reads one.

## Open `peripherals` Bag

A pin may carry arbitrary long-tail peripherals:

```jsonc
"peripherals": { "can": { "bus": "can0", "role": "rx" } }
```

Entries follow one of two generic shapes — `{ bus|port|controller, role }` (matrix-routed buses) or
`{ channel, resolution_bits }` (converters). `normalizeGenericPeripheral()` extracts the known
fields, and `buildCapabilityMap()` emits an aggregate key (`can`) plus role keys (`can.rx`) for any
payload that has a `role`. New peripherals therefore need **no core code change**.

## Capability Key Naming

`buildCapabilityMap()` derives keys in four granularities:

| Granularity | Example | Source |
|---|---|---|
| Aggregate | `adc`, `i2s`, `dac`, `touch`, `rtc` | pin has the capability |
| Role | `i2c.sda`, `uart.tx`, `spi.cs`, `i2s.bclk` | `roles` field |
| Unit | `adc.unit1`, `adc.unit2`, `adc.wifiSafe` | `adc.unit` field |
| Bus-qualified (opt-in) | `i2c.i2c0.sda`, `uart.uart0.tx` | `emitBusQualifiedKeys` |

Aggregate keys are always preserved for backward compatibility; role/unit/bus keys are additive.
Bus-qualified keys are opt-in via `new DeviceTargetInfo(payload, { emitBusQualifiedKeys: true })`.

## Target-Level Resources

`resources` describes finite/shared hardware pools (numeric counts; `null` = unknown → no limit
check). A limit value may be:

- a **scalar** — a whole-pool count (`pwm.channels: 16`);
- a **list** — a set of values (`adc.wifiConflictedUnits: [2]`);
- a **per-instance map** — per-instance counts keyed by instance id, for pools whose instances
  differ (`adc.channelsPerUnit: { "1": 8, "2": 10 }`).

```jsonc
"resources": {
  "pwm": { "channels": 8, "timers": 4 },
  "adc": { "units": 2, "channelsPerUnit": { "1": 8, "2": 10 }, "wifiConflictedUnits": [2] },
  "uart": { "ports": 3 },
  "i2c": { "buses": 2 },
  "spi": { "buses": 2 },
  "i2s": { "controllers": 2 }
}
```

Counts are addressed by each capability's `descriptor.limitKey` (e.g. `pwm.channels`), so the
pool-exhaustion check stays generic. When a descriptor declares `limitInstances: { prefix }`, usage
keys of the form `<id>.<prefix><instance>` (e.g. `adc.unit2`) are counted against the matching
per-instance map entry instead of a single scalar.

## General Capabilities

`generalCapabilities` is an open map; targets may include:

- `wifi`: `{ supported, generation, coexistsWithBle }`
- `bluetooth`: `{ supported, version, le }`
- `concurrency`: `{ cores, threading, async }`
- `peripherals`: `{ pcnt, rmt, touch }`

plus the existing `math` block and `viper` (`{ supported: true | false }`). Unknown fields
pass through untouched.

General capabilities are rendered in the device-info view from their registry descriptor:
a `glyph` (single-character text badge) is shown when present, otherwise the `icon`, otherwise
the plain key.

## General Firmware-Capability Pattern

A firmware/device-level capability (e.g. `viper`) is declared end-to-end as data:

1. Register a descriptor in `CapabilityRegistry` with `domain: 'general'` and an `icon`/`glyph`.
2. Flag it on a target's `generalCapabilities` as `{ "supported": true | false }`.
3. Reference it by id from a node or package `requiredCapabilities`.

Example (`viper`, glyph `V`):

```json
// target generalCapabilities
{ "viper": { "supported": true } }
```

```json
// node definition or package manifest
"requiredCapabilities": ["viper"]
```

## Package-Variant Pattern

Multiple packages can implement the **same node type IDs** under different capability
requirements (e.g. the `audio` package whose viper implementation lives in the `audio` folder
under the `otter_audio_viper` module, and a future pure-Python sibling in another folder/module).
The rules are:

- **Node type IDs are the stable identity**; the package id (the namespace prefix, e.g. `audio`)
  is stable, and the module name is the deployable variant.
- Variant packages share node type IDs and generators, differing only in their runtime drivers,
  `requiredCapabilities`, and `precedence`.
- Variants are mutually exclusive per target: `node_pkgs/index.json` may contain multiple entries
  sharing an id, and the resolver selects the satisfiable variant with the highest manifest
  `precedence` (default `0`; equal precedence among satisfiable variants is an error).

