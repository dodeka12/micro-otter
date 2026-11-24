# IRQ Node System

This document describes the `irq` node package: a GPIO interrupt channel plus the node that gates it
from a graph body. The package is the editor side of the interrupt runtime documented in
`otter_irq/interrupts.py`; the generated code is fixed by that module's signatures.

## Overview

Two nodes, one runtime module, one binding rule:

| Node | Execution phase | Purpose | Outputs | Capability |
| --- | --- | --- | --- | --- |
| `interrupt-input` | `both` | Creates one `Pin` and one `otter_irq.interrupts` channel and exposes its state | `triggered` (`bool`), `count` (`int`), `state` (`bool`) | `irq` on `pin` |
| `interrupt-enable` | `loop` | Enables or disables a declared channel by name | none | none |

`interrupt-input` is the only node that declares the `irq` pin requirement, and it does so
declaratively through `resourceUsage`, not through a legacy per-node capability check.

## Scope

The package lives under `src/micro_otter/nodes/device/node_pkgs/irq/`:

- Manifest: `manifest.json`
- Node definitions: `node_definitions.json`
- Generators: `node_generators.js`
- Capability checks and graph rules: `node_capabilities.js`
- Icons: `icons/` (`bolt_24dp.svg`, `toggle_on_24dp.svg`)
- Runtime: `otter_irq/`

It is registered once in `node_pkgs/index.json` and once in
`runtime/general/manifest.json#nodePackages.global`.

## Runtime modules

- `otter_irq/interrupts.py` — the module-global channel registry. It deliberately imports no
  `machine`: the generated init block builds the `Pin` and passes it in together with a `Pin.IRQ_*`
  constant, so the module stays importable on CPython and testable with a fake pin.
- `otter_irq/__init__.py` — re-exports `interrupts`.

Frozen `mpAssets`, because every `irq` node needs the whole module:

```json
"mpAssets": {
  "*": ["otter_irq/__init__.py", "otter_irq/interrupts.py"]
}
```

### Public API

```python
InterruptInput(name, pin, trigger, debounce_ms=0)
  .handler      # bound method, pass to pin.irq(handler=...)
  .take()       # -> bool, True once per observed batch of edges
  .count()      # -> int, masked with _COUNT_MASK = 0x3FFFFFFF
  .state()      # -> bool(pin.value())
  async .wait() # one waiter only: the task that owns the channel's graph
  .set_enabled(enabled)  # early return when unchanged
  .detach()

create_input(name, pin, trigger, debounce_ms=0) -> InterruptInput  # ValueError on a blank name
get_input(name) -> InterruptInput | None
set_enabled(name, enabled) -> bool                                 # False for unknown names
async wait(name)                                                   # KeyError for unknown names
begin_generation() -> None                                         # detach in registration order, clear
```

### ISR discipline

The handler body is a gate (`if not self._enabled: return`), an optional tick-based debounce, one
masked integer increment and one `ThreadSafeFlag.set()`. No strings, containers or logging run in
interrupt context, and the handler is a single bound method stored on the instance so
`pin.irq(handler=...)` never allocates.

`take()` compares the ISR counter with a main-context cursor and never touches the flag, so a
polling (`continuous`) graph can use it without consuming the wake-up an `irq` graph is waiting for.
`wait()` consumes a latched set.

Disabling clears the ISR gate *before* detaching the pin; enabling sets it *before* re-attaching, so
no edge slips through the half-applied state. `set_enabled` returns immediately when the state is
unchanged, which keeps `interrupt-enable` free to call it on every loop iteration.

`begin_generation()` runs once per generated `app/main_loop.py` through the shared-init block. The
runtime never reloads `otter_irq.interrupts`, so without it the previous incarnation's channels would
keep their pins armed against a dead event loop.

## Name binding

An interrupt name is bound 1:1:1:

- one `interrupt-input` node declares it (`triggerName`, free text, trimmed),
- one `irq`-mode graph consumes it (`NodeGraph.getTriggerName()`),
- zero or more `interrupt-enable` nodes address it (`triggerName`, dropdown over declared names).

`create_input` stores the trimmed name and a repeated name replaces the previous entry, so two
`interrupt-input` nodes with the same name would silently collapse into one channel. Uniqueness and
the graph binding are enforced by the graph rules in `node_capabilities.js` plus the transpiler's
`irq` binding validation, not by the runtime.

The same name rule applies to the GPIO: one channel per pin. See
[One GPIO per interrupt input](#one-gpio-per-interrupt-input).

## `irq` pin capability

The device target derives `irq` from every pin that reports `digital.input`; there is no per-target
declaration. `interrupt-input.pin` therefore uses the shared capability dropdown
(`targetPinsForCapability` with `capabilityKey: "irq"`), and `pull` reuses the same dependent
`targetPinPull` control as `digital-input`.

## Generated code

Init (shared `init_irq_generation` block, `priority: 0`):

```python
from machine import Pin
import otter_irq.interrupts as _otter_irq

_otter_irq.begin_generation()
_irq_pin_<scope>_<id> = Pin(<pin>, Pin.IN[, Pin.PULL_UP | Pin.PULL_DOWN])
_irq_<scope>_<id> = _otter_irq.create_input('<name>', _irq_pin_<scope>_<id>, <trigger>, <debounce_ms>)
```

`<scope>` is the graph's generated Python function name (the emitted `async def <name>()`, e.g.
`button_a`). Every graph's `init_irq_generation` contributions are merged into **one** collection-wide
function while node ids restart in each graph, so a bare `_irq_<id>` would let two graphs with the same
node id overwrite each other's channel. The transpiler passes the name as `context.graph.scope` and the
generator builds `_irq_<scope>_<id>`; a generator context without a graph scope (unit tests, foreign
callers) keeps the unscoped name.

`<trigger>` is one of `Pin.IRQ_RISING`, `Pin.IRQ_FALLING`, `Pin.IRQ_RISING | Pin.IRQ_FALLING`
(`change`), `Pin.IRQ_LOW_LEVEL`, `Pin.IRQ_HIGH_LEVEL`; an unknown value falls back to
`Pin.IRQ_RISING`. `debounceMs` is floored and clamped into `0 … 10000`. `<name>` is trimmed and
single-quote escaped, so `create_input` never receives a blank name or a broken literal.

Body, one statement per connected output:

```python
<triggered> = _irq_<scope>_<id>.take()
<count> = _irq_<scope>_<id>.count()
<state> = _irq_<scope>_<id>.state()
```

An `irq` graph's loop head waits on its channel before running the body:

```python
    while True:
        await _otter_irq.wait('<name>')
```

The wait is the first loop statement (no `pass` is needed, because the wait is a statement), the
channel name is single-quote escaped via `formatLiteral()`, and the graph emits no cadence code and no
`utime` import.

`executionPhase: "both"` is deliberate and matches `digital-input`: the loop statement is evaluated
once during graph init as well. That is harmless because `take()` only advances the main-context
cursor and never clears the flag, so an `irq`-mode graph still receives the edge that arrived during
startup.

`interrupt-enable` runs in the loop:

```python
_otter_irq.set_enabled('<name>', bool(<enabled>))
```

`<enabled>` is the wired input, or the literal `True` for the default checkbox. A blank name emits
`# interrupt enable has no interrupt name` instead; the transpiler reports the real error.

### One GPIO per interrupt input

`pin.irq(handler=...)` is a per-GPIO slot: arming a second channel on the same pin replaces the first
channel's handler, so both channels stay registered under different names but only the last one sees
edges. The earlier channel's `count()` stays `0`, its `take()` always returns `False`, and an `irq`-mode
graph bound to it waits on a `ThreadSafeFlag` that is never set — with no error and no log line.

Two guards catch that before it ships:

- **Editor:** the `irq-pin-duplicate` graph rule (see
  [node-validation-architecture.md](node-validation-architecture.md)) badged on the `pin` control of
  every claiming node of the graph on screen.
- **Build:** the transpiler rejects the collection with
  `Graph "<graph>": GPIO <pin> is claimed by more than one interrupt input (<claims>). Only one interrupt can own a GPIO.`
  and names every claim as `Graph "<graph>" node "<id>"`.

Both compare the *effective* pin: an unset control (`undefined`, `null`, blank) counts as GPIO `0` —
the default the generator emits — and numeric strings compare as numbers, so `"4"` and `4` collide.
The rule reads the whole collection but badges only the graph on screen; the transpiler compares
collection-wide, so a duplicate split across two graphs is rejected too.

## Editor surfaces

`interrupt-enable.triggerName` is a dropdown over the interrupt names declared in the collection
(`dynamicOptions.source: "irqTriggerNames"`), so a user never types a name that no
`interrupt-input` node declares. The graph settings view and the graph panel toolbar own the `irq`
execution type and the trigger name of an `irq` graph (a data-driven `EXECUTION_TYPE_OPTIONS` list
plus a per-type `EXECUTION_FIELD_VISIBILITY` map that shows the sleep field for `continuous` and the
trigger field for `irq`).

The dropdown is served by `registerDynamicControlResolver(IRQ_NAME_SOURCE, ...)` in
`nodes/node-control-dynamic-resolver.ts` over `collectIrqTriggerNames()` from
`nodes/irq-triggers.ts`: collection-wide, no device target, the resolving node's own declaration is
skipped, and a stale current value is still offered so the reference stays visible until the
reconciler clears it. The source name is registered as collection-scoped in
`CROSS_NODE_DYNAMIC_SOURCES` (`nodes/node-ui-constants.ts`).

References stay in agreement with their declaration (`nodes/irq-consistency.ts`, wired through
`Collection.reconcileIrqReferences()` on `node-updated` / `node-removed` and on load): renaming an
interrupt input rewrites every `interrupt-enable.triggerName` and every graph `triggerName` that
used the old name; when a declaration disappears — the node is deleted or clears its name — every
reference that no longer resolves is reset to `''` (`(not set)`). Graph rewrites go through
`setTriggerName()`, node rewrites through `updateNode()`. Duplicate declarations are deliberately
left alone: they are a validation error, not something a rename may merge.

Five `irq` package graph rules badge the structural mistakes (see
[node-validation-architecture.md](node-validation-architecture.md)): `irq-name-required`,
`irq-name-duplicate` (`collection`), `irq-enable-dangling`, `irq-graph-trigger`, the last reading
`graphSettings.executionType` / `.triggerName`, and `irq-pin-duplicate` (`collection`, badged on the
`pin` control). "One `irq` graph per interrupt name" is a runtime constraint enforced by the
transpiler (Locked Decision 15), not an editor rule.

## Tests

- `tests/proc/irq-package-registration.test.js` — index/runtime registration, manifest metadata,
  resolved `mpAssets`, validation-hook exports.
- `tests/proc/irq-node-definitions.test.js` — node ids, controls, defaults, outputs,
  `resourceUsage`, init/implementation declarations, bilingual texts.
- `tests/proc/irq-generators.test.js` — exact init and loop statements, trigger constants, pull,
  debounce clamping, escaping, connected-output filtering, graph-scoped names.
- `tests/proc/irq-graph-transpiler.test.js` — cross-graph interrupt binding: the blank, duplicate,
  dangling and mis-bound cases, the duplicate-GPIO hard error, and graph-scoped shared-init
  variables (same node id in two graphs, and two graph names that sanitize identically).
- `tests/test_irq_interrupts.py` — the runtime contract against a fake pin.
- `tests/data/dynamic-control-consumers.test.js` — the `irq` pin capability and trigger-name
  dynamic sources.
- `tests/nodes/irq-triggers.test.js` — the collector: cross-graph entries, active-graph fallback,
  `excludeNodeId`, blank/duplicate names, sorting, prefixed and bare type ids.
- `tests/nodes/irq-consistency.test.js` — the pure patches and `IrqReferenceReconciler`, plus the
  `Collection` bridge (rename, removal, repair on load, idempotency, re-entrancy).
- `tests/nodes/irq-graph-rules.test.js` — all five package rules, including the `pin` anchor of the
  GPIO rule and the `collection` anchor guard.

