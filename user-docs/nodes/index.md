# Node reference

Every node in the palette belongs to exactly one node package: the package ships the definition,
the generator, the icons and the MicroPython runtime the node needs.

## How these pages are organised

| Page | Holds |
|---|---|
| This page | the conventions every node page follows, and the package index |
| Package page | what the package is, what it needs to run, and every node it contains |
| Node page | one sentence, the ports, the controls, the behaviour, one example |

- A package page lists all of its nodes; a node without its own page yet appears there as a plain
  title.
- A node page only describes the node itself. Setup that belongs to the package — pins, transport,
  service nodes — stays on the package page and is linked from the node page.
- Pages are ordered by package, then by the order the palette shows the nodes.

## Package page template

```markdown
# <Package name>

<One paragraph: what the package is, taken from its manifest description.>

## Setup

| Requirement | Detail |
|---|---|
| ... | ... |

## Nodes

| Node | What it does |
|---|---|
| <Node title> | one line |

## Shared concepts

<Only when the package has one: topics, stores, authority, layout.>

## Related

- user pages for the nodes that need a longer explanation
```

## Node page template

```markdown
# <Node title>

<One sentence: what the node does.>

## Inputs

| Port | Type | What it receives |
|---|---|---|

## Outputs

| Port | Type | What it emits |
|---|---|---|

## Parameters

| Control | Type | Default | Effect |
|---|---|---|---|

## Behaviour

<When it runs in which graph mode, plus side effects. Five lines at most.>

## Example

<A minimal connect-note: what to wire where, in steps or bullets.>

## See also

- the package page, then related nodes
```

Inputs and outputs are written as `None` when the node has no ports; `Parameters` disappears
entirely for a node without controls. Behaviour is limited to what a graph author can observe — which
phase the node contributes code to, what it publishes, what it forgets — never how it is
implemented.

## Packages

| Package | Nodes | Covers |
|---|---|---|
| [audio](audio/index.md) | 12 | I2S audio input/output and block-level voice effects |
| [core](core/index.md) | 20 | constants, math, logic, pins, ADC/DAC and tuple helpers |
| [hass](hass/index.md) | 9 | Home Assistant MQTT discovery entities |
| [irq](irq/index.md) | 2 | GPIO interrupt input and interrupt enable |
| [led](led/index.md) | 3 | single LEDs, RGB strips and addressable strips |
| [mqtt](mqtt/index.md) | 5 | broker publish, subscribe, status, will and announcement |
| [power](power/index.md) | 1 | battery pack monitoring |
| [stdmo](stdmo/index.md) | 1 | servo control |
| [time](time/index.md) | 6 | NTP clock service and clock/date conversions |
| [vars](vars/index.md) | 12 | named stores, arrays, random values and signals |
| [webview](webview/index.md) | 21 | the on-device web UI and its value stores |

## Conventions

| Convention | Meaning |
|---|---|
| Backticked names | the exact label the editor shows, for example `Publish Mode` or `Available Flags` |
| "the inline control" | the small widget on an unconnected input that supplies its value |
| Port types | the connector type from the palette; an output only links to a matching input |
| `Enabled` | where a node has one, it gates what the node *does* — it never stops the graph |
| Palette title | the page title; the package's `node_definitions.json` keys the node by id, such as `hass-binary-sensor` |

- Port and control names are English labels; the interface language changes the displayed text but
  not the behaviour described here.
- A node that needs a hardware capability shows a badge when the active target lacks it, and its pin
  dropdown offers only pins the target declares.
- Where a page says a node is "inert" without a setting, it emits no code for the missing part
  instead of publishing to a guessed topic.
