# Graph panel

A graph panel is one graph: a canvas of nodes and typed links, a toolbar above it and the node
palette on the right. Every graph in a collection gets its own panel.

## Add a node

1. Open the Palette tab on the right.
2. Find the node under its package group.
3. Drag it onto the canvas; it lands where you drop it.

| Palette control | What it does |
|---|---|
| Search | filters nodes by name |
| Organise mode | Alphabetical, By Package or By Category |
| View size | Small or Large icons |
| Favorites / Recently Used | quick access to the nodes you use most |
| Info icon | node description and input/output counts |
| Add-on badge | marks nodes that come from an installed add-on |

An empty node shows its ports and name; its controls are edited directly on the node body (text
fields, dropdowns, sliders, colour and icon pickers).

## Connect nodes

- Drag from an output port to an input port, or from an input to an output; either direction works.
- A link is created only when the data types are compatible. An invalid drop shows the reason next to
  the link and adds nothing.
- Each port accepts a limited number of links. Connecting to a port that is already full drops its
  oldest link, so re-wiring never leaves stale duplicates behind.
- To unlink, drag away from a connected input: the link detaches at once and follows the pointer. Drop
  it on another compatible input to re-target it, or on empty canvas to discard it.

## Insert a node into an existing link

Drop an unconnected node — one input and one output at least — onto a link and it is spliced in: the
upstream source feeds the new node, and the new node feeds the old target. The port pair is chosen so
both new links are type-valid; if no pair fits, the node stays where it was dropped and unconnected.

## Take a node out of a chain

| Gesture | Effect |
|---|---|
| `Alt`+drag a node | rewires its upstream sources straight to its downstream targets, then drops the node's own links; the node stays on the canvas, unconnected |
| `Ctrl`+`Delete` | does the same for every selected node, then deletes them |
| `Alt`+click | toggles the node's selection (no rewire, because the pointer did not move) |

`Alt`+drag only works on a node that has at least one input link and at least one compatible
downstream target; otherwise the same gesture pans the canvas.

## Move, pan, zoom

| Gesture | Effect |
|---|---|
| Drag empty canvas | pan |
| `Alt`+drag empty canvas, or middle-drag | pan |
| Mouse wheel | zoom around the pointer |
| `[` / `]` | narrow or widen the selected node by 10 px |
| Drag a node's right edge | resize that node horizontally |
| Drag a box on empty canvas | box-select nodes inside it |

Zoom is clamped between 0.275× and 2.75×; the default is 1×.

## Select, copy, delete

| Gesture | Effect |
|---|---|
| Click a node | select it alone |
| `Shift`+click | add a node to the selection |
| `Ctrl`+click (⌘ on macOS) | toggle a node in the selection |
| Click empty canvas | clear the selection |
| `Ctrl`+drag a node | copy it (or the whole selection) and drag the copy |
| `Ctrl`+`A` | select all nodes |
| `Ctrl`+`C` / `Ctrl`+`X` / `Ctrl`+`V` | copy / cut / paste; paste lands at the pointer |
| `Ctrl`+`D` | duplicate |
| `Delete` or `Backspace` | delete the selection |
| `F1` | open the node information dialog for the last selected node |

Right-click a node for Copy, Cut, Paste, Duplicate, Delete, Rename, Change Color and Show Information.
Right-click empty canvas for Paste, Select All, Grid Snap and Show Grid. Keyboard shortcuts are ignored
while a text field has focus.

## Graph toolbar

The toolbar above the canvas holds the graph-level settings.

| Control | What it does |
|---|---|
| Align nodes to grid | snaps every node to the grid in one undoable step |
| Execution Type | Startup, Loop, Interrupt, Event or Function |
| Interval (ms) | Loop only; `0` yields without waiting |
| Interrupt | Interrupt only |
| Signals, Trigger mode | Event only; Any or All, plus run once at startup |
| Function fields | Function only; category, icon, description, inputs, outputs |

The same settings appear in the Settings tab; see [Settings view](settings-view.md). Tabs and node
colours reflect the execution type.

## Documentation areas

The palette also offers a Documentation Area: drag it onto the canvas for a coloured, resizable box of
notes and formulas. It supports Markdown and `$…$` inline math, has its own menu for edit, colour,
rename, font size, align, cut/copy/paste/duplicate, fit to selection and delete, and it can be
duplicated with the rest of a selection.

## Undo and redo

Every edit — moving, wiring, pasting, bypassing, aligning to grid — goes through the active
collection's history. Use the Undo and Redo buttons in the title bar; history is per collection, not
per graph.

## Related

- [Collection view](collection-view.md) — tabs, collections, graph copy/paste.
- [Settings view](settings-view.md) — the same graph settings in tabular form.
- [Deploy view](deploy-view.md) — running the graph on a device.
