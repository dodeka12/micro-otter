# Capability Checks

Capabilities decide whether a node, a package, or a variant is valid for a given target. There are
two mechanisms, and an add-on reuses both unchanged.

## Declarative: `requiredCapabilities`

A **CNF** requirement (AND of OR-groups). Each top-level list element is a capability id (an
OR-group of one) or an array of ids (an OR-group); the top level is AND.

```json
"requiredCapabilities": ["viper"]
"requiredCapabilities": [["wifi", "ethernet"], "viper"]   // (wifi OR ethernet) AND viper
```

Where it can live:

- **Node definition** — gates a single node type on the target.
- **Manifest** (base) — gates the whole package's firmware inclusion.
- **Variant (a `variants` entry)** — gates that variant.

Capability ids resolve against the target's `generalCapabilities` (e.g. `viper`, `wifi`) and pin
resources (e.g. `pwm.output`, `i2s`) via the capability registry — see
[target-capability-schema-reference.md](../target-capability-schema-reference.md).

## Imperative: `capabilityChecks` (`node_capabilities.js`)

For checks that are not a simple CNF expression, the manifest's optional `capabilityChecks` field
names a file that registers handlers on `globalScope.NodeCapabilityChecks`, and a node definition
references one by `"capabilityCheck": "NodeCapabilityChecks.<name>"`. An absent `capabilityChecks`
key means **no imperative checks**. This is the **legacy** mechanism — prefer
`requiredCapabilities` for new nodes, and register imperative per-node checks as
`registerCapabilityChecks` handlers as described in
[node-validation-architecture.md](../node-validation-architecture.md).

## Which to use

- Use `requiredCapabilities` whenever the gate is "target provides capability X (and Y)".
- Use an imperative handler only when the decision depends on more than a capability list.
- A node-level `capabilityCheck` takes precedence over that node's `requiredCapabilities`.

Capabilities are validated before transpilation/deployment; a package whose variant is unsatisfiable
on the target is simply excluded from the image (or, when forced via an override, rejected with
`variant-capabilities-unsatisfied`).
