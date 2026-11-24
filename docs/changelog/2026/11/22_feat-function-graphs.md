# Changes since version 1.39.0

## New Features

- **Function graphs** — a graph can now use the new `function` execution type and is emitted as a
  callable `async def` instead of a scheduled loop; the generated body takes its parameters from the
  declared inputs, returns the declared outputs, and its initialization runs once at startup rather
  than on every call.
- **Function signature editor** — the graph settings gain a function block with a palette category,
  collapsible *Inputs* and *Outputs* sections, a name field, a data-type multi-select per port, and
  move-up/move-down/delete buttons. Names are validated inline, `any` is exclusive, and a list
  holds at most 32 ports.
- **Function parameter defaults** — every input parameter now declares a default value and, for
  `int`/`float`/`double` types, `min`/`max`/`step` bounds, edited right in the parameter row (default
  type, default value, bounds). `min`/`max` are hard constraints — the editor clamps a typed number
  into them and the stored node default is clamped to the same bounds — while `step` is only the
  input's increment/decrement hint (*Step (UI)*) and never rejects or quantizes a value. The
  generated call node mirrors them as an inline number/checkbox/text editor next to each unwired
  input — exactly like a node-package input — and the emitted call passes that default for an
  unwired parameter.
- **Functions in the node palette** — every enabled function graph appears as an ordinary palette
  node under its own category (and under *Functions* in package order), with one connector per
  declared port; dragging it in creates a call node that the transpiler emits as
  `await <function>(…)`. The entry disappears while the function is disabled and never lists the
  graph being edited.
- **Function input/output nodes** — the Organizational palette section offers *Function Input* and
  *Function Output* nodes for function graphs, mirroring the declared ports on the canvas; each can
  be placed at most once, lands where it is dropped, is skipped by the node clipboard, and uses the
  Material Symbols *input* / *output* glyphs.
- **Graph copy and paste** — the graph tab context menu offers *Copy Graph* and *Paste Graph*, so a
  whole graph can be duplicated into the same or another collection with fresh ids, remapped
  connections and a reset viewport. Function graphs keep their signature and their structural nodes.
- **Placed call nodes follow signature edits** — every call node created from a function graph now
  tracks later changes to that function: reordering, adding, removing or renaming an input or output
  rebuilds the call node's connectors and moves each wire to the port it was attached to, and a wire
  whose port was removed is dropped.
- **Execution-type tab colors** — graph tabs in a collection are tinted by execution type
  (*Startup* blue, *Loop* green, *Interrupt* red, *Event* yellow, *Function* broken white) with soft,
  theme-token-driven fills that keep the active tab readable.
- **Function-node icons** — every function graph now carries a user-selectable MDI icon (default
  `mdi:function`), edited through a picker in the graph settings, rendered as a webfont glyph in the
  call-node header and propagated to every placed call node when it changes.
- **Function-node tint** — generated function call nodes and the structural *Function Input* /
  *Function Output* nodes use the function-graph tab's broken-white color, so the canvas nodes match
  the tab that owns them.
- **Function description and port documentation** — a function graph can now carry a Markdown
  *description* and each declared input/output a Markdown *documentation* string, edited in the graph
  settings through a new reusable `MarkdownEditorControl` (rendered preview plus *Edit*/*Done*) and
  surfaced as the generated node's info text and as each connector's description in the palette's
  node-info window.
- **Markdown and math in the node-info window** — the *Show Info* window (from the palette and the
  graph panel) now renders the general description and every parameter description as Markdown with
  KaTeX math (lazy-loaded on first use), through the same allowlisted, XSS-safe renderer the
  documentation areas use. When the Markdown provider or the KaTeX CDN is unreachable it falls back
  to plain text, so the editor keeps working offline.
- **Content guide on collapsible sections** — `CollapsibleView` gains a general `contentGuide`
  option that draws a vertical line down the leading edge of a section's content, so nested content
  reads as a child of its header. The function parameter rows use it to mirror the Inputs/Outputs
  guide line one level deeper.

## Bug Fixes

- **Function graphs no longer block the upload** — a collection that calls a function graph or
  contains its *Function Input* / *Function Output* nodes now deploys: the pre-upload capability
  check, the node-package gate and the validation that runs inside the deploy skip the app-provided
  `function_graph.*` / `graph.function.*` type ids instead of rejecting the collection with
  `Node type not found`, and the firmware *Minimal* selection no longer demands the phantom
  `graph` / `function_graph` packages.
- **No false "package not installed" badge on function nodes** — the structural *Function Input* /
  *Function Output* nodes and the call nodes generated from function graphs are produced by the app
  itself, so the graph panel no longer reports their intentionally absent runtime definition as an
  uninstalled node package (`graph` / `function_graph`) with a red border and tooltip.
- **Structural nodes follow their port count** — adding or removing a function port now grows or
  shrinks the on-canvas *Function Input* / *Function Output* node immediately: the height pass no
  longer reuses the connector list cached before the signature patch, and the node width is
  re-derived from the same patched connectors.
- **Function graphs run instead of raising `NameError`** — a function graph whose body carries state
  across calls (an *Array Generate* buffer is the common case) transpiled to
  `node_5_out0 = _arr.generate(node_5_out0, …)` without declaring `node_5_out0` global, so Python
  bound it as a body local and the first call failed with `local variable referenced before
  assignment` at start-up. The generated body now declares every name its hoisted init assigned, so
  the state initialized once in `_init__fn_<name>` is the same object the body reads and writes.
- **Compact function parameter headers** — the parameter rows in the *Inputs* / *Outputs* sections
  now use a shorter title bar than the section headers, and a small block-start inset separates the
  first row from the section header it sits under (new general `SplitView.contentInsetTop` option).

## Refactor

- **One execution-type contract** — the execution types, their ordered list and the normalizers now
  live in a single module shared by the graph model, the settings view, the graph toolbar and the
  transpiler, replacing the private copies that could drift apart.
- **Split-based function port editor** — the *Inputs* / *Outputs* lists are now vertical `SplitView`
  containers with one pane per parameter and the add toolbar in a trailing pane, indented under the
  section header through the new general `SplitView.contentInsetStart` option.
- **Graph settings as a split view** — the graph settings pane is now itself a vertical `SplitView`
  of a general-parameter content pane followed by the *Inputs* and *Outputs* sections, which are
  mounted as panes only while a function graph is active. The port lists add the new general
  `SplitView.contentInsetGuide` option, a vertical line in the inset gutter that ties each indented
  parameter row to its section header; the generated-signature preview was removed.
- **Shared MDI icon picker** — the new general `MdiIconPickerControl` view-system component (a
  paged, searchable picker with inline and body portal modes) backs both the function-icon field in
  the graph settings and the node editor's icon control, which was deduplicated onto it and the
  shared MDI glyph helpers (`resolveMdiGlyph`, `mdiGlyphFromCodepoint`, `ensureMdiGlyphFont`).
