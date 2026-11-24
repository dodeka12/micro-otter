# Node Definition JSON Reference

Comprehensive reference for defining node types in Micro Otter V2 node packages.

## Overview

Node definitions are stored in `node_definitions.json` files within each package under `device/node_pkgs/<package-name>/` (global packages) or `device/runtime/<runtime-name>/node_pkgs/<package-name>/` (runtime-specific packages). Each file contains a JSON object with a `nodeTypes` property that maps node type IDs to their definitions.

## File Structure

```json
{
  "nodeTypes": {
    "nodeTypeId1": { /* node definition */ },
    "nodeTypeId2": { /* node definition */ },
    ...
  }
}
```

## Connector and Control Descriptions

Every input, output, and control should provide a one-line `description` so the node "Show Info"
dialog (and future palette tooltips) can explain what each connector/control does. Descriptions are
**colocated with the node module** — authored directly in that package's `node_definitions.json` as a
per-connector/per-control `description` field (an i18n text map, like `name`/`label`). There is no
global node-documentation registry; each package owns its node documentation exactly as it owns its
definitions, data types, generators, and drivers.

```json
"inputs": [
  {
    "id": "block",
    "name": { "en": "Block" },
    "description": { "en": "Audio block to process." },
    "allowedTypes": ["audio.block"],
    "initialTypes": ["audio.block"]
  }
]
```

The `description` field is optional but strongly recommended for every input, output, and control.

## Show Info Dialog

The "Show Info" dialog (opened from the node palette or the graph panel context menu) renders a
node's `title` and `info` (Markdown), followed by three tables — **Inputs**, **Outputs**, and
**Controls** — with **Name**, **Type**, and **Description** columns.

The **Type** column is derived, not authored as a separate field:

- **Inputs** — `initialTypes ∪ allowedTypes`, plus any `options[].inputTypes` contributed by a
  dropdown control.
- **Outputs** — `outputType ∪ initialTypes ∪ outputTypeByControlValue`, plus the types of the
  declared `typeInputSources` inputs, plus any `options[].outputTypes`.
- **Controls** — the control `type` (e.g. `number`, `text`, `dropdown`, `checkbox`, `color`).

Type IDs are rendered exactly as authored (e.g. `vars.array`, `web.element`) and colour-matched to
their connectors. A connector with no type metadata renders an empty Type cell.

## Connector Type Metadata (`data_types.json`)

Node definitions reference connector types through input `allowedTypes` and output `outputType` values.
Package authors can define connector type metadata in `data_types.json` at the package root.

### `data_types.json` Structure

```json
{
    "types": {
        "web.element": {
            "name": {
                "en": "Web Element"
            },
            "color": "#ff00ff",
            "kind": "structure",
            "connectionPolicy": {
                "input": { "maxConnections": 1 },
                "output": { "maxConnections": 1 }
            }
        }
    }
}
```

### Cardinality Semantics

`connectionPolicy.<direction>.maxConnections` uses integer semantics:

- `0`: multiple/unbounded connections
- `1`: single connection
- `>1`: fixed maximum number of connections

### Defaults (Backward Compatibility)

If `connectionPolicy` is omitted, runtime defaults preserve legacy behavior:

- input default: `maxConnections = 1`
- output default: `maxConnections = 0`

If `kind` is omitted, runtime defaults to:

- `kind = "value"`

### Kind Semantics

`kind` classifies connector/data behavior metadata for a type:

- `"value"`: generic value-flow connector/data type (default)
- `"structure"`: structural/reference-style connector/data type metadata

Only `"value"` and `"structure"` are supported.

### Validation Rules

- `maxConnections` must be a finite integer.
- Negative values are invalid.
- Non-integer values (for example `1.5`) are invalid.

### Namespaced Value Types

A namespaced value type such as `core.tuple` needs **no** entry in
`data/type-conversions.ts`: `normalizeDataTypeId()` accepts any `namespace.name` id, and connection
validation already understands exact matches plus the wildcard `any`. Declare the type in
`data_types.json` only to give it a colour, a display name and a connection policy — `core.tuple`
uses `kind: "value"` with one connection per input and fan-out outputs:

```json
{
    "types": {
        "core.tuple": {
            "name": { "en": "Tuple", "de": "Tupel" },
            "description": {
                "en": "An immutable ordered group of heterogeneous values.",
                "de": "Eine unveränderliche, geordnete Gruppe heterogener Werte."
            },
            "color": "#9b7ad6",
            "kind": "value",
            "connectionPolicy": {
                "input": { "maxConnections": 1 },
                "output": { "maxConnections": 0 }
            }
        }
    }
}
```

The value is represented by a native Python tuple in generated code; there is no runtime wrapper
module. See [core-tuple-node-system.md](core-tuple-node-system.md).

## Node Definition Schema

A complete node definition contains the following properties:

### Required Properties

#### `title` (string or i18n object)

Display name shown in the UI.

**Simple string:**

```json
"title": "Constant"
```

**Internationalized:**

```json
"title": {
  "en": "Constant",
  "de": "Konstante"
}
```

#### `color` (string)

Hex color code for the node's appearance.

```json
"color": "#4a6fa5"
```

#### `shape` (string)

Visual shape of the node. Currently supported: `"square"`.

```json
"shape": "square"
```

#### `inputs` (array)

Array of input connectors. See [Input Schema](#input-schema).

```json
"inputs": [
  {
    "id": "in0",
    "name": "Value"
  }
]
```

#### `outputs` (array)

Array of output connectors. See [Output Schema](#output-schema).

```json
"outputs": [
  {
    "id": "out0",
    "name": "Result"
  }
]
```

#### `controls` (array)

Array of UI controls in the node's panel. See [Control Schema](#control-schema).

```json
"controls": [
  {
    "type": "number",
    "id": "value",
    "label": "Value",
    "default": 0
  }
]
```

**Minimum value widths**: the node is widened until each control's value column reaches these
floors. They are layout floors, not JSON-schema constraints — a definition never has to declare
them.

| Control type   | Value floor (px) |
| -------------- | ---------------- |
| `number`       | 80               |
| `dropdown`     | 96               |
| `text`         | 96               |
| `checkbox`     | 24               |
| `color`        | 40               |
| `slider`       | 120              |
| any other type | 80               |

The padding around the value (`2 × 16 px` inset plus the shared label column and its 4 px margin) is
added on top, so e.g. four inline controls labelled `Count`/`Color Model`/`Data Pin`/`Color Order`
need a node of `32 + labelColumn + 4 + 96` px.

#### `implementations` (object)

Language-specific implementations. See [Implementation Types](#implementation-types).

```json
"implementations": {
  "python": {
    "type": "regex",
    "value": "{{in0}} + {{in1}}"
  }
}
```

### Optional Properties

#### `info` (string or i18n object)

Detailed description of the node's functionality.

```json
"info": {
  "en": "Emits a constant numeric value.",
  "de": "Gibt einen konstanten numerischen Wert aus."
}
```

#### `icon` (string)

Path to an SVG icon relative to the package root.

```json
"icon": "icons/servo_24dp.svg"
```

**Resolution:**

- Icons are resolved relative to the package directory
- Node package class provides full path via server
- Falls back to default 'node' icon from icon provider if not found

#### `docs_url` (string)

URL to detailed external documentation for this node type.

```json
"docs_url": "https://docs.example.com/nodes/servo"
```

#### `requiredCapabilities` (CNF expression)

An AND-of-OR-groups requirement expression. Each top-level element is either a single capability
id (an OR-group of one) or an array of capability ids (an OR-group). The top-level list is AND.

```json
"requiredCapabilities": ["pwm.output", "viper"]
```

```json
"requiredCapabilities": [["wifi", "ethernet"], "viper"]
```

The second example means `(wifi OR ethernet) AND viper`. The flat form `["a", "b"]` is equivalent
to `a AND b` and remains valid. A capability id may reference pin capabilities (e.g. `pwm.output`,
`i2s`, `i2c`) or general/firmware capabilities (e.g. `viper`, `wifi`, `ethernet`); the domain is
resolved via the capability registry (see [Target Capability Schema Reference](target-capability-schema-reference.md)).

Capabilities are validated before transpilation/deployment. See [Capability System](#capability-system).

Pin requirements are **not** declared here. A `kind: "pin"` entry in `resourceUsage` is the single
declaration for a pin capability; the editor unions this list with the requirements derived from
those entries (see [resourceUsage](#resourceusage-array)). The one exception is a package node whose
pin need is not expressed as `resourceUsage`: `stdmo.servo` declares `["pwm.output"]` directly.

Packages can also declare `requiredCapabilities` in their manifest to gate firmware inclusion,
and multiple packages may implement the same node type IDs for different capability sets — see
the [Target Capability Schema Reference](target-capability-schema-reference.md).

#### `capabilityCheck` (string)

**Legacy.** A string reference to a global capability-check function. The only three in the
tree are `NodeCapabilityChecks.mathNode`, `NodeCapabilityChecks.digitalInput` and
`NodeCapabilityChecks.servoNode`; do not add new ones. New per-node checks are registered as
`registerCapabilityChecks` handlers — see
[node-validation-architecture.md](node-validation-architecture.md).

```json
"capabilityCheck": "NodeCapabilityChecks.servoNode"
```

**Additive, not exclusive:** a `capabilityCheck` handler **adds** its own issues to the declarations.
It never suppresses `requiredCapabilities` or the requirements derived from `resourceUsage`; the
validator evaluates both and reports the union (`source` stays `capabilityCheck` for handler issues
and `requiredCapabilities` for declarations).

#### `resourceUsage` (array)

Declarative list of what a node instance consumes, used by the layered checker (membership + bound
checks + strapping/reserved warnings). This is the intended form for plain pin checks — prefer it
over a custom capability check unless the logic is genuinely conditional.

```json
"resourceUsage": [
  { "kind": "pin", "controlId": "pin", "capability": "pwm.output", "value": { "frequency_hz": 50 } },
  { "kind": "bus", "type": "i2c", "bus": "i2c0" }
]
```

- `kind: "pin"` entries declare a pin capability: `controlId` names the control holding the pin,
  `capability` is a capability key (see
  [Target Capability Schema Reference](target-capability-schema-reference.md)), and optional
  `value` carries numeric bounds (e.g. `frequency_hz`) checked against the pin's range.
- `kind: "bus"` entries declare shared-bus usage for cross-node limit counting.

A `kind: "pin"` entry **is** the node's requirement for that capability: the target must expose at
least one pin for `capability`, and the editor reports `Missing required capability: <capability>`
otherwise. Do not repeat the key in `requiredCapabilities`.

Modality is declared on the same entry:

| Shape | Meaning | Example |
|-------|---------|---------|
| pin entry, control without `allowNone` | required: the target must expose at least one pin for `capability` | `dac-output.pin` → `dac` |
| pin entry whose control sets `dynamicOptions.allowNone: true` | optional: never a node requirement and skipped by the L2 membership check; L4 still sees the entry | `i2s-output.sdPin` (no entry today) |
| pin entry with `requiredWhen: { controlId, equals }` or `{ controlId, in }` | conditional: evaluated only while the named control holds the named value; skipped otherwise | future `digital-output` direction modes |
| no entry for a pin control | not a requirement and not counted | `i2s-output.sdPin`, `.gainPin` |

`requiredWhen` is validation-only. The picker keeps taking its optionality from `allowNone`, and the
L4 resource validator ignores `requiredWhen` — a pin can be picked in a mode where it is not
required. `allowNone` and `requiredWhen` are mutually exclusive on one entry; a data test enforces it.

Strapping/reserved/bound findings are non-blocking warnings; a pin lacking the declared capability
is a blocking issue.

#### `initImplementations` (object)

Per-language initialization code emitted before the main loop.

```json
"initImplementations": {
  "python": {
    "type": "code-generator",
    "value": "NodeInitGenerators.constNode"
  }
}
```

Uses the same type system as `implementations` (regex, function, code-generator).

#### `executionPhase` (string)

Controls when this node is scheduled for execution.

```json
"executionPhase": "loop"
```

Supported values:

- `"init"`: node runs only during initialization
- `"loop"`: node runs only in the main loop (default)
- `"both"`: node may participate in both phases

If omitted, runtime defaults to `"loop"`.

---

## Input Schema

Each input connector has the following properties:

### Required Input Properties

#### `id` (string)

Unique identifier for the input within this node.

```json
"id": "in0"
```

#### `name` (string or i18n object)

Display label for the input connector.

```json
"name": {
  "en": "Value",
  "de": "Wert"
}
```

#### `description` (string or i18n object)

Optional one-line description of the input connector, shown in the node "Show Info" dialog.

```json
"description": {
  "en": "Value to process."
}
```

#### `allowedTypes` (array of strings)

Accepted connector type IDs for this input (e.g. `int`, `float`, `bool`, `string`, `any`,
`vars.array`, `audio.block`, `web.element`). The first entry is the default when the input is
placed. The "Show Info" dialog lists all allowed types in its Type column.

```json
"allowedTypes": ["float", "int"]
```

#### `initialTypes` (array of strings, optional)

Type IDs the connector starts with when the node is placed. When omitted, the runtime derives it
from `allowedTypes`. The "Show Info" dialog unions `initialTypes` and `allowedTypes` when
displaying the connector's type(s).

```json
"initialTypes": ["float"]
```

### Optional Input Properties

#### `phase` (string)

Declares connector phase compatibility for this input.

```json
"phase": "both"
```

Supported values:

- `"init"`: accepts initialization-phase data
- `"loop"`: accepts loop-phase data
- `"both"`: accepts both (default)

If omitted, runtime defaults to `"both"`.

#### `defaultControl` (control object)

Control that appears when the input is not connected. See [Control Schema](#control-schema).

```json
"defaultControl": {
  "type": "number",
  "label": "Value",
  "min": 0,
  "max": 100,
  "default": 50
}
```

**Runtime Processing**:

- NodeType converts `defaultControl` plain objects to `NodeControlBase` instances during construction
- NodeData enriches inputs on construction, ensuring `defaultControl` is always a `NodeControlBase` instance
- During serialization, `NodeControlBase` instances are converted back to plain objects for storage
- On deserialization, plain objects are automatically converted back to `NodeControlBase` instances
- NodeUi renders default controls at 75% scale directly next to disconnected input connectors
- Default controls are hidden when input is connected; connector label is shown instead

See [Node UI Module Structure - Input Default Controls Architecture](node-ui-module-structure.md#input-default-controls-architecture) for implementation details.

#### `enabled` gate inputs for side-effect nodes

Outbound side-effect nodes may append one optional gate input:

```json
"enabled": {
  "id": "enabled",
  "name": { "en": "Enabled", "de": "Aktiviert" },
  "allowedTypes": ["bool"],
  "initialTypes": ["bool"],
  "defaultControl": {
    "type": "checkbox",
    "label": { "en": "Enabled", "de": "Aktiviert" },
    "default": true
  },
  "description": { "en": "When off, the output is not updated." }
}
```

- Insert it as the **first** input, before every other connector. This deliberately shifts the
  existing inputs' indices, so graphs saved against the old layout must be rewired.
- Default it to `true`; an unconnected input generates the literal `True`.
- Code-generator nodes emit `'True'` when the input is missing, `null`, or empty, then wrap only
  the loop's outbound call in `if bool(<expression>):`. The reference implementation is
  [`printNode`](../../../src/micro_otter/nodes/device/node_pkgs/core/node_generators.js).
- Init-time setup is not gated: drivers are still constructed, entities registered, and MQTT
  started. Only the per-tick effect is skipped; outputs and command processing continue.
- Function-type nodes receive `enabled` as the first positional callable argument and gate the
  hardware call inside `__call__` while still returning every output.
  `otter_stdmo.servo_callable.ServoNodeFn` is the example.

The families using the gate are core DAC/digital outputs, Home Assistant state publishers, MQTT
write/announce, variable and webview writes/saves, LED outputs, and the stdmo servo. It is
deliberately absent from `hass-bridge`, `mqtt-will`, receive-only/read/load nodes (`hass-button`,
`mqtt-read`, `mqtt-status`, `var-read`, `var-store-load`, `web-store-read`, `web-store-load`),
`array-modify`, and webview UI display nodes: their effects are init configuration, pure reads, or
intentional per-loop display updates.

---

## Output Schema

Each output connector has the following properties:

### Required Output Properties

#### `id` (string)

Unique identifier for the output within this node.

```json
"id": "out0"
```

#### `name` (string or i18n object)

Display label for the output connector.

```json
"name": {
  "en": "Result",
  "de": "Ergebnis"
}
```

#### `description` (string or i18n object)

Optional one-line description of the output connector, shown in the node "Show Info" dialog.

```json
"description": {
  "en": "Processed audio block."
}
```

#### `outputType` (string)

The connector type ID emitted by this output. The "Show Info" dialog shows it in its Type column.

```json
"outputType": "vars.array"
```

#### `initialTypes` (array of strings, optional)

Type IDs the connector starts with when the node is placed. When a control can change the output
type (see `outputTypeControl` below), list every possible type here so the "Show Info" dialog can
display the full set.

#### `outputTypeControl` + `outputTypeByControlValue` (optional)

Map the selected value of a dropdown control to an output type:

```json
"outputType": "string",
"initialTypes": ["float", "int", "bool", "string"],
"outputTypeControl": "valueType",
"outputTypeByControlValue": {
  "float": "float",
  "int": "int",
  "bool": "bool",
  "string": "string"
}
```

#### `typeInputSources` (array of strings, optional)

The plural form: the output's type is the **union** of the values that actually arrive at the
listed input ids. This is what a mux needs — `select(condition, trueValue, falseValue)` may emit
either of its two value inputs, so it is connectable exactly where *both* of them fit.

The shipped `core.select` is the reference definition: three inputs, one union output, and no
`channels` control (the former ten-channel mux is retired).

```json
"inputs": [
  { "id": "condition", "allowedTypes": ["bool"], "initialTypes": ["bool"] },
  { "id": "trueValue", "allowedTypes": ["any"], "initialTypes": ["any"] },
  { "id": "falseValue", "allowedTypes": ["any"], "initialTypes": ["any"] }
],
"outputs": [
  {
    "id": "value",
    "name": { "en": "Value", "de": "Wert" },
    "outputType": "any",
    "initialTypes": ["bool", "int", "float", "string", "core.tuple"],
    "typeInputSources": ["trueValue", "falseValue"]
  }
]
```

`initialTypes` lists every type the branch may carry, including the namespaced `core.tuple`; the
declared `outputType` stays the representative that the rule below computes (`any` here).

Only the camelCase `typeInputSources` spelling is accepted. The former singular
`type_input_source` / `typeInputSource` keys and the plural `type_input_sources` alias are
retired and ignored. Entries are trimmed, empties are dropped and an empty array is treated as
"not declared". The parser is `resolveDeclaredInputSources()` in `data/type-conversions.ts`.

**What "union" means for connection validation.** `NodeGraph.getResolvedOutputTypes()`
follows the declarations upstream and merges the connected sources' types. `canConnect()`
then requires **every** candidate to be acceptable to the target input:

- an output fed by two `bool` sources is refused by a `string`-only input and accepted by a
  `bool` input (the message names `bool`, i.e. the unchanged single-type wording);
- an output fed by `bool` and `string` is refused by a `bool` input *and* by a `string` input
  (message: `Cannot connect union 'bool | string' …`);
- an output fed by `int` and `float` is accepted by a `float` input and refused by an `int` input;
- an output fed by `core.tuple` and `float` is refused by a `core.tuple`-only input *and* by a
  `float`-only input (message: `Cannot connect union 'core.tuple | float' …`) and accepted by an
  `any` input. Widening the representative (below) never relaxes this check.

**Unconnected sources resolve to their primary type.** `getResolvedOutputTypes()` resolves each
declared source in declaration order:

1. a **connected** source contributes the upstream output's resolved types;
2. an **unconnected** source contributes `getPrimaryAllowedType(input.allowedTypes)`;
3. when **no** source is connected, the result is the deduplicated fallback candidates in
   declaration order (never `['any']` unless a fallback itself is `any`);
4. when **at least one** source is connected, only the connected candidates are returned.

So a union whose declared sources are `float` and `string` reports `['float', 'string']` while
unwired, then narrows to the connected candidates once wires are drawn. A union whose sources
both declare `any` (like `core.select`) still reports `['any']` when unwired.

**Hidden sources are not sources.** When the node's dropdown sets `affectsInputs: true`, the union
only follows the **active** declared sources: `resolveActiveInputIds()` (`type-conversions.ts`)
returns the selected option's `activeInputs` set, and `getResolvedOutputTypes()` skips every
declared source outside it *before* looking up a connection. A `value_N` hidden by a lowered
`count` therefore contributes neither a connected candidate nor a fallback, even when a stale
connection still points at its connector, and the connector visibility rule in
`getVisibleInputs()` uses the same helper. Nodes without such a dropdown are unaffected because
the helper returns `null`. Because `updateNode()` re-runs `canConnect()` while pruning, raising the
count back up widens the union and drops an outgoing connection that no longer fits.

Unions nest: a `select` fed by another `select` resolves transitively, and a cycle guard keeps a
pathological configuration from recursing.

**The representative type.** Connector colour and the connection-limit policies are
single-valued, so the declaration must carry a sensible `outputType` plus the full
`initialTypes` list. `resolveUnionOutputType()` (in `type-conversions.ts`) is the documented
collapse rule for UI-only needs:

| Candidates | Representative |
|------------|----------------|
| none / only `unknown` | `any` |
| one | that type |
| `any` present | `any` |
| two or more distinct candidates with at least one namespaced (dotted) id | `any` |
| only `bool`/`int`/`float`/`double` | the widest (`bool < int < float < double`) |
| anything else | the first candidate, in declaration order |

The namespaced clause is why a tuple/scalar branch collapses to `any`: connector colour and the
connection-limit policies cannot express `core.tuple` and a scalar at the same time.
`['core.tuple', 'float']` therefore reports `any`, while `['int', 'float']` still reports `float`
(and `['core.tuple']` stays `core.tuple`).

`NodeData.getOutputType()` keeps returning the declared `outputType` for a union output; the
resolved list is the graph's job. The "Show Info" dialog replaces the type chips of a union
output with the types of its declared sources, so it explains what can actually arrive.

### Optional Output Properties

#### `phase` (string)

Declares connector phase compatibility for this output.

```json
"phase": "both"
```

Supported values:

- `"init"`: emits initialization-phase data
- `"loop"`: emits loop-phase data
- `"both"`: emits both (default)

If omitted, runtime defaults to `"both"`.

---

## Control Schema

Controls are UI elements in the node's properties panel. All controls share common properties plus type-specific properties.

### Common Control Properties

#### `type` (string)

Control type. Supported values: `"number"`, `"text"`, `"dropdown"`, `"multi-dropdown"`, `"checkbox"`, `"color"`, `"icon"`.

`multi-dropdown` is a dropdown whose value is a **list** of option values (`string[]`): the
editor renders tick marks instead of a single selection, keeps the menu open while toggling, and
never closes on change. It shares the dropdown's control class and data model
(`NodeDropdownControlUi`, `NodeControlDropdown`); the menu markup adds
`.node-control-ui__dropdown-option-tick` per row. An empty selection is `[]`.

#### `id` (string)

Unique identifier for the control within this node.

#### `label` (string or i18n object)

Display label for the control.

Resolution rule (shared with the node-wide label column):

1. a `label` string is used verbatim
2. an i18n object is resolved with the active locale, then `en`, then its first available locale
3. when `label` is missing or empty, the control `id` is used

Because the label participates in the node-wide label column, a longer translation widens the node
(`NodeUi.ensureNodeWidth()`); the node is never shrunk back automatically when the translation gets
shorter.

#### `description` (string or i18n object)

Optional one-line description of the control, shown in the node "Show Info" dialog.

```json
"description": {
  "en": "I2S bit-clock pin (shared with the microphone)."
}
```

#### `default` (varies by type)

Default value when the node is created.

#### `valueMigration` (object)

Optional one-shot migration that absorbs a legacy control into a list control. Use it when a
control replaced another control and existing graphs still store the old one.

```json
"valueMigration": {
    "fromControl": "availability",
    "entry": "__device__"
}
```

- `fromControl` (string): id of the legacy control.
- `entry` (string): value inserted into this control's list when the legacy value is truthy.

When the legacy control is present, it is removed from the node's values, the list is trimmed and
de-duplicated, and `entry` is inserted (truthy) or removed (falsy). When the legacy control is
absent, the stored list is left alone. The metadata is carried on the runtime node-type snapshot,
so the migration runs once per node; an explicit empty list (`[]`) therefore stays empty.

#### `legacyDefault` (any)

Optional fallback for a control that was **added to an existing node type**. Use it whenever the
new control changes behaviour, so loading an old collection does not rewrite saved graphs.

```json
"default": "device",
"legacyDefault": "homeassistant"
```

Precedence when the runtime definition snapshot is refreshed:

1. a value the node actually stores (including one produced by `valueMigration`),
2. `legacyDefault` — only when the control id is **absent** from the controls the node was saved
   with, i.e. the node predates the control,
3. `default`.

Two rules keep this honest:

- `legacyDefault` never applies when the node is created from the current definition (palette,
  duplicate, paste) — a new node always starts at `default`, because its stored control snapshot
  is the current one.
- It is per control and works for **scalars** (dropdown, checkbox, number, text). For list controls
  the existing `valueMigration` remains the tool: it converts an old *value* into the new list,
  while `legacyDefault` only supplies a value when the control was never there.

Once a collection is saved again, the node carries the control in its snapshot, so the next refresh
uses `default` and the legacy window closes by itself.

#### `layout` (string)

Optional control layout hint for node control rendering.

Supported values:

- `"inline"`: label and control are intended to share one row
- `"stacked"`: label and control are intended to use stacked rows

Default and normalization behavior:

- If omitted, runtime normalizes to `"inline"` (only `"stacked"` is special)
- If set to an unsupported value, runtime normalizes to `"inline"` for backward compatibility

Layout effect:

- All `inline` controls of a node share **one** label column and **one** value column, aligned with
  the connector rows below them; labels are ellipsised only when the node is narrower than that
  column.
- `stacked` controls draw their label on its own full-width row above the value.
- Both layouts contribute to the node's content-derived minimum width, so a node with panel controls
  grows instead of squeezing its values.

### Number Control

```json
{
    "type": "number",
    "id": "value",
    "label": "Value",
    "min": 0,
    "max": 100,
    "step": 1,
    "default": 50
}
```

**Properties:**

- `min` (number): Minimum allowed value
- `max` (number): Maximum allowed value
- `step` (number): Increment/decrement step size
- `default` (number): Default value

The editor applies `min`/`max`/`step` to the numeric input and enforces the range on the stored
value: a value typed outside `min … max` is clamped (typing `5` into a `min: 100` control stores
`100`) both while typing and when the editor closes, so no out-of-range number reaches the node.

### Text Control

```json
{
    "type": "text",
    "id": "message",
    "label": "Message",
    "default": "Hello"
}
```

**Properties:**

- `default` (string): Default text value

### Icon Control

```json
{
    "type": "icon",
    "id": "icon",
    "label": "Icon",
    "default": "mdi:thermometer"
}
```

An icon name that Home Assistant renders (see
<https://www.home-assistant.io/docs/frontend/icons/>). The editor is a text input, so **any**
string can be typed, plus a searchable popover with the bundled Material Design Icons set. The
popover is the shared `MdiIconPickerControl` mounted in host-field mode (see
`docs/dev/view-system/mdi-icon-picker-control.md`), so the node editor has no second copy of the
grid.

**Properties:**

- `default` (string): Default icon value

Value grammar:

- `<set>:<name>` — `mdi:thermometer`, `hue:light`; the set prefix is kept verbatim, so custom
  icon sets are neither rewritten nor rejected.
- A bare name (`thermometer`) is looked up as `mdi:thermometer` when the glyph is searched, but it
  is **not** a valid entity icon: the `hass-icon-invalid` graph rule badges it with the fix in the
  message, and Home Assistant would drop it from the discovery config.
- `""`, `":"`, `"mdi:"` and whitespace-only values are not an icon; the control simply shows
  the raw text (an empty value is dropped from generated discovery configs).

Editing behaviour:

- Typing filters the grid by **name and alias** (`user` finds `account`), ranked exact name →
  name prefix → name substring → alias substring; an empty query browses the alphabetically
  first icons. Up to 300 matches are rendered, with a `showing 300 of N matches` footer and a
  `Show more` button that pages through the rest.
- Picking a tile writes the canonical `mdi:<name>` value and keeps the editor open; `Enter`
  accepts the typed string and closes the editor — or, after the arrow keys browsed a grid with
  alternatives, takes the highlighted tile (and closes as well).
- The canvas draws the glyph of a resolvable value in front of the name, inside the value box, so
  the node shows its icon. Free text, foreign sets (`ph:`), a missing `FontFaceSet` or a failed
  font load keep the plain text box — node metrics never change either way.
- **Clear** empties the value (which removes `icon` from the generated discovery config).
- A value that is not in the bundled index (an icon newer than **MDI 7.4.47** or a foreign set)
  only produces a soft hint — the value is stored and emitted unchanged.
- The name/alias index (`html/vendor/mdi/icon-index.json`) is fetched lazily on first open (or on
  the first canvas render of an `mdi:` value) and ships with the app; there is no CDN and no
  network access at runtime. If the fetch fails, the field degrades to plain text entry and the
  value still commits.
- Every picker string is localized through `controls.iconPicker.{hint,loading,unavailable,
  noMatches,count,clear,unknown}`; `hint` is the empty field's placeholder.

### Checkbox Control

```json
{
    "type": "checkbox",
    "id": "enabled",
    "label": "Enabled",
    "default": true
}
```

**Properties:**

- `default` (boolean): Default checked state

A package-specific example is the webview `persist` control
(`{ "type": "checkbox", "id": "persist", "label": { "en": "Persist" }, "default": false }`), which
toggles the implicit value-store round-trip described in
[`webview-node-system.md`](./webview-node-system.md#persistence).

### Dropdown Control

```json
{
    "type": "dropdown",
    "id": "operation",
    "label": "Operation",
    "options": [
        {
            "value": "add",
            "label": "Add"
        },
        {
            "value": "subtract",
            "label": "Subtract"
        }
    ],
    "default": "add"
}
```

**Properties:**

- `options` (array): List of option objects
    - `value` (string): Internal value
    - `label` (string or i18n object): Display text
    - `activeInputs` (array of strings, optional): Input IDs to show when this option is selected
    - `activeControls` (array of strings, optional): Control IDs to show when this option is selected
    - `outputTypes` (object, optional): maps an output connector ID to the type ID list it takes
      when this option is selected (e.g. `{ "out0": ["float"] }`)
    - `inputTypes` (object, optional): maps an input connector ID to the type ID list it accepts
      when this option is selected
- `default` (string): Default selected value
- `maxVisibleItems` (number, optional): Maximum number of options shown at once in the editor
  dropdown before a scrollbar appears. Defaults to `8` when omitted.

#### Dynamic Node Structure

Dropdowns can control which inputs and controls are visible using these properties:

**On the dropdown control:**

```json
{
  "type": "dropdown",
  "id": "operation",
  "label": "Operation",
  "affectsInputs": true,
  "affectsControls": true,
  "options": [...]
}
```

- `affectsInputs` (boolean): If true, this dropdown controls input visibility
- `affectsControls` (boolean): If true, this dropdown controls other control visibility

**On each dropdown option:**

```json
{
    "value": "sqrt",
    "label": "Square Root",
    "activeInputs": ["in0"],
    "activeControls": ["precision"]
}
```

- `activeInputs` (array of strings): Input IDs to show when this option is selected
- `activeControls` (array of strings): Control IDs to show when this option is selected

**Example: Math Node**

```json
{
    "type": "dropdown",
    "id": "operation",
    "label": "Operation",
    "affectsInputs": true,
    "affectsControls": true,
    "options": [
        {
            "value": "add",
            "label": "Add",
            "activeInputs": ["in0", "in1"]
        },
        {
            "value": "sqrt",
            "label": "Square Root",
            "activeInputs": ["in0"],
            "activeControls": []
        },
        {
            "value": "sin",
            "label": "Sine",
            "activeInputs": ["in0"],
            "activeControls": ["angleUnit"]
        }
    ]
}
```

**Visibility and connector-typing rules**

- **Declared membership.** An affecting dropdown hides exactly the controls that some option
  lists in `activeControls` but the selected option does not. A control that no option ever
  lists stays visible, and `activeControls: []` on an option hides every control the dropdown
  declares elsewhere. The same rule applies to `activeInputs`.
- **AND across dropdowns.** When a node declares several affecting dropdowns, a control is
  visible only while every one of them keeps it visible.
- **Whole blocks.** An option may list an entire control block. The core Constant node's
  `custom` option names `valueType` plus all four value controls (`floatValue`, `intValue`,
  `boolValue`, `stringValue`) so that a *hidden* sibling dropdown (`valueType`) cannot keep its
  value row on screen in `special` mode:

  ```json
  "options": [
      {
          "value": "custom",
          "activeControls": ["valueType", "floatValue", "intValue", "boolValue", "stringValue"]
      },
      {
          "value": "special",
          "activeControls": ["specialValue"],
          "outputTypes": { "out0": ["float"] }
      }
  ]
  ```

- **Typing follows visibility.** `outputTypes` / `inputTypes` on an option apply only while the
  dropdown that declares them is visible. Selecting `special` therefore keeps the Constant
  node's `out0` at its declared `float` type even when a stale `valueType: "int"` is still
  stored, and the graph prunes any connection the retyped connector can no longer carry.
- **Shared rule.** `resolveHiddenControlIds()` in `js/data/type-conversions.ts` implements the
  computation once. `getVisibleControls()` in `js/nodes/node-ui-helpers.ts` (which also receives
  the synthetic input-default dropdowns described below) and
  `NodeGraph.#applyDropdownOptionConnectorTypes()` both consume it, so rendered rows and
  connector types cannot disagree.

#### Dynamic Options (target-derived)

A dropdown can declare `dynamicOptions` to have its options and enabled/disabled state resolved
from the active device target, the graph, and (optionally) other control values:

```json
{
    "type": "dropdown",
    "id": "pin",
    "dynamicOptions": {
        "source": "targetPinsForCapability",
        "capabilityKey": "dac"
    }
}
```

**Fields:**

- `source` (string, required): the resolver strategy. Initial sources:
    - `targetPinPull` — pull-resistor directions for the selected `pin`. Uses
      `dependsOn: ["pin"]` and optional `includeUndefined: true` to prepend a `null`
      ("Undefined") option. Disables the control when the pin declares `fixedPull`.
    - `targetPinsForCapability` — pins supporting `capabilityKey`, labeled by pin label
      (falling back to the pin id). Optional `allowNone: true` prepends a `null` ("None")
      option so a pin can be left unassigned. When the target exposes **no** pins for
      `capabilityKey`, the control resolves to no options and `disabled: true` (a stale stored pin
      is not echoed); `allowNone: true` keeps it enabled with the single `None` option.
    - `targetResourceValues` — ids `0..n-1` from `resources[resourceGroup][resourceKey]`.
      Disables the control when the count is `0` or absent.
    - `graphTopics` — the MQTT topics already used in the graph, plus a "new topic"
      sentinel (see below).
    - `availabilityRefs` — the availability topics of the **collection**. The list always
      starts with the reserved `__device__` entry (`Device`), followed by the
      sanitised `id` control values of every `hass-availability` node, de-duplicated (by
      sanitised id, i.e. topic segment) and sorted. A stored value that no flag node defines
      any more is kept and labelled `<id> (missing)`, never silently dropped; an empty
      collection still offers the device entry and does not disable the control. `__device__`
      is reserved and cannot be used as a named flag id. Use it on a `multi-dropdown`
      (`availabilityFlags` on the `hass` entity nodes) so an entity can follow the device
      and several subsystem flags at once.
    - `varStores` — the store namespaces of the **collection**, plus a "new store" sentinel.
      The list always starts with `default`, followed by the effective namespace of every
      node that names one (`var-read` / `var-write` `store` input, `var-store-save` /
      `var-store-load` `name` input, and the `storeNamespace` control of the MQTT
      json-store modes), de-duplicated and sorted. Namespaces starting with `_` are
      package-owned (`_webcontrol`) and never offered, yet a node may still store one. Use it
      on the `store` input-row default control of `var-read` / `var-write`; see the
      *Dynamic options on an input-row default control* subsection below.
    - `varNames` — the variable names of **one** namespace, selected through
      `dependsOn: ["store"]`. Names come from the `name` control of `var-read` /
      `var-write` nodes whose effective namespace matches, so `foo` in `presets` and `foo` in
      `default` stay separate. `var-store-save` / `var-store-load` are deliberately not name
      sources: their `name` input *is* a namespace and already feeds `varStores`.
    - `signalNames` — every signal name declared by a `signal-post` node in the
      **collection**. The list starts with `(not set)` (a disabled posting node), followed by
      the names and the "Define signal…" sentinel. The sentinel reveals `newNameControls`, and
      a stale stored value that no declaration covers stays first and selectable.
- `dependsOn` (array of control ids): the control re-resolves when any listed control changes.
- `capabilityKey` (string): parameter for `targetPinsForCapability`.
- `resourceGroup` / `resourceKey` (string): parameters for `targetResourceValues`.
- `includeUndefined` (boolean): parameter for `targetPinPull`.
- `allowNone` (boolean): parameter for `targetPinsForCapability`; when `true`, prepends a
  `null` ("None") option so optional pins default to "no pin".
- `controlIds` (array of control ids): parameter for `graphTopics`; restricts the harvest to
  those control ids (default: `topic`, `willTopic`, `announceTopic`, `triggerTopic`).
- `newTopicControls` (array of control ids): parameter for `graphTopics`; the controls the
  sentinel option reveals.
- `newStoreControls` / `newNameControls` (array of control ids): parameters for `varStores` /
  `varNames` / `signalNames`; the controls their sentinel option reveals (on `var-read` /
  `var-write`: `["customStore"]` / `["customName"]`; on `signal-post`: `["customSignal"]`).
- `newLabel` (string or i18n text map): label of the sentinel option (default `New topic…` for
  `graphTopics`, `New store…` / `New variable…` for the var pickers, `Define signal…` for
  `signalNames`). Node definitions declare
  it as a text map (`{ "en": …, "de": … }`), which the dropdown resolves like any other option
  label; the resolver also accepts a plain string and falls back to its English default.
- `displayLabel` (**resolved option field**, not a descriptor key): an option may carry a
  rendering override next to its `label`. The dropdown draws `displayLabel` on the canvas and
  on the editor trigger but keeps `label` in the menu, so the sentinel row can echo the text the
  user typed into its companion control — `varStores` / `varNames` / `graphTopics` /
  `signalNames` set it on the sentinel as soon as `customStore` / `customName` / `customTopic` /
  `customSignal` is non-empty. It is purely
  presentational: the stored value stays `__new__`, and it is recomputed on every refresh, so it
  never survives as state.

When `dynamicOptions` is present, the resolved options and disabled state replace the control's
static `options` and `disabled` values at render time.

`allowNone` is the **only** switch that makes a pin optional: it drives both the picker's `None`
option and the requirement check (`resourceUsage` derivation). `requiredWhen` is validation-only — it
never filters or disables the control.

**`graphTopics` in detail**

The option list is `current → graph topics → __new__`:

1. the node's current value first, labeled `(not set)` when empty — a stored topic is never
   lost, even when the node that used to publish it was deleted;
2. every topic collected by `collectGraphTopics()` (`graph-topics.ts`), sorted with
   `localeCompare` so the order is stable across reloads. A topic counts only for nodes whose
   type starts with `mqtt-`/`hass-` or whose control declares `dynamicOptions.source ===
   "graphTopics"`, so an unrelated `topic` control is never harvested;
3. the sentinel `__new__` (`GRAPH_TOPIC_NEW_SENTINEL`), which carries `activeControls:
   [...newTopicControls]`.

The resolver **never rewrites an existing value**: `_resolveDynamicControlData()` writes the
resolved `value` back into `controlValues`, so returning the first graph topic would silently
replace the user's topic on every render. An empty value resolves to the sentinel, which makes
"the user has to type a topic" the default state of a fresh node.

The canonical new-value recipe:

```json
{
    "id": "topic", "type": "dropdown", "affectsControls": true,
    "default": "",
    "dynamicOptions": { "source": "graphTopics", "newTopicControls": ["customTopic"] }
},
{ "id": "customTopic", "type": "text", "label": { "en": "New topic", "de": "Neues Topic" },
  "default": "" }
```

Generator-side contract (shared by `mqtt-read`, `mqtt-write`, `mqtt-will`, `mqtt-announce`):

```text
effective = topic === '__new__' ? customTopic : topic
```

The same rule lives in `effectiveTopicValue(controlId, controlValues)` in
`src/micro_otter/nodes/html/js/nodes/graph-topics.ts`, which is also what the graph-level
topic-coherence validator uses.

**Dynamic options and visibility**

A resolved option may carry `activeControls` / `activeInputs` exactly like a static option.
`NodeUi._visibilityNodeData()` resolves every dynamic control before `getVisibleControls()` /
`getVisibleInputs()` run, so the reveal state follows the dropdown. Because a dynamic option
list cannot enumerate its siblings, `getVisibleControls()` uses **declared membership**: a
dropdown hides only the controls it lists in *some* option and does not select right now.
Everything it never mentions stays visible, which is also the behaviour of a static dropdown
that declares no `activeControls` at all.

**Known limitation:** the dropdown widget is not an editable combobox, so an unknown stored
topic is shown as its own first entry. A combobox widget is a later enhancement.

**`varStores` and `varNames` in detail**

`varStores` lists `default` first — the namespace a node falls back to when nothing is set —
then the collection's namespaces, then the sentinel. An **unset store resolves to `default`, not
to the sentinel**, so a fresh node already shows the namespace its generator will use and only an
explicit pick of "New store…" opens `customStore`. A namespace that is stored while no node uses
it any more keeps its own first entry and is never rewritten; while the sentinel is selected no
extra blank entry is added, because an empty store and `default` are the same namespace.
`varNames` resolves its namespace from `dependsOn[0]` — the `store` input id — reading
`inputDefaults.store` first and following the `__new__` sentinel through `customStore`, so a
namespace the user is about to create already filters the name list. Because the store dropdown
declares `affectsControls`, a new store selection re-resolves the name list without any extra
wiring. Both resolvers give their sentinel a `displayLabel` with the trimmed companion text, so
the row the user picked keeps showing the name they typed instead of the placeholder.

`signalNames` uses the same sentinel contract but starts with `(not set)` — a disabled posting
node — then the collection's signal names, then "Define signal…". Selecting `(not set)` stores
`signal: ""`; the generator emits only a comment, and validation accepts the state. A stale stored
name stays first and selectable until the signal reconciler clears it.

Generator-side contract for the `vars` package (`node_generators.js`):

```text
store = store === '__new__' ? (customStore || 'default') : store
name  = name  === '__new__' ? customName : name
```

`var-store-save` / `var-store-load` keep a plain namespace in their `name` input and therefore
have no sentinel rule.

**Dynamic options on an input-row default control**

A `defaultControl` of type `dropdown` may carry `dynamicOptions` too. Three rules differ from a
control:

1. **Storage.** Its value lives in `inputDefaults[<input id>]`, never in `controlValues`.
   `NodeUi._resolveInputDefaultOptions()` resolves the option list when the control instances
   are built and mirrors `_resolveDynamicControlData()` in every respect *except* the write
   back: it seeds `inputDefaults[inputId]` only when the key is `undefined`, `null` or `''`,
   so a stored namespace survives a reload even when no other node uses it any more, while a
   stale empty string is upgraded to the value the resolver reports (for `varStores`: `default`).
2. **Visibility.** Input-row defaults are not part of `data.controls`, so
   `getVisibleControls(nodeData, extraAffectingDropdowns)` takes a second argument. `NodeUi`
   passes one synthetic entry per dynamic input default (`_inputDefaultAffectingDropdowns()`),
   which only participates in the declared-membership computation — a synthetic entry can
   never be rendered as a row. `affectsControls: true` on the definition is still required,
   because only such a dropdown is consulted at all.
3. **Refresh.** `_hasCrossNodeControl()` inspects `inputs[].defaultControl.dynamicOptions` as
   well, and `_refreshDynamicControls()` rebuilds the input default instances together with
   the control instances. Without that, a node whose only cross-node source is the store
   picker would keep a stale list.

The canonical store picker (from `var-read`):

```json
"defaultControl": {
    "type": "dropdown",
    "label": { "en": "Store", "de": "Store" },
    "default": "default",
    "affectsControls": true,
    "dynamicOptions": {
        "source": "varStores",
        "newStoreControls": ["customStore"],
        "newLabel": { "en": "New store…", "de": "Neuer Store…" }
    }
}
```

**Hit-testing trade-off:** a hidden companion control still advances the y-offset in
`node-ui-hit-testing.ts`, exactly as the MQTT `customTopic` row does; the row is drawn as blank
space rather than removed.

The option list is recomputed while the editor is open: `NodeUi` subscribes to the graph's
`node-added` / `node-updated` / `node-removed` events and refreshes every node that owns a
cross-node control (`_hasCrossNodeControl()`: the `graphTopics`, `varStores`, `varNames`,
`availabilityRefs` and `signalNames` sources), so a topic typed in one node appears in the other
nodes' dropdowns without a reload. `availabilityRefs`, `varStores`, `varNames` and `signalNames`
additionally receive the active collection (`_collectionSource()` →
`DynamicControlResolverArgs.collection`), because a namespace, variable name, signal name or
availability flag may live in another graph of the same collection.

Those collection-wide sources also refresh **across graphs**: `_bindCollection()` subscribes to
`node-added` / `node-updated` / `node-removed` of every *other* graph in the collection
(`Collection.getGraphArray()`) and re-subscribes when the graph set changes
(`Collection.GraphAdded.v1` / `GraphRemoved.v1`). Without it a graph tab that was rendered
earlier kept the list it resolved back then, so a variable created in graph A never showed up in
the pickers of graph B. The subscription exists only for nodes with a cross-node source and is
torn down in `destroy()`.

---

## Implementation Types

Node implementations define how the node generates code for the target platform. Three types are supported:

### 1. Regex (Template)

Simple template-based code generation using `{{placeholder}}` tokens.

```json
"implementations": {
  "python": {
    "type": "regex",
    "value": "print('Value: ', {{in0}})"
  }
}
```

**When to use:**

- Simple expression substitution
- No complex logic needed
- Direct input-to-code mapping

**Placeholders:**

- `{{inputId}}`: Replaced with input variable name
- `{{controlId}}`: Replaced with control value

**Behavior:**

- Transpiler assigns the rendered expression to outputs automatically

### 2. Function (Class Constructor)

Treated as a class constructor. Instantiated once per node before the main loop.

```json
"implementations": {
  "python": {
    "type": "function",
    "value": "NodeFunctions.scale",
    "dependencies": ["libs.stdmo.base"]
  }
}
```

**Optional Fields:**

- `dependencies` (array of strings): Python module paths required by this implementation
    - Used during deployment to determine which library files to upload
    - Format: dot-separated module paths (e.g., `"libs.stdmo.servo"`)
    - Automatically converted to file paths during deployment (e.g., `"libs/stdmo/servo.py"`)
    - Transitive dependencies are resolved by scanning imports in the module files
    - See [Deployment System](../../../ldev/todos/deployment/v2-detailed-implementation-plan.md#node-library-filtering) for details

**TypeScript Function Class:**

```ts
window.NodeFunctions = window.NodeFunctions || {};

window.NodeFunctions.scale = class {
    constructor({ inputs_meta, outputs_meta, controls }) {
        this.inputs = inputs_meta;
        this.outputs = outputs_meta;
        this.factor = Number(controls.factor ?? 1);
    }

    __call__(value) {
        return value * this.factor;
    }
};
```

**Constructor Parameters:**

- `inputs_meta`: Array of `{ id, name, connected }`
- `outputs_meta`: Array of `{ id, name, connected, var_name }`
- `controls`: Object mapping control IDs to values

**When to use:**

- Reusable logic needed
- Access to connector metadata required
- Want transpiler to handle output assignments

**Behavior:**

- Transpiler instantiates class before loop
- Calls instance each tick with positional inputs
- Returned value is assigned to outputs by transpiler

### 3. Code Generator

Full control over code generation including self-managed assignments.

```json
"implementations": {
  "python": {
    "type": "code-generator",
    "value": "NodeCodeGenerators.constNode",
    "dependencies": ["libs.stdmo.gpio", "libs.stdmo.pin_manager"]
  }
}
```

**Optional Fields:**

- `dependencies` (array of strings): Python module paths required by this implementation
    - Same format and behavior as Function type (see above)
    - Ensures all required modules are uploaded during deployment

**TypeScript Generator Function:**

```ts
window.NodeCodeGenerators = window.NodeCodeGenerators || {};

NodeCodeGenerators.constNode = function (node, context) {
    const value = node.controls.inputValue ?? 0;

    return {
        statement: `${node.outputs[0].var_name} = ${value}`,
    };

    // OR return expression for auto-assignment:
    // return { expression: `${value}` };
};
```

**Generator Parameters:**

- `node`: Node data with inputs, outputs, controls
- `context`: Transpiler context (imports, graph state, etc.)

**Return Value:**

- `{ statement: string }`: Generator handles assignments
- `{ expression: string }`: Transpiler assigns to outputs

**When to use:**

- Complex code generation
- Self-managed assignments needed
- Import management required
- Advanced control flow

---

## Capability System

The capability system ensures nodes only run on devices that support required features.

### Custom Target Bypass

When the device has a **custom target** selected, capability validation is automatically bypassed for all nodes. This allows deployment to non-standard hardware without defining explicit capability maps.

**How It Works:**

1. User selects "Custom" target during runtime installation
2. Custom target JSON has `metadata.isCustomTarget: true`
3. Capability check functions detect custom target
4. Validation returns `{ valid: true }` immediately

**Implementation Pattern:**

```ts
NodeCapabilityChecks.myNode = function (node, capabilities) {
    // Check if custom target (bypass validation)
    if (capabilities.metadata?.isCustomTarget || !capabilities.pinCapabilities) {
        return { valid: true }; // Allow deployment on custom hardware
    }

    // Standard validation logic for known targets
    const pin = node.controls.pin;
    const pinCap = capabilities.pinCapabilities[pin];

    if (!pinCap?.pwm?.output) {
        return {
            valid: false,
            message: 'Pin does not support PWM output',
        };
    }

    return { valid: true };
};
```

**Use Cases:**

- Non-standard ESP32 boards
- Custom PCB designs
- Unknown hardware configurations
- Rapid prototyping without capability definitions

**⚠️ Warning**: Custom target disables validation. Users are responsible for ensuring their node graphs don't use unsupported pins or features.

### Basic Capabilities

Use `requiredCapabilities` for simple validation:

```json
"requiredCapabilities": ["pwm.output"]
```

**Validation:**

- Checked before transpilation/deployment
- Missing capabilities block execution
- Error messages shown to user

**Capability Sources:**

- Target capability maps: `device/targets/*.json`
- Referenced by device descriptor (`capabilitiesPath`)

### Advanced Capability Checks

The `capabilityCheck` string above is **legacy**. New per-node checks are registered with
`registerCapabilityChecks(register)` and receive a single argument object:

```ts
register('pkg.node-type', ({ nodeData, deviceTarget, validationContext }) => {
    // return a string, false, one issue object, an issue[], or null
});
```

See [node-validation-architecture.md](node-validation-architecture.md) (L2) for the full contract,
return shapes, and the resolution order.

---

## Complete Examples

### Simple Constant Node

```json
{
    "const": {
        "title": {
            "en": "Constant",
            "de": "Konstante"
        },
        "info": {
            "en": "Emits a constant numeric value.",
            "de": "Gibt einen konstanten numerischen Wert aus."
        },
        "color": "#4a6fa5",
        "shape": "square",
        "icon": "icons/input_24dp.svg",
        "inputs": [],
        "outputs": [
            {
                "id": "out0",
                "name": {
                    "en": "Value",
                    "de": "Wert"
                }
            }
        ],
        "controls": [
            {
                "type": "number",
                "id": "inputValue",
                "label": {
                    "en": "Value",
                    "de": "Wert"
                },
                "min": 0,
                "max": 100,
                "step": 1,
                "default": 50
            }
        ],
        "implementations": {
            "python": {
                "type": "code-generator",
                "value": "NodeCodeGenerators.constNode"
            }
        }
    }
}
```

### Print Node with Template

```json
{
    "print": {
        "title": {
            "en": "Print",
            "de": "Ausgabe"
        },
        "info": {
            "en": "Prints values to the console.",
            "de": "Gibt Werte auf der Konsole aus."
        },
        "color": "#a56c6f",
        "shape": "square",
        "icon": "icons/output_24dp.svg",
        "inputs": [
            {
                "id": "in0",
                "name": {
                    "en": "Value",
                    "de": "Wert"
                }
            }
        ],
        "outputs": [],
        "controls": [
            {
                "type": "text",
                "id": "title",
                "label": {
                    "en": "Title",
                    "de": "Titel"
                },
                "default": "Value"
            }
        ],
        "implementations": {
            "python": {
                "type": "regex",
                "value": "print('[user] ', {{title}}, ': ', {{in0}})"
            }
        }
    }
}
```

### Dynamic Math Node with Dropdown

```json
{
    "math": {
        "title": {
            "en": "Math",
            "de": "Mathe"
        },
        "info": {
            "en": "Applies mathematical operations.",
            "de": "Wendet mathematische Operationen an."
        },
        "color": "#6b8b9e",
        "shape": "square",
        "icon": "icons/calculate_24dp.svg",
        "capabilityCheck": "NodeCapabilityChecks.mathNode",
        "inputs": [
            {
                "id": "in0",
                "name": "In 1",
                "defaultControl": {
                    "type": "number",
                    "label": "In 1",
                    "min": -1000,
                    "max": 1000,
                    "default": 0
                }
            },
            {
                "id": "in1",
                "name": "In 2",
                "defaultControl": {
                    "type": "number",
                    "label": "In 2",
                    "min": -1000,
                    "max": 1000,
                    "default": 0
                }
            }
        ],
        "outputs": [
            {
                "id": "out0",
                "name": "Result"
            }
        ],
        "controls": [
            {
                "type": "dropdown",
                "id": "operation",
                "label": "Operation",
                "affectsInputs": true,
                "affectsControls": true,
                "options": [
                    {
                        "value": "add",
                        "label": "Add",
                        "activeInputs": ["in0", "in1"]
                    },
                    {
                        "value": "sqrt",
                        "label": "Square Root",
                        "activeInputs": ["in0"],
                        "activeControls": []
                    },
                    {
                        "value": "sin",
                        "label": "Sine",
                        "activeInputs": ["in0"],
                        "activeControls": ["angleUnit"]
                    }
                ],
                "default": "add"
            },
            {
                "type": "dropdown",
                "id": "angleUnit",
                "label": "Angle Unit",
                "options": [
                    { "value": "deg", "label": "Degrees" },
                    { "value": "rad", "label": "Radians" }
                ],
                "default": "deg"
            }
        ],
        "implementations": {
            "python": {
                "type": "code-generator",
                "value": "NodeCodeGenerators.mathNode"
            }
        }
    }
}
```

### Servo Node with Capabilities and Function

```json
{
    "servo": {
        "title": "Servo",
        "info": "Controls a servo motor via PWM.",
        "color": "#6b9e8a",
        "shape": "square",
        "icon": "icons/servo_24dp.svg",
        "docs_url": "https://docs.micropython.org/en/latest/library/machine.PWM.html",
        "requiredCapabilities": ["pwm.output"],
        "capabilityCheck": "NodeCapabilityChecks.servoNode",
        "inputs": [
            {
                "id": "angle",
                "name": "Angle",
                "defaultControl": {
                    "type": "number",
                    "label": "Angle",
                    "min": -90,
                    "max": 90,
                    "default": 0
                }
            }
        ],
        "outputs": [
            {
                "id": "angleOut",
                "name": "Angle"
            }
        ],
        "controls": [
            {
                "type": "number",
                "id": "pin",
                "label": "PWM Pin",
                "min": 0,
                "max": 40,
                "default": 0
            },
            {
                "type": "number",
                "id": "minUs",
                "label": "Min µs",
                "min": 500,
                "max": 2500,
                "default": 1000
            },
            {
                "type": "number",
                "id": "maxUs",
                "label": "Max µs",
                "min": 1500,
                "max": 3000,
                "default": 2000
            }
        ],
        "implementations": {
            "python": {
                "type": "function",
                "value": "libs.stdmo.servo_callable.ServoNodeFn"
            }
        }
    }
}
```

---

## Internationalization (i18n)

Most string properties support internationalization by using objects with language codes:

**Supported Properties:**

- `title`
- `info`
- `name` (for inputs/outputs)
- `label` (for controls and options)
- `description` (for inputs, outputs, and controls)

**Format:**

```json
{
    "en": "English text",
    "de": "Deutscher Text"
}
```

**Fallback Behavior:**

- If current language not found, falls back to English (`en`)
- If English not found, uses the first available language
- If object empty, uses the property key as fallback

**Example:**

```json
{
    "title": {
        "en": "Timer",
        "de": "Timer",
        "es": "Temporizador"
    },
    "info": {
        "en": "Executes code at regular intervals",
        "de": "Führt Code in regelmäßigen Abständen aus"
    }
}
```

---

## Best Practices

### 1. Use Descriptive IDs

```json
// ✅ Good
"id": "angleInput"
"id": "servoPin"

// ❌ Avoid
"id": "in0"
"id": "ctrl1"
```

### 2. Provide i18n for All User-Facing Text

Every user-facing string must carry both `en` and `de`; a plain string is a fallback for legacy
definitions only.

```json
// ✅ Good
"title": {
  "en": "Servo Motor",
  "de": "Servomotor"
},
"description": {
  "en": "PWM pin driving the servo.",
  "de": "PWM-Pin, der den Servo ansteuert."
}

// ⚠️ Legacy only — will render the English text in every locale
"title": "Servo Motor"
```

### 3. Set Appropriate Control Limits

```json
// ✅ Good - realistic PWM pin range
{
  "type": "number",
  "id": "pin",
  "min": 0,
  "max": 40
}

// ❌ Avoid - unrealistic or unsafe ranges
{
  "type": "number",
  "id": "pin",
  "min": -100,
  "max": 999999
}
```

### 4. Use Capability Checks for Hardware

```json
// ✅ Good - ensures PWM support
"requiredCapabilities": ["pwm.output"],
"capabilityCheck": "NodeCapabilityChecks.servoNode"
```

### 5. Choose the Right Implementation Type

- **Regex**: Simple expression replacement
- **Function**: Reusable logic with metadata access
- **Code Generator**: Complex generation, self-managed assignments

### 6. Document External Resources

```json
// ✅ Good - provides learning resources
"docs_url": "https://docs.micropython.org/en/latest/library/machine.PWM.html"
```

### 7. Use Default Controls for Disconnected Inputs

```json
// ✅ Good - fallback when not connected
"inputs": [
  {
    "id": "value",
    "name": "Value",
    "defaultControl": {
      "type": "number",
      "label": "Value",
      "default": 0
    }
  }
]
```

---

## Related Documentation

- **[Data Backbone Architecture](data-backbone-architecture.md)** - Data model and event system
- **[View System Architecture](view-system-architecture.md)** - UI integration and lifecycle
- **[I18n System Architecture](i18n-architecture.md)** - Translation system

---

## Graph Items in the Palette

The node palette can also list entries that are **not** node definitions. They are declared in
`js/nodes/organizational-palette.ts` and merged into the palette after the package loop, marked with
`type: 'graph-item'`:

```ts
{ id: 'documentation-area', type: 'graph-item', category: 'Organizational',
  title: { en: 'Documentation Area', de: 'Dokumentationsbereich' }, icon: 'nodeCategory', … }
```

How to recognise them:

- `type === 'graph-item'` (a real node type has no such marker; its `id` is the type id from the
  package);
- they have no `inputs`, `outputs`, `controls` or capability metadata, and `packageId` is `null` with
  `packageName: 'Organizational'` if you inspect the palette's internal shape;
- their drag payload is `{ type: 'graph-item', graphItemId, nodeTypeName }` instead of
  `{ type: 'node-type', nodeTypeId, nodeTypeName }`;
- clicking one does nothing (no node info window), and they never enter the favorites/recently-used
  lists;
- they render in a **pinned `Organizational` section above Favorites** that exists in category, package
  *and* alphabetical mode, and never inside a node group or the alphabetical grid.

They are **not** part of `data_types.json`, of a device runtime's `nodePackages`, or of the
transpiler — dropping one creates a graph item (a documentation area), not a node. See
[graph-panel-documentation-areas.md](../view-system/graph-panel-documentation-areas.md#palette-entry).

## Future Enhancements

Features planned for future versions:

- **Data Type System**: Type-safe connections with validation
- **Multiple Outputs per Type**: Support for nodes with multiple outputs
- **Additional Control Types**: Slider, color picker, textarea
- **Connection Constraints**: Type checking and validation rules
- **Custom Validation**: Per-control validation functions

See [Node UI Implementation Plan](../../../ldev/todos/v2/node-ui-plan/00-overview.md) for roadmap details.
