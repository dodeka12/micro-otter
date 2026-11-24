# Graph Resource Validation

Describes the cross-node validator in `src/micro_otter/nodes/html/js/core/graph-resource-validator.ts`
— the L4 layer of [node-validation-architecture.md](node-validation-architecture.md), which is the
parent page for "where does a check belong?". This page covers L4 (and the graph-rule registry
it shares a badge pipeline with); L1/L2 live on the architecture page.

## Layers

1. **Pin-function conflict** — a pin declared by two nodes with *different* capabilities is a
   conflict.
1. **Duplicate same-capability pin** — a pin declared by two *distinct* nodes for the *same*
   capability (the classic copy-paste bug, e.g. two NeoPixel nodes on one data pin) is flagged:
   `Pin 21 is used as digital.output by 2 nodes; only one driver can own the pin.`
2. **Shared-pool exhaustion** — declared usage is counted against `resources` via each descriptor's
   `limitKey` (e.g. `pwm.channels`); only non-null limits are enforced. Pin usages (`kind: "pin"`)
   count for descriptors whose `countKind` is unset or `"pin"` (PWM/ADC/DAC/touch); bus usages
   (`kind: "bus"`) count for `countKind: "bus"` descriptors (I2C/UART/SPI/I2S), bucketed by the
   instance from the `controlId` control value or the `bus` field. When the limit is a per-instance
   map (and the descriptor declares `limitInstances`), usages are bucketed per instance and each
   instance is checked against its own limit; unqualified usages are checked against the remaining
   total capacity.
3. **Constraint** — declarative cross-capability rules (`{ when: { uses }, forbid: [...] }`), e.g.
   ADC2 is forbidden while WiFi is active.
4. **I2S clock contention** — two nodes on *different* I2S controllers (`kind: "bus"`,
   `type: "i2s"`, different `i2sId` values) must not share the BCLK (`i2s.bclk`) or WS
   (`i2s.ws`) pin, because MicroPython I2S is master-only and each controller drives its
   own clocks.
5. **Graph rules** — structure checks that need no device target (topic coherence, singleton
   nodes, forbidden combinations); see [Graph rules](#graph-rules) and the L3 section of
   [node-validation-architecture.md](node-validation-architecture.md).

## Relationship to per-node checks

- `validateNodeCapabilities` checks each node's own `requiredCapabilities` / `resourceUsage`.
- `validateGraphResources` checks interactions *across* nodes (pin reuse, pool counts, coexistence).
- **Claim diagnostics** live in `validateNodeCapabilities`: when a pin carries a `claim` whose
  `conflicts` matches the required capability, an advisory issue is emitted (e.g. `Pin 43 is
  UART0 TX (console) on this target: …`) with the claim's `severity` (`warn`/`info`). It reports,
  it does not filter — the pin stays selectable.

## API

```ts
validateGraphResources({ target, graphNodes, nodeTypesByNodeId }): NodeCapabilityIssue[]
```

## Wiring status

`validateGraphResources` is implemented, exported, unit-tested, and wired into:

- `collection-deployment.ts` (`_validateNodePackages`) — graph issues are added to the validation
  `errors`, so conflicts block transpile/deploy.
- `graph-panel-view.ts` (`revalidateNodeCapabilities`) — graph issues are merged into node
  capability issues (attached by `nodeId`; `nodeId: null` issues attach to every node).

## Relationship to dynamic control dropdowns

Pin-select and bus-select controls (`adc-input.pin`, I2S `bclkPin`/`wsPin`/`dataPin`/`i2sId`, etc.)
are now capability-derived dropdowns resolved by the dynamic-control resolver
(`node-control-dynamic-resolver.ts`). The resolver limits the offered options to the pins/ids that
the active target supports, but it is **not** the error path: the declarative `resourceUsage`
membership/count pipeline (and `validateGraphResources` for cross-node conflicts) still flags any
selection that is unsupported or exceeds a target limit. The dropdown is a convenience that narrows
choices; validation remains the safety net.

The `irq` capability follows the same path with no resolver or validator change: `device-target.ts`
derives the `irq` pin set from `digital.input` inside `#buildCapabilityToPins()`, so pin membership
and the L4 conflict/duplicate rules apply to it unchanged. Targets never declare `irq` per pin,
because any GPIO that can read a level can raise an edge interrupt in MicroPython.

## Open pin set targets

Targets that declare a top-level `openPins` range (e.g. `generic_micropython`) are permissive:
`validateNodeCapabilities` returns `bypassed: true` and `validateGraphResources` returns no issues,
so any pin index in range is accepted and correctness is the user's responsibility. This is a
built-in-only signal — user-uploaded target configs cannot declare `openPins`.

## Package-level capability gating

A node package can declare `requiredCapabilities` in its `manifest.json` as an
AND-of-OR-groups expression: a string is a single capability, a nested array is an OR-group
(e.g. `["viper"]`, `["i2s"]`, or `[["wifi", "ethernet"], "viper"]` meaning
`(wifi OR ethernet) AND viper`). This gates the whole package, in addition to the per-node
`requiredCapabilities`:

- **Firmware build** (`staging_resolver.py`) excludes a package's assets when the target does
  not satisfy the expression.
- **Deploy** (`collection-deployment.ts` `_validateNodePackages`) flags a package whose
  requirements are unsatisfied by the connected target, blocking deploy.

Both paths share one evaluator (TS `core/capability-requirements.ts`, Python
`firmware_compile/capability_requirements.py`) and one descriptor registry (JSON under
`device/capabilities/`, read by both languages). Satisfaction depends on the capability's
`domain` from the registry:

- **general** (`viper`, `wifi`, `ethernet`, `math`, `bluetooth`) → `generalCapabilities[id].supported === true`.
- **pin** (`i2s`, `i2c`, `spi`, `uart`, `pwm`, `adc`, `dac`, `touch`, `irq`) → the target exposes the
  peripheral, i.e. a positive `resources` count at the descriptor's `limitKey`
  (e.g. `resources.i2s.controllers > 0`). `irq` is derived from `digital.input`, never declared
  per target, so it has no `resources` count of its own.



## Graph rules

`src/micro_otter/nodes/html/js/core/graph-rule-registry.ts` holds the one registry for every
"is this graph (or collection) shaped correctly?" check — singletons, forbidden combinations,
topic coherence, package structure rules. It runs through the same `NodeCapabilityIssue`
pipeline as the resource checks (so a structure problem shows the familiar node badge) and is
the one validator that does **not** need a device target: it reports even while no target is
selected.

`graph-topic-validator.ts` is that registry's MQTT client: it contributes the built-in topic
rules below and keeps the historical `registerGraphTopicRule()` / `globalThis.GraphTopicRules`
entry points working as thin wrappers over the shared registry.

### API

```ts
registerGraphRule({ id, scope, run }): void
getGraphRules(): GraphRule[]
validateGraphRules(context): NodeCapabilityIssue[]
clearGraphRules(): void
```

A rule declares a `scope`:

- `'graph'` (the default) may read `nodes` only;
- `'collection'` may additionally read `collectionNodes` (every node of the collection, across
  all graphs). Because node ids are **per graph** (`Init` and `Graph 1` both have node `1`),
  the registry drops every issue a collection rule anchors outside the validated graph and
  warns once per rule id: *decide from `collectionNodes`, report against `nodes`*.

The context shape:

```ts
{
  graphId, nodes, nodeTypesByNodeId, // nodeTypesByNodeId stays graph-keyed
  connections?,     // edges of the validated graph, filled by the panel
  collectionNodes?, // every node of the collection, for scope: 'collection' rules
  graphSettings?,   // { executionType?, triggerName? } read from the validated graph
}
```

`connections`, `collectionNodes` and `graphSettings` are optional: `validateGraphRules()`
normalises an absent field to `[]` (`graphSettings` to `{}`), so a rule can read them without
guarding. The panel fills `connections` and `graphSettings` from the graph on screen;
`graphSettings.executionType` is `'startup' | 'continuous' | 'irq'` (normalised with
`normalizeExecutionType()`) and `graphSettings.triggerName` is the trimmed interrupt name of an
`irq` graph. The `irq` package uses both in `irq-graph-trigger`; see the package-rule table in
[node-validation-architecture.md](node-validation-architecture.md).

Rules are pure: they return `NodeCapabilityIssue[]`. They are de-duplicated by
`(nodeId, scope, controlId, inputId, message)` and a rule that throws is skipped with one
`console.warn`, so an extension can never break the badge pipeline.

Rule of thumb: *reads only nodes / connections / controls / collection structure → graph rule;
needs the target's pins / capabilities / resources → capability or resource layer.*

### Built-in graph rules (MQTT topics)

| Rule id | Scope | Issue | Issue scope |
|---------|-------|-------|-------------|
| `mqtt-topic-empty` | `graph` | `<Node kind> has no topic: this node never reaches the broker.` | `control` on the topic control |
| `mqtt-will-require-topic` | `graph` | `MQTT Will has no topic: the broker rejects a will without a topic.` | `control` on `willTopic` |
| `mqtt-will-duplicate` | `collection` | `Only one will fits into the MQTT connect: the last MQTT Will node in the collection wins over '<topic>'.` | `control` on `willTopic`, on every will except the last |
| `mqtt-read-unpublished` | `collection` | `No node in the collection publishes to '<topic>': the messages must come from another device.` | `control` on the subscribing topic |
| `mqtt-announce-unretained` | `graph` | `MQTT Announce is not retained: a subscriber that connects later will not see '<topic>'.` | `control` on `retain` |

The three `scope: 'graph'` rules stay per-graph because each is about one node's own
configuration (a missing topic, a non-retained announce) — another graph can never make them
right. The two `scope: 'collection'` rules decide from the whole collection but still anchor
their issues to nodes of the validated graph (the registry's anchor guard enforces that).

All of them use `source: 'graphRule'`, `capability: null`. `mqtt-read-unpublished`
skips topics ending in `/status`: a status/birth topic (`homeassistant/status`) is
published by another system by convention. Topics are resolved through
`effectiveTopicValue()` (`nodes/graph-topics.ts`), so the `__new__` sentinel plus the typed
`customTopic` text count as one topic for both the dropdown and the validator.

### Package rules

| Rule id | Scope | Issue |
|---------|-------|-------|
| `hass-requires-bridge` | `collection` | `hass-*` entity nodes without a `hass-bridge` anywhere in the collection; a second bridge is flagged |
| `hass-bridge-will-conflict` | `collection` | an `mqtt-will` node competing with the bridge's own will |
| `webview-page-contract` | `graph` | duplicate page ids, invalid page navigation metadata, more than one `web-root` in the graph |
| `webview-root-ownership` | `collection` | a page graph without a `web-root` in the graph or the collection |

Both `webview` rules report on every target, including open-pin ones — they are the checks that
used to sit on the per-node capability path, where `validateNodeCapabilities()` skipped them for
`openPins` targets.

### Writing a rule

```ts
import { bareNodeTypeId } from '../nodes/graph-topics.js';
import { registerGraphRule } from './graph-rule-registry.js';

registerGraphRule({
    id: 'hass-requires-bridge',
    scope: 'collection',
    run: ({ nodes, collectionNodes }) => {
        const allNodes =
            Array.isArray(collectionNodes) && collectionNodes.length > 0 ? collectionNodes : nodes;
        const hasBridge = allNodes.some((node) => bareNodeTypeId(node.type) === 'hass-bridge');
        if (hasBridge) {
            return [];
        }
        return nodes
            .filter((node) => bareNodeTypeId(node.type).startsWith('hass-'))
            .map((node) => ({
                nodeId: String(node.id),
                scope: 'node' as const,
                message: 'Add a hass-bridge node: entities are only announced through it.',
                capability: null,
                controlId: null,
                inputId: null,
                source: 'graphRule' as const,
            }));
    },
});
```

`node.type` in that context is the package-prefixed id; strip the `package.` prefix with
`bareNodeTypeId()` before matching the bare type. The built-in rules and the `hass` package
rule already do this.

### Package hook

A node package's `capabilityChecks` module may export `registerGraphRules` next to (or instead
of) `registerCapabilityChecks`; `data/node-package.ts` calls it with `registerGraphRule` when it
loads the package validation hooks. The manifest key stays `capabilityChecks`.

Because node packages are plain scripts loaded at runtime and cannot import core modules by
path, the registry is also published on the global scope: `globalThis.GraphRules` exposes the
object-shaped `register({ id, scope, run })`, and `globalThis.GraphTopicRules`
(`register`, `validate`, `getRuleIds`, `clear`) stays as the compatibility alias whose
`register` still takes the positional `(id, fn)` form. `collectTopicBindings()` and the rule
ids stay module exports, so TypeScript code (and tests) use the same implementation.
