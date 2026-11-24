# The app

Micro-Otter is a browser node editor that turns node graphs into MicroPython and runs them on a
connected board; an optional local server adds firmware building, flashing and add-on installs.

## How the pieces fit

| Piece | Runs on | Role |
|---|---|---|
| Editor | the browser | collections, graphs, code generation |
| Local server | your computer | firmware build, flash, add-on install, package import (`uv run micro-otter serve`) |
| Device runtime | the board | MicroPython plus the collection the editor uploads |

- Collections and graphs are stored in the browser (IndexedDB); nothing reaches the device until you
  deploy.
- Without the local server the editor keeps editing and deploying source; the Firmware tab reports
  the server as offline.
- Web Serial requires Chrome or Edge (89+); Firefox and Safari cannot connect a board directly.

## The workspace

The title bar runs across the top; the graph area fills the left; the right tab strip holds the
tools.

| Title-bar item | What it does |
|---|---|
| Menu | collection, database, target-config and info actions |
| Collection selector | switch the active collection |
| Deploy / Sync | quick deploy of the active collection, no options dialog |
| Play / Stop | start or stop execution; shown while a device is connected |
| Version, runtime, Target | active collection's version, runtime and target board |
| Cable badge | connect or disconnect the device — the only place to connect |
| Server badge | local server state; firmware tools need it |
| Undo / Redo | walk the active collection's history |
| Language | switch the interface language |

| Right tab | Page |
|---|---|
| Palette | [Graph panel](graph-panel.md) |
| Settings | [Settings view](settings-view.md) |
| Transpiler | [Console and output](console-view.md) |
| Device | [Device view](device-view.md) |
| Deploy | [Deploy view](deploy-view.md) |
| Target Config | [Settings view](settings-view.md) |
| Firmware | [Firmware view](firmware-view.md) |

## Collections

A collection is the deployable unit: it holds the graphs, the runtime and target it is built for,
and its version.

| Part | Where it is edited |
|---|---|
| Graphs | graph tabs in the [collection view](collection-view.md) |
| Name, runtime, target, version, web asset format | Settings tab → Collection |
| Runtime and target short-cuts | title bar |

- Export and import a collection as JSON from the Menu.
- The last collection cannot be deleted.

## Graphs

A graph is a set of nodes wired by typed links: an output connects only to an input that accepts its
data type.

| Item | Meaning |
|---|---|
| Node | one operation with typed input and output ports |
| Link | a connection from an output port to a compatible input port |
| Graph tab | one graph; its tab colour follows the execution type |
| Enabled | disabled graphs are excluded from code generation |

See [Graph panel](graph-panel.md) for editing, [Collection view](collection-view.md) for tabs.

## Graph modes

Every graph runs in one execution type, picked in the graph toolbar or Settings → Graph.

| Mode | Toolbar label | When it runs | Extra settings |
|---|---|---|---|
| `startup` | Startup | once when the device boots | — |
| `continuous` | Loop | repeatedly, forever | Interval (ms); `0` yields without waiting |
| `irq` | Interrupt | once per interrupt edge | Interrupt |
| `event` | Event | when the watched signals fire | Signals, Trigger mode (`any` / `all`), Run once at startup |
| `function` | Function | only when another node calls it | Category, Icon, Description, Inputs, Outputs |

- `any` runs the graph when one watched signal fires; `all` needs every watched signal to have fired
  since the last run.
- An event graph with no signal, or with a signal no `signal-post` node produces, fails validation.
- A function graph is not scheduled; it is exposed to other graphs as a callable node.

## Firmware

|  | Source deploy | Firmware with packages |
|---|---|---|
| What runs the nodes | uploaded `.py` libraries | libraries precompiled to `.mpy` inside the image |
| RAM use | higher | lower |
| Boot time | slower | faster |
| Rebuild per graph change | no | no — deploy again |
| When to use | quick iteration, any compatible firmware | tight memory, faster boot, stable package set |

Both paths use the Deploy tab for the collection. Only the Firmware tab builds images; see the
[Firmware view](firmware-view.md) and the source-upload rule in the [Deploy view](deploy-view.md).
