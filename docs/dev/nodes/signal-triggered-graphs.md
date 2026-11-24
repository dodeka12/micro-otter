# Signal-Triggered Graphs

This document describes the cross-graph pulse signals that drive the `event` graph execution type,
and how an `event` graph is transpiled and validated.

## Scope

A **signal** is a short-lived, named pulse that a `signal-post` node raises and that an `event` graph
watches. Signals span the whole collection: a producer in one graph can trigger a watcher in another.
The `event` execution type turns a graph into a signal watcher with an `any`/`all` trigger mode.

Out of scope: signal payloads (a signal has no value, only a name), posting from interrupt context,
and `signal-fired` events. Interrupt names stay separate from signal names — an `interrupt-input`
channel is a hardware trigger, a signal is a software pulse.

## Runtime protocol

`otter_vars/signals.py` is a lazy module-level singleton (`ensure_signals()`), imported by the
generated code as `_signals`:

- `define(key, names, mode)` — registers (or resets) one listener key. `names` is deduplicated
  preserving order; `mode` is exactly `'all'` or `'any'`. The graph id is the listener key.
- `post(name)` — adds `name` to every watching key's pending set and sets its private event; an
  unknown name no-ops.
- `await wait(key)` — suspends until the key's `any`/`all` condition is satisfied, then consumes all
  pending names into `fired(key)` and returns `True`.
- `fired(key)` — the names consumed by the last `wait()`, or `()` before the first run.
- `edge(key, current)` — a per-key `False → True` rising-edge detector (used by the `signal-post`
  generator's `once` mode).

### Why a private event per listener

MicroPython `asyncio.Event.set()` wakes **all** waiters, and `clear()` is global. A single shared
event would let one listener's `clear()` steal the wake-up from another, starving it. Each listener
key therefore owns its own event plus a pending set: the pending set is the truth and the event is
only a doorbell. `wait()` clears the doorbell **before** checking the pending set — the
`clear()`-before-check order is the lost-wakeup guard — then awaits the event if nothing is pending.

## Semantics

| Aspect | Behaviour |
| --- | --- |
| `any` mode | One posted watched name satisfies `wait()`. |
| `all` mode | Every watched name must have been posted since the last run. |
| Coalescing | Posting the same name twice before one `wait()` counts once. |
| Consumption | A run consumes **all** ticked names: `fired()` reports them and the pending set is empty. |
| Replay | Posts made before `define()` are dropped and never replayed. |
| `runOnStart` | `true` (default) runs the body once at startup before the first `wait()`. |
| Caveat | In `all` mode, a watched name that is never posted blocks the graph forever. |

## Generated code

`runOnStart: true`, one watched name, `any` mode, graph id `graph-2`:

```python
async def radar():
    # Initialization
    _webview_text_1 = Text('range', 0)

    _signals.define('graph-2', ('radar-run',), 'any')
    _first_run = True
    while True:
        if not _first_run:
            await _signals.wait('graph-2')
        _first_run = False
        # loop body
        _signals.post('radar-done')
        await asyncio.sleep_ms(0)
```

A single watched name keeps the trailing comma in the `define` tuple; `all` mode differs only in the
third argument (`'all'`). `runOnStart: false` omits the `_first_run` prologue, making the wait the
first loop statement. The trailing `await asyncio.sleep_ms(0)` is mandatory because `wait()` can
return without suspending when a signal is already pending. No `_utime` / `_next_run_ms` cadence code
is emitted. A `signal-post` node emits:

```python
if bool(<enabled>):
    if _signals.edge('post:<graphId>:<nodeId>', bool(<fire>)):
        _signals.post('<name>')
```

`once: false` replaces the edge line with `if bool(<fire>):`.

A `signal-post` node whose signal picker is on `(not set)` is disabled: it emits only the comment
`# signal-post: no signal name selected`, and that is not a validation error.

## Validation

The transpiler rejects an **enabled** `event` graph with no signals
(`Event-triggered graph "<name>" has no signals selected; ...`); a disabled one is dropped first.
Two `vars` package graph rules flag the same conditions in the editor before deployment:
`event-signal-selection` (empty watch list) and `event-signal-producer` (a watched name no
`signal-post` node anywhere in the collection produces). An unproduced watched name is a warning, not
a hard error, because a graph may watch a signal before its producer exists.

The editor rules are fed from the graph itself: `GraphPanelView._collectGraphIssues()` reads
`signalNames`, `signalMode` and `runOnStart` through `normalizeSignalNames()`,
`normalizeSignalMode()` and `normalizeRunOnStart()`, so a graph with a stored selection never shows
the empty-selection error, and blank, duplicate or over-long entries cannot resurrect it (the
normalizer trims, deduplicates, slices to `MAX_SIGNAL_NAME_LENGTH` and caps at `MAX_SIGNAL_COUNT`).
The badge is re-evaluated as soon as `signalTrigger` (or the execution type / interrupt name)
changes, so it disappears while the settings view or the toolbar is still open, without a reload.

## Editor surfaces

The graph settings view shows the `event` execution type plus a **Signals** checkbox multi-select
dropdown, an `any`/`all` **Trigger mode** dropdown, and a **Run once at startup** checkbox. The
Signals row is the reusable `DropdownControl` with its own `label`
(`this.t('settings.graph.signals.label')`): the control renders the title in
`.dropdown-control__label` and associates it with the trigger through `aria-labelledby`, so there is
no separate `.view-graph-settings__label` caption and no gutter void above the picker. The title is
refreshed on a language change through `setLabel()`. There is no add-name input: the picker offers
exactly the names `collectSignalNames(collection, graph)` declares (plus a stored selection no
`signal-post` produces any more, so a stale tick stays visible with a warning), because a signal name
is created only on a `signal-post` node. The view refreshes the options from the graph's `node-added`
/ `node-removed` events and from a `node-updated` whose `patch.controlValues` carries `signal` or
`customSignal`.

The graph panel toolbar offers the `event` execution type in its dropdown and, for an `event`
graph, the same **Signals** multi-select and **Trigger mode** dropdown next to the execution-type
and interrupt-name controls (the two hosts are hidden for every other execution type). It reads and
writes the graph through `getSignalNames`/`setSignalNames` and `getSignalMode`/`setSignalMode`, so
the toolbar and the settings view stay one surface for one graph state. Both reuse the data-driven
`EXECUTION_TYPE_OPTIONS` / `EXECUTION_FIELD_VISIBILITY` shapes.

## See also

- [Function graphs](function-graphs.md) — the `function` execution type, the graph signature, the
  generated call nodes and the emitted `async def` bodies. The two execution types share the
  data-driven execution-type contract (`ExecutionType`, `GRAPH_EXECUTION_TYPES`,
  `EXECUTION_FIELD_VISIBILITY`) but never overlap: a signal graph runs on pulses, a function graph is
  called and awaited.
