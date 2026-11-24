# Node Validation Architecture

This is the canonical page for "where does a check belong?". The invariant, in one sentence:
**every check is either a declaration (`node_definitions.json`), a per-node capability check, a
per-graph rule, or an entry in the resource validator; a check that fits none of them means the
layer is extended in `core/`, not a fifth mechanism.**

Where the layers run: declarations, per-node checks and cross-node resources are enforced at
deploy and in the editor; graph rules are editor-time badges only (`revalidateNodeCapabilities()`
in `views/graph-panel-view.ts`).

## Layers

| Layer | Answers | Lives in | Needs a device target | Runs on permissive targets |
|-------|---------|----------|-----------------------|----------------------------|
| L0 target data | which pins/capabilities/resources does this board have? | `device_targets/`, `targets/*.json` | — (it *is* the target) | — |
| L1 declarations | what does a node type statically require/consume? | `node_definitions.json` + `manifest.json` | no | yes |
| L2 per-node capability checks | does this node fit the target's pins/capabilities? | `registerCapabilityChecks` handlers | yes | **no** (bypassed for `openPins`) |
| L3 graph rules | is the graph/collection *shaped* correctly (singletons, forbidden combinations, topics)? | `core/graph-rule-registry.ts` | no | **yes** |
| L4 cross-node resources | do the nodes of this graph share pins/pools/buses legally? | `core/graph-resource-validator.ts` | yes | **no** (bypassed for `openPins`) |

The last column is the reason this page exists: L2 and L4 are skipped for `openPins` targets,
L3 never is.

## L0 — target data

Target descriptors under `device_targets/` / `targets/*.json` are **data**, not a place for a
rule: they list the pin table, `generalCapabilities` and `resources`. They are resolved into a
`TargetCapabilitySnapshot`, which is the input of L2 and L4. Examples: `generic_micropython`
declares `openPins: { "min": 0, "max": 255 }` and is therefore *permissive* (L2/L4 bypassed);
`esp32_devkit_v1` carries a real pin table. A new rule never goes here — it goes to L1–L4.

## L1 — declarations

Constant, target-independent facts about a node type are declared in `node_definitions.json`
(or, for package-level facts, in `manifest.json`):

| Field | Where | Meaning |
|-------|-------|---------|
| `requiredCapabilities` | `node_definitions.json`, `manifest.json` | CNF expression (AND-of-OR-groups) of capability ids the node/package needs |
| `resourceUsage` | `node_definitions.json` | declarative pin/bus consumption; a `kind: "pin"` entry **is** the node's requirement for that capability — the modality table lives in the [Node Definition Reference](node-definition-reference.md#resourceusage-array) |
| `capabilityCheck` | `node_definitions.json` | **legacy** string reference to a global function (`NodeCapabilityChecks.mathNode`, `.digitalInput`, `.servoNode` — the only three) |

`capabilityChecks` in `manifest.json` is **a module path, not a registration kind**: one module
may export `registerCapabilityChecks`, `registerGraphRules`, both (since 4.0) or neither
(`audio`, `mqtt`, `power` only create the legacy global).

Requirements come from two sources that
`core/capability-requirements.ts#resolveNodeCapabilityRequirements` unions: the
`requiredCapabilities` CNF expression and one single-id OR-group per `resourceUsage` pin entry
(deduplicated by capability key). The modality rules live on the pin entry itself —
`NodeResourceUsage.requiredWhen` in `data/node-type.ts` — required by default, optional when the
control sets `dynamicOptions.allowNone`, conditional through `requiredWhen: { controlId, equals | in }`,
and not a requirement when no entry exists. Pin keys are therefore never repeated in
`requiredCapabilities`.

The suppression rule lives in exactly one place, `suppressMissingCapabilityPinIssues`
(`core/node-capability-validator.ts`), applied to the final issue union: a `scope: 'control'` issue
is dropped **only** when its capability is reported missing **and** the target exposes zero pins for
it. The predicate is OR-group aware, so an alternative capability keeps its per-pin line; a genuine
bad pin on a board that has the capability is never hidden; and handler-emitted lines are covered
because the filter runs over the whole union rather than inside `collectResourceUsageIssues`.

## L2 — per-node capability checks

A package module exports `registerCapabilityChecks(register)`, called from
`data/node-package.ts:425–440`; it calls `register(nodeTypeId, handler)` with the `<package>.`
prefix (e.g. `stdmo.servo`). The handler receives one argument object
`{ nodeData, deviceTarget, validationContext }` and may return a string, `false`, one issue
object, an `issue[]`, or `null`. A handler **adds** its own issues; it never replaces the L1
requirement — `requiredCapabilities` and the requirements derived from `resourceUsage` are always
evaluated and reported alongside the handler's findings.

Resolution walks three steps: `getCapabilityCheckHandler()` → `capabilityCheckHandler` → the
legacy `capabilityCheck` string resolved against `globalThis.NodeCapabilityChecks`. The legacy
branch is **deprecated — do not add new ones**.

The permissive-target bypass (`core/node-capability-validator.ts:536–542`) returns early when
`deviceTarget.isOpenPinSet`; resource-usage membership is skipped there too, but phase-mismatch
checks survive it.

## L3 — graph rules

`core/graph-rule-registry.ts` is the single registry for shape checks:
`registerGraphRule({ id, scope, run })`, `scope: 'graph' | 'collection'`,
`getGraphRules()` / `validateGraphRules()` / `clearGraphRules()`, `Map`-by-id replacement, a
per-rule `try`/`console.warn`, and de-duplication by
`(nodeId, scope, controlId, inputId, message)` in registration order.

The context is `GraphRuleContext` — `nodes`, `nodeTypesByNodeId` (graph-keyed), `connections`,
`collectionNodes`, `graphSettings`
(`{ executionType?, triggerName?, signalNames?, signalMode?, runOnStart? }`, normalised to `{}`) —
with **no `target` field**. `GraphPanelView._collectGraphIssues()` fills all five fields through the
normalizers in `js/data/graph-execution-settings.ts` (`normalizeExecutionType`,
`normalizeTriggerName`, `normalizeSignalNames`, `normalizeSignalMode`, `normalizeRunOnStart`), so a
rule sees the same values the transpiler does. Leaving the signal fields at their `{}` defaults is a
bug, not a neutral omission: `event-signal-selection` reads `signalNames`, so an unpopulated context
reports *"This event graph has no signals selected"* on a graph that has a selection. A
`scope: 'collection'` rule may read
`collectionNodes`, but node ids are per graph, so the registry drops every issue a collection
rule anchors outside the validated graph (one warning per rule id): *decide from
`collectionNodes`, report against `nodes`*.

The package hook is `registerGraphRules(register)` on the same `capabilityChecks` module; it is
called with `registerGraphRule` (`data/node-package.ts:442–443`). Every rule issue carries
`source: 'graphRule'`. For plain-script packages the registry is also published on the global
scope: `globalThis.GraphRules` (object form) next to the deprecated `globalThis.GraphTopicRules`
alias (positional form, kept for packages written against it).

Core built-in rules (registered by `core/graph-topic-validator.ts`):

| Rule id | Scope | Issue |
|---------|-------|-------|
| `mqtt-topic-empty` | `graph` | an MQTT node with no topic |
| `mqtt-will-require-topic` | `graph` | a will node with no topic |
| `mqtt-will-duplicate` | `collection` | two will nodes on different topics in the collection |
| `mqtt-read-unpublished` | `collection` | a read on a topic no collection node publishes |
| `mqtt-announce-unretained` | `graph` | an announce that is not retained |

Package rules:

| Rule id | Scope | Issue |
|---------|-------|-------|
| `hass-requires-bridge` | `collection` | `hass-*` entities without a bridge, or a second bridge |
| `hass-bridge-will-conflict` | `collection` | an `mqtt-will` node competing with the bridge's will |
| `hass-availability-duplicate-id` | `collection` | two `hass-availability` nodes whose ids sanitise to the same topic segment: `Two hass-availability nodes publish '<segment>': they overwrite each other's retained payload, so Home Assistant cannot tell which flag it is reading.` — badged on every flag node of the graph on screen |
| `hass-availability-invalid-id` | `graph` | a `hass-availability` node whose `id` is empty or sanitises to nothing: `This availability flag has no usable Availability ID: nothing is published and no entity can reference it.` |
| `hass-availability-missing-flag` | `collection` | any entity node (`hass-sensor`, `hass-binary-sensor`, `hass-number`, `hass-switch`, `hass-select`, `hass-text`, `hass-button`) whose `availabilityFlags` names a flag no `hass-availability` node in the collection defines: `Availability flag '<id>' is not defined by any hass-availability node in the collection: the entity stays unavailable until that flag exists.` The reserved `__device__` entry is excluded. |
| `hass-icon-invalid` | `graph` | the `icon` control of any of the seven entity nodes, when it is not `<set>:<name>` (bare `thermometer`, `mdi:`, `MDI:Thermometer`, `mdi:thermo meter`, `mdi::x`): `icon '<value>' must be written as '<set>:<name>', e.g. 'mdi:thermometer'.` — error, and an unknown but well-formed name is *not* flagged (the rule is synchronous, the MDI index is an async fetch; the picker hints it instead) |
| `vars-duplicate-declaration` | `collection` | two `var-read` / `var-write` nodes declaring the same variable in the same store: `The variable '<name>' in store '<store>' is declared by more than one node.` — badged on every declaring node |
| `irq-name-required` | `graph` | an `interrupt-input` node whose `triggerName` is blank: `This interrupt input has no name: irq-mode graphs and interrupt-enable nodes cannot target it.` |
| `irq-name-duplicate` | `collection` | two `interrupt-input` nodes declaring the same `triggerName`: `The interrupt name '<name>' is declared by more than one interrupt input.` — badged on every declaring node of the graph on screen |
| `irq-enable-dangling` | `graph` | an `interrupt-enable` node whose `triggerName` no `interrupt-input` node of the collection declares: `No interrupt input declares the name '<name>'.` — decides from `collectionNodes` so a channel declared in another graph counts |
| `irq-graph-trigger` | `graph` | an `irq`-mode graph (`graphSettings.executionType`) with no `triggerName`, or one naming an interrupt input that is not in this graph: `This irq-mode graph has no interrupt name: pick the interrupt input it runs on.` / `The interrupt name '<name>' is not declared by an interrupt input in this graph.` |
| `irq-pin-duplicate` | `collection` | two `interrupt-input` nodes whose effective `pin` is the same GPIO (an unset control counts as GPIO `0`, numeric strings compare as numbers): `GPIO <pin> is used by more than one interrupt input: only one interrupt can own a GPIO.` — badged on the `pin` control of every claiming node of the graph on screen, because the second `pin.irq()` replaces the first handler and leaves the first channel deaf |
| `webview-page-contract` | `graph` | duplicate page ids, bad navigation metadata, more than one root |
| `webview-root-ownership` | `collection` | a page graph without a root in the graph or collection |

The three `hass-availability-*` rules compare **sanitised** ids, because the runtime builds the
topic from `_sanitize_id()`: `Heating Pwr!` and `Heating_Pwr` collide on one retained topic and
must not be reported as two flags. `hass-availability-invalid-id` is `graph`-scoped (the node is
either on screen or it is not); the other two decide from `collectionNodes` and report against
the graph's own nodes, so a flag that lives in another graph still counts as defined without
badging a look-alike node id.

The panel re-runs the rules (`revalidateNodeCapabilities()`) when a graph execution setting
changes, so `event-signal-*` and `irq-graph-trigger` badges follow an edit instead of a reload: the
graph wildcard listener reacts to `executionType`, `triggerName` and `signalTrigger` (the
`NodeGraph.*` events the settings view and toolbar emit) and to nothing else. `interval` and
`enabled` only refresh the toolbar mirrors, because no rule reads them.

## L4 — cross-node resources

`core/graph-resource-validator.ts` consumes L1 `resourceUsage` against L0 `resources` for
pin/pool/bus legality. It runs at deploy (`deployment/collection-deployment.ts:1904`) and in the
editor. Its rule tables (pin-function conflict, duplicate same-capability pin, shared-pool
exhaustion, constraints, I2S clock contention) live in
[graph-resource-validation.md](graph-resource-validation.md) — do not restate them here.

## The issue object and the badge pipeline

Every layer reports through one shape, `NodeCapabilityIssue`
(`core/node-capability-validator.ts`): `nodeId`, `scope: 'node' | 'control' | 'input-default'`,
`controlId`, `inputId`, `capability`, `message`, `severity` (`'info' | 'warn'`), and `source`
— one of `'requiredCapabilities'`, `'capabilityCheck'`, `'graphRule'`. `nodeId: null` is a
graph-level badge; `revalidateNodeCapabilities()` attaches an issue to a node when
`nodeId === id || nodeId === null`.

The asymmetry: deploy runs L1/L2/L4 only — graph rules are editor-time until the deferred
`blocking` flag exists.

## Which layer?

In order:

1. **Does the answer depend on the target's pins/capabilities/resources?** → L2 or L4 (one node

## Package coverage

| Package | L1 declarations | L2 per-node checks | L3 graph rules |
|---|---|---|---|
| `audio` | `requiredCapabilities` (10), `resourceUsage` (2), manifest `requiredCapabilities` | none — module only creates `globalThis.NodeCapabilityChecks` | none |
| `core` | `resourceUsage` (4), `capabilityCheck` → `NodeCapabilityChecks.mathNode` / `.digitalInput` | `mathNode`, `digitalInput` (legacy global) | none — the five `mqtt-*` built-ins live in frontend `core/graph-topic-validator.ts`, not the `core` package |
| `hass` | manifest `requiredCapabilities` (wifi/ethernet) | `registerCapabilityChecks` — empty by design | `hass-requires-bridge`, `hass-bridge-will-conflict`, `hass-availability-duplicate-id`, `hass-availability-invalid-id`, `hass-availability-missing-flag`, `hass-icon-invalid` |
| `irq` | `resourceUsage` (`irq` pin) | `registerCapabilityChecks` — `irq.interrupt-input` pull resistor | `irq-name-required`, `irq-name-duplicate`, `irq-enable-dangling`, `irq-graph-trigger`, `irq-pin-duplicate` |
| `led` | `resourceUsage` (3) | none — module is an empty registrar on purpose | none |
| `mqtt` | manifest `requiredCapabilities` (wifi/ethernet) | none | none — its topic rules are the core built-ins |
| `power` | `resourceUsage` (1) | none | none |
| `stdmo` | `requiredCapabilities` (1), `capabilityCheck` → `.servoNode` | `servoNode` (legacy global) | none |
| `vars` | none | `registerCapabilityChecks` — `vars.signal-post` name (over-long/ambiguous; blank = disabled) | `vars-duplicate-declaration`, `event-signal-selection`, `event-signal-producer` |
| `webview` | manifest `requiredCapabilities` (wifi/ethernet) | none after Phase 1 | `webview-page-contract` (`graph`), `webview-root-ownership` (`collection`) |

## Recipes

- **Constant pin/feature requirement** → declare `resourceUsage` or `requiredCapabilities`; no
  code.
- **A check that needs `deviceTarget`** → a `registerCapabilityChecks` handler (the old `hass` /
  `webview` handlers are the shape reference *and* the warning example).
- **A singleton / forbidden combination / cross-graph requirement** → `registerGraphRule` with
  the right `scope`.

## Anti-patterns (and where they came from)

- **Structure checks on the capability path** — `webview`'s "one root / page needs a root" were
  dead on `generic_micropython` because of the bypass; they are graph rules now.
- **The `GraphTopicRules` name** — non-MQTT packages never found the registry, so `hass` wrote
  against the global and `webview` wrote capability handlers; it is the shared
  `globalThis.GraphRules` registry now.
- **`NodeCapabilityChecks.<name>` string references** — fail silently when the global is missing;
  the only three (`mathNode`, `digitalInput`, `servoNode`) are deprecated and no new ones are
  added.
- **Validators in views** (`views/*.ts`) and per-node handlers reading
  `validationContext.graphNodes` — both leak a layer boundary into a place that should not
  answer that question.

## Checklist for a new check

1. Pick the layer with *Which layer?*.
2. Declare it (`node_definitions.json`) or register it (`registerCapabilityChecks` /
   `registerGraphRules`).
3. Word the message for its scope ("in this graph" vs "in the collection").
4. Add the test block.
5. Add the id to the rule tables above.
6. Add a changelog entry if a user sees it.

   → L2; several nodes of one graph → L4).
2. **Is it a fixed shape/combination/singleton question about nodes or edges?** → L3
   `scope: 'graph'`.
3. **Does it need nodes from other graphs of the collection?** → L3 `scope: 'collection'`.
4. **Is it a constant requirement of a node type?** → L1 declaration.

Two negative rules: a graph rule never receives `target`; a per-node check never reads graph
structure.

