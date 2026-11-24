# Vars package

The memory layer of a collection: named store entries, float arrays with in-place operations,
persistence to the device filesystem, random sources and the signals that wake event-triggered
graphs.

## Setup

| Requirement | Detail |
|---|---|
| Store entries | every store node picks a **Store** namespace and a **Name** from the collection's own entries; the first write creates the entry |
| Arrays | float arrays only; length comes from `Count` or from a connected array |
| Persistence | `Store Save` and `Store Load` write and read `var_store/<name>.json` on the device |
| Signals | `Post Signal` names a signal that a `signal`-mode graph waits on |
| Random | `Random Value` draws from the generator that `Random Seed` seeds |
| Companion packages | none — but `mqtt` and `hass` packages depend on this one for their JSON store namespaces |

## Nodes

| Node | What it does |
|---|---|
| [Variable Read](var-read.md) | reads a store entry, or the fallback input when it does not exist yet |
| [Variable Write](var-write.md) | writes a value into a store entry while `Enabled` is true |
| [Store Save](var-store-save.md) | writes a whole store namespace to `var_store/<name>.json` on a rising edge |
| [Store Load](var-store-load.md) | reads a whole store namespace back on a rising edge |
| [Array Generate](array-generate.md) | builds a float array of `Count` entries and reuses its buffer |
| [Array Select](array-select.md) | returns one element, with a fallback for an index out of range |
| [Array Set](array-set.md) | writes elements, fills, ramps, steps, hat, sine, square, sawtooth or random values |
| [Array Modify](array-modify.md) | shifts, repeats, ping-pongs, concatenates or interlaces a whole array |
| [Array Math](array-math.md) | element-wise arithmetic or a reduction over arrays and scalars |
| [Random Value](random-value.md) | emits one uniform or normal sample per pass, as float or integer |
| [Random Seed](random-seed.md) | seeds the shared generator once per change |
| [Post Signal](signal-post.md) | posts a named pulse that a `signal`-mode graph waits on |

## Shared concepts

- Store entries live in a namespace: the **Store** picker lists every namespace in the collection
  (`default` first) and the **Name** picker lists only the variables of the selected namespace, so
  `foo` in `presets` and `foo` in `default` are unrelated. `New store…` and `Declare variable…`
  reveal a text field for a name that does not exist yet.
- A variable exists while exactly one `Variable Read` or `Variable Write` declares it. Renaming it
  rewrites every reference automatically; a second declaration of the same name in the same namespace
  is flagged on both nodes. Namespaces starting with `_` are package-owned (for example the webview
  controls) and are never offered.
- Arrays are `array('f')` and every operation returns a new array unless `In Place` is ticked.
  `Array Generate` reuses one buffer between passes, so a generated array handed to two consumers is
  the same object — copy it before anyone mutates it.
- `Array Select` resolves an out-of-range index by its `Index Mode`: `Default` returns the fallback
  input, `Clamp` the nearest end, `Wrap` the wrapped position.
- `Store Save` and `Store Load` act on a whole namespace, not on one entry, and only on a rising edge
  of their `Save` / `Load` input — a constantly true input saves once, not every pass. A save is
  atomic (temporary file plus rename) and a load replaces the namespace instead of merging; a missing
  or invalid file leaves the namespace untouched.
- Only one generator exists, so `Random Seed` controls both `Random Value` and the random modes of
  `Array Set`. A seed that changes every pass is the same as no seed at all.
- A signal is a pulse: every graph waiting on the name wakes once, and a second `Post Signal` in the
  same pass is still one wake-up. Use a store entry when a value must travel with the wake-up.

## Related

- [MQTT package](../mqtt/index.md) and [Home Assistant package](../hass/index.md) — store namespaces as JSON payloads
- [led package](../led/index.md) — arrays feed the addressable strip channels
- [Graph panel](../../app/graph-panel.md) — `signal` execution type and store namespace per graph
