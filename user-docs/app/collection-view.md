# Collection view

The left pane of the editor shows the graphs of the active collection as tabs, one graph per tab,
with the add-graph control in the tab bar and the collection selector in the title bar.

## Tabs

| Control | What it does |
|---|---|
| Tab | switches to that graph |
| Add Graph | adds a graph with a unique default name and opens it |
| Tab context menu | Rename Graph, Enabled, Copy Graph, Paste Graph, Delete Graph |

- Graph names must be unique inside a collection; a rename to an existing name is rejected.
- `Enabled` is a check mark: disabled graphs stay in the tab strip but are skipped by code
  generation.
- `Copy Graph` puts a deep copy of the graph on an internal clipboard, so later edits of the source
  do not leak into the paste. `Paste Graph` is disabled until something has been copied.
- `Delete Graph` asks for confirmation and is disabled when the collection holds a single graph.
- A collection auto-creates an empty graph when it would otherwise have none, and refuses more than
  64 graphs.

Tabs are coloured by execution type, so the Startup/Loop/Interrupt/Event/Function mix of a collection
is visible without opening each graph.

## Working in a tab

The tab body is the [graph panel](graph-panel.md): node palette on the right, canvas in the middle,
graph toolbar above it.

| Task | Where |
|---|---|
| Add a node | Palette → node package → node |
| Wire nodes | drag from an output port to a compatible input port |
| Edit node settings | directly on the node body (text fields, dropdowns, sliders, colour and icon pickers) |
| Show node documentation | node context menu → Show Information, or `F1`, or the palette's info icon |

## Collections

The collection selector in the title bar switches graphs, target, runtime and version together. Menu
→ Collection export/import moves a collection between browsers as JSON.

| Action | Effect |
|---|---|
| Add Collection | adds an empty collection and switches to it |
| Export | writes the collection as JSON |
| Delete | removes the collection; the last one cannot be deleted |

The collection's name, runtime, target, version and web asset format are edited in the Settings tab;
see [Settings view](settings-view.md).

## Related

- [Graph panel](graph-panel.md) — editing the open graph.
- [Deploy view](deploy-view.md) — sending the collection to a device.
