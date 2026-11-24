# Node System Documentation

This folder contains documentation about node definitions, the transpiler, and code generation.

## Files

- **[node-validation-architecture.md](node-validation-architecture.md)** - Where a check belongs: declarations, per-node capability checks, graph rules, resource validator — for every package.

- **[graph-resource-validation.md](graph-resource-validation.md)** - The cross-node resource validator (pin/pool/bus conflicts) and the graph-rule registry.

- **[node-definition-reference.md](node-definition-reference.md)** - Complete JSON schema for node definitions including inputs/outputs, controls, dynamic structure, implementations, capabilities, i18n support, and per-connector/per-control `description` fields (colocated in each package's `node_definitions.json`).

- **[addons/](addons/index.md)** - Add-on node packages — the authoring guide. Overview of the parts of an add-on (manifest, module namespace, variants, node definitions, generators, capability checks) plus per-feature detail: [manifest](addons/manifest.md), [module namespace](addons/module-namespace.md), [variants](addons/variants.md), [node definitions](addons/node-definitions.md), [generators](addons/generators.md), [capability checks](addons/capability-checks.md), [installation](addons/installation.md), and [build & deploy](addons/build-and-deploy.md).

- **[transpiler-architecture.md](transpiler-architecture.md)** - Architecture of the transpiler system that converts node graphs into executable MicroPython code.

- **[webview-node-system.md](webview-node-system.md)** - Web View node package documentation covering node set, generator contract, runtime integration, refresh behavior, shell mount contract, and the `persist` / `_webcontrol` value-store round-trip.

- **[webview-node-contribution-contract.md](webview-node-contribution-contract.md)** - Node-specific contribution contract for modular webview runtime code generation, including ownership boundaries and deterministic assembly rules.

- **[vars-node-system.md](vars-node-system.md)** - Variable store node package (`vars`) covering the `vars.array` data type, the synchronous namespaced `VarStore` runtime, `var-read`/`var-write`, `var-store-save`/`var-store-load` persistence, the `signal-post` pulse node, the reserved `_webcontrol` namespace, and the array operation nodes (`array-generate`/`array-math`/`array-modify`/`array-select`).

- **[signal-triggered-graphs.md](signal-triggered-graphs.md)** - Cross-graph pulse signals and the `event` execution type: the `otter_vars/signals.py` runtime, the `any`/`all` trigger, run-on-start, the generated-code shape, and validation.

- **[function-graphs.md](function-graphs.md)** - The `function` execution type: the persisted signature and its port rules, the optional structural input/output nodes, the graph-settings editor, generated `function_graph.<id>` palette definitions, the emitted `async def` with hoisted init, the validation message ids, and graph copy/paste.

- **[led-node-system.md](led-node-system.md)** - LED and LED-strip node package (`led`) covering the `vars.array` pattern runtime, NeoPixel/PWM/single drivers, source/transform/output nodes, and the generated-code shape.

- **[time-node-system.md](time-node-system.md)** - Time node package (`time`) covering the NTP service, the `-1`/`-100` input sentinels, the device-clock behaviour, and the clock/date/window/format conversion nodes.

- **[irq-node-system.md](irq-node-system.md)** - Interrupt node package (`irq`) covering `interrupt-input`/`interrupt-enable`, the `otter_irq/interrupts.py` runtime contract, the 1:1:1 interrupt-name binding, the derived `irq` pin capability, and the generated statements.

- **[core-tuple-node-system.md](core-tuple-node-system.md)** - The `core.tuple` value type and the `core` nodes that build, open and index tuples (`compose`, `decompose`, `tuple-select`), plus the single-channel `select`, the indexed N-way `select-index` mux and the mixed tuple/scalar union rule.

- **[core-pin-node-system.md](core-pin-node-system.md)** - The `core` pin nodes (`adc-input`, `adc-array`/ADC Block, `dac-output`, `digital-input`, `digital-output`, `voltage-divider`), their `adc.wifiSafe`/`dac`/`digital.*` capabilities, and the `adc-array` paced `vars.array` capture contract.
