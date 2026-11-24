# Settings Views Architecture Guide

## Overview

The settings view system provides a hierarchical interface for managing workspace, collection, and graph configuration. It consists of four specialized views that work together using the **CollapsibleView** container pattern.

**Key Components:**

- **GeneralSettingsView** - Workspace-wide settings (theme, language)
- **CollectionSettingsView** - Collection-specific settings (name, runtime, target)
- **GraphSettingsView** - Graph-specific settings (name, execution type, interval)
- **AllSettingsView** - Unified container with collapsible sections

**Location:** `src/micro_otter/nodes/html/ts/views/`

---

## Architecture Diagram

```
AllSettingsView (ViewBase)
├── CollapsibleView (General)
│   └── GeneralSettingsView
├── CollapsibleView (Collection)
│   └── CollectionSettingsView
└── CollapsibleView (Graph)
    └── GraphSettingsView
```

Each section is a **CollapsibleView** that wraps the actual settings view, providing expand/collapse functionality and consistent visual structure.

---

## GeneralSettingsView

**Purpose:** Manage workspace-wide settings that apply to all collections and graphs.

**Storage:** `WorkspaceConfig` in IndexedDB (auto-saved via Workspace)

**Constructor Options:**

```ts
new GeneralSettingsView({
    workspace, // Required: Workspace instance
    i18nService, // Optional: I18n service (defaults to workspace.i18nService)
    title, // Optional: View title (default: 'General Settings')
    icon, // Optional: Icon identifier (default: 'settings')
    id, // Optional: View ID
    logger, // Optional: Logger function
    showTitle, // Optional: Show title header (default: true)
});
```

### Settings Controls

#### Theme Selection

- **Control Type:** Dropdown (`DropdownControl`)
- **Options:** Dynamically loaded from theme registry
- **Current Value:** `workspace.config.theme`
- **Update Method:** `workspace.setTheme(themeId)`
- **I18n Key:** `settings.general.theme.label`

#### Language Selection

- **Control Type:** Dropdown (`DropdownControl`)
- **Options:** Dynamically loaded from I18nService
- **Current Value:** `workspace.config.locale`
- **Update Method:** `workspace.setLocale(locale)`
- **I18n Key:** `settings.general.language.label`

### Event Handling

**Workspace Config Changes:**

```ts
this._unsubscribeWorkspace = this.workspace.onChange((event) => {
    if (event?.name !== 'configChanged') {
        return;
    }

    assertAppEventPayloadType(
        event,
        'Workspace.ConfigChanged.v2',
        'GeneralSettingsView workspace listener'
    );

    if (event.detail.key === 'theme') {
        this._refreshThemeOptions();
    } else if (event.detail.key === 'locale') {
        this._refreshLanguageOptions();
    }
});
```

**Theme Registry Changes:**

```ts
const themeEvents = this.workspace.viewManager?.themeEvents;
themeEvents.addEventListener('themechange', this._onThemeChanged);
```

**Language Changes:**

```ts
this._subscribeToLanguageChanges(() => {
    this._applyLocalizedText();
    this._refreshLanguageOptions();
});
```

---

## CollectionSettingsView

**Purpose:** Manage collection-specific settings including name, runtime, and target device.

**Storage:** `Collection` instance (auto-saved via CollectionManager)

**Constructor Options:**

```ts
new CollectionSettingsView({
    collectionManager, // Required: CollectionManager instance
    i18nService, // Optional: I18n service
    title, // Optional: View title (default: 'Collection Settings')
    icon, // Optional: Icon identifier (default: 'settings')
    id, // Optional: View ID
    logger, // Optional: Logger function
    showTitle, // Optional: Show title header (default: true)
});
```

### Settings Controls

#### Collection Name

- **Control Type:** Text input
- **Current Value:** `collection.title`
- **Update Method:** `collection.setTitle(name)`
- **Validation:** Non-empty, reasonable length
- **I18n Key:** `settings.collection.name.label`

#### Runtime Selection

- **Control Type:** Dropdown (`DropdownControl`)
- **Options:** Available Micro-Otter runtimes (e.g., "general")
- **Current Value:** `collection.deviceRuntimeId`
- **Update Method:** `collection.setDeviceRuntimeId(runtimeId)`
- **I18n Key:** `settings.collection.runtime.label`

#### Target Device

- **Control Type:** Dropdown (`DropdownControl`)
- **Options:** Compatible targets for selected runtime
- **Current Value:** `collection.targetId`
- **Update Method:** `collection.setTargetId(targetId)`
- **Validation:** Must be compatible with selected runtime
- **I18n Key:** `settings.collection.target.label`

#### Collection Version

- **Control Type:** Read-only label
- **Display Value:** `collection.versionString`
- **Purpose:** Show current version and dirty flag
- **I18n Key:** `settings.collection.version.label`

### Context Management

**Setting Active Collection:**

```ts
setCollection(collection) {
    if (this._collection === collection) {
        return; // No change
    }

    // Unsubscribe from old collection
    this._unsubscribeCollection?.();

    this._collection = collection;

    if (!collection) {
        this._clearControls();
        return;
    }

    // Subscribe to new collection events
    this._unsubscribeCollection = collection.on('change', (event) => {
        this._handleCollectionChange(event);
    });

    this._refreshAllControls();
}
```

### Event Handling

**Collection Changes:**

```ts
this._unsubscribeCollection = collection.on('change', (event) => {
    switch (event.type) {
        case 'titleChanged':
            this._refreshNameControl();
            break;
        case 'targetIdChanged':
            this._refreshTargetControl();
            break;
        case 'deviceRuntimeIdChanged':
            this._refreshRuntimeControl();
            break;
        case 'versionChanged':
            this._refreshVersionDisplay();
            break;
    }
});
```

---

## GraphSettingsView

**Purpose:** Manage graph-specific settings including execution behavior and timing.

**Storage:** `NodeGraph` instance (auto-saved via CollectionManager)

**Constructor Options:**

```ts
new GraphSettingsView({
    collectionManager, // Required: CollectionManager instance
    i18nService, // Optional: I18n service
    title, // Optional: View title (default: 'Graph Settings')
    icon, // Optional: Icon identifier (default: 'settings')
    id, // Optional: View ID
    logger, // Optional: Logger function
    showTitle, // Optional: Show title header (default: true)
});
```

### Settings Controls

#### Enabled

- **Control Type:** Checkbox (`CheckboxControl`), rendered **first** in the form as the graph's
  top-level on/off switch (inside the leading `view-graph-settings__group`)
- **Current Value:** `graph.getEnabled()` (normalized with `normalizeGraphEnabled()`)
- **Update Method:** `graph.setEnabled(boolean)`
- **Effect:** a disabled graph stays in the collection but is excluded from transpilation
- **Disabled when:** no graph is bound, or the bound graph does not expose `getEnabled()`
- **I18n Key:** `settings.graph.enabled.label`
- **Mirroring:** the graph-tab context menu hosts the same flag (not the panel toolbar); both
  surfaces write through `NodeGraph` and follow the `enabled` event (`NodeGraph.EnabledChanged.v1`).
  Neither view calls the other.

#### Graph Name

- **Control Type:** Text input
- **Current Value:** `graph.name`
- **Update Method:** `graph.setName(name)`
- **Validation:** Non-empty, reasonable length
- **I18n Key:** `settings.graph.name.label`

#### Execution Type

- **Control Type:** Dropdown (`DropdownControl`)
- **Options:**
    - `startup` - "Run once on startup"
    - `continuous` - "Run continuously in loop"
    - `irq` - "Run once per interrupt"
    - `event` - "Run on signal"
- **Current Value:** `graph.getExecutionType()`
- **Update Method:** `graph.setExecutionType(type)`
- **Default:** `DEFAULT_EXECUTION_TYPE` (`continuous`)
- **I18n Keys:**
    - `settings.graph.executionType.label`
    - `settings.graph.executionType.startup`
    - `settings.graph.executionType.continuous`

#### Interval (ms) (Conditional)

- **Control Type:** Number input
- **Visibility:** Only shown when execution type is `continuous`
- **Current Value:** `graph.getTriggerInterval()` (milliseconds)
- **Update Method:** `graph.setTriggerInterval(ms)`
- **Validation:** Whole number `0–60000` ms via `clampSleepDuration()`; `0` is valid (yield-only
  cadence); a blank field never writes and the control is restored from the graph
- **Default:** `DEFAULT_SLEEP_MS` (`500`) in the control; the `NodeGraph` default interval is 500 ms;
  the input renders `min="0"` and `step="1"`
- **I18n Keys:**
    - `settings.graph.sleepDuration.label`
    - `settings.graph.sleepDuration.description`

The key name is historical: the visible copy is "Interval (ms)" in English and "Intervall (ms)" in
German, and the description explains that the value is the time between iteration starts and that `0`
yields without waiting.

#### Signals (Conditional)

- **Control Type:** Checkbox multi-select dropdown — the reusable `DropdownControl` from
  `js/views/controls/dropdown-control.ts`, attached with `multiSelect: true`, `showIcons: false`,
  `showBulkActions: false`, `menuClassName: 'view-graph-settings__signal-menu'`, the
  `settings.graph.signals.listLabel` placeholder and its own `label`
  (`settings.graph.signals.label`), mounted in the `.view-graph-settings__signal-control` host inside
  the signals group. The row title is the control's own title — the control renders it as
  `.dropdown-control__label` (adding `dropdown-control--labeled`) and associates it with the trigger
  through `aria-labelledby`, so there is no `.view-graph-settings__label` caption above the picker.
  `_applyLocalizedText()` refreshes that title in place with
  `setLabel(this.t('settings.graph.signals.label'))` before `setValue(...)`, so a language change
  needs no rebuild.
- **Visibility:** Only shown when the execution type is `event`
- **Options:** `collectSignalNames(collection, graph)` from `js/nodes/signal-names.ts` — every
  non-empty `signal` / `customSignal` value on the collection's `signal-post` nodes, de-duplicated
  and sorted with `localeCompare`; the graph's currently selected names are added to that set so a
  stale selection stays offered and ticked
- **Current Value:** `graph.getSignalNames()` (normalized with `normalizeSignalNames()`)
- **Update Method:** `graph.setSignalNames(names)` — only when the selection actually changed
- **Refresh:** rebuilds the options on `node-added` / `node-removed` (`NodeGraph.NodeAdded.v1` /
  `NodeGraph.NodeRemoved.v1`) and on `node-updated` (`NodeGraph.NodeUpdated.v1`) when
  `detail.patch.controlValues` carries `signal` or `customSignal`. The view caches the rendered
  option values and calls `setOptions()` only when the list changed, so an open menu keeps its state
  across a multi-select click.
- **No name creation:** the view never adds names; a signal name exists only on a `signal-post` node
- **Message line:** `settings.graph.signals.emptyError` for an empty selection,
  `settings.graph.signals.unknownProducer` when a ticked name has no producer, otherwise
  `settings.graph.signals.description`
- **I18n Keys:**
    - `settings.graph.signals.label`
    - `settings.graph.signals.listLabel`
    - `settings.graph.signals.description`
    - `settings.graph.signals.emptyError`
    - `settings.graph.signals.unknownProducer`

#### Trigger Mode (Conditional)

- **Control Type:** Dropdown (`DropdownControl` from `controls/custom-runtime-controls.ts`)
- **Visibility:** Only shown when the execution type is `event`
- **Options:** `any` ("Any") and `all` ("All")
- **Current Value:** `graph.getSignalMode()` (normalized with `normalizeSignalMode()`)
- **Update Method:** `graph.setSignalMode(mode)`
- **I18n Keys:** `settings.graph.signals.mode.label`, `settings.graph.signals.mode.any`,
  `settings.graph.signals.mode.all`

#### Run On Start (Conditional)

- **Control Type:** Checkbox (`CheckboxControl`)
- **Visibility:** Only shown when the execution type is `event`
- **Current Value:** `graph.getRunOnStart()` — `true` unless the graph stores `false` (or its string
  form), so legacy graphs keep running once at startup
- **Update Method:** `graph.setRunOnStart(boolean)`
- **I18n Keys:** `settings.graph.signals.runOnStart.label`,
  `settings.graph.signals.runOnStart.description`

The signal normalization rules (`normalizeSignalNames()`, `normalizeSignalMode()`,
`DEFAULT_SIGNAL_MODE`, `MAX_SIGNAL_COUNT`, `MAX_SIGNAL_NAME_LENGTH`) live in
`js/data/graph-execution-settings.ts`, next to the execution-type helpers, so the settings view, the
graph panel toolbar and the generated Python agree on the same names.

### Conditional Visibility

`EXECUTION_FIELD_VISIBILITY` in `graph-settings-view.ts` decides which group each execution type
shows; the interval group follows `sleep`, the interrupt group `trigger`, and the signals, trigger
mode and run-on-start groups all follow `signals`:

```ts
const EXECUTION_FIELD_VISIBILITY: Record<ExecutionType, readonly string[]> = {
    startup: [],
    continuous: ['sleep'],
    irq: ['trigger'],
    event: ['signals'],
    function: ['functionPorts'],
};
```

Each `_update*Visibility(executionType)` helper toggles its groups' `style.display` from that map, so
adding a new execution type only needs one map entry plus its locale labels.

#### Function block

A `function` graph turns the graph settings pane into a vertical `SplitView` of three panes: a
leading content pane with the general parameters, then the **Inputs** and **Outputs** sections. The
section panes are only mounted while a supported function graph is active, so every other execution
type shows just the content pane and the following fields keep their positions. The block is built
from shared view-system components:

- the **category** row is a `TextControl` (the same row shape as the graph name) writing
  `graph.setFunctionCategory()`; it lives in the general content pane, right after the execution-type
  row, and is hidden for every other execution type;
- the **icon** row is the reusable `MdiIconPickerControl` (`js/views/controls/mdi-icon-picker-control.ts`,
  `portal: 'body'`), seeded with `DEFAULT_FUNCTION_ICON` and wired through `graph.getFunctionIcon()` /
  `graph.setFunctionIcon()`. It renders as a plain `view-graph-settings__group` row immediately after
  the category row and is hidden together with it for other execution types. `onChange` fires only
  for user commits; external refreshes call `setValue()`, and a `functionSignature` event from
  another surface re-syncs the field;
- the **description** row is the reusable `MarkdownEditorControl`
  (`js/views/controls/markdown-editor-control.ts`), a `view-graph-settings__group` row right after the
  icon row, wired through `graph.getFunctionDescription()` / `graph.setFunctionDescription()`. It
  shows an allowlisted rendered preview (via `renderAreaMarkdown()`) with an **Edit** button that
  swaps in a `<textarea>` + **Done**; commit on Done/blur/Ctrl/Cmd+Enter, Escape cancels. Hidden
  together with the category/icon rows for other execution types;
- **Inputs** and **Outputs** are the second and third panes of the settings split, each a
  `CollapsibleView` (`sizeToContent`, a `ContentView` body). Each body holds a vertical `SplitView`
  with one pane per parameter `CollapsibleView` and a trailing pane for the icon-only add
  `ButtonControl` in a `ToolbarView`; an empty list shows its empty-state line in its own pane above
  that toolbar. The port-list split passes `contentInsetStart`, so the panes sit indented under the
  section header, `contentInsetTop`, which separates the first pane from that header, and
  `contentInsetGuide`, which draws a vertical line in the inset gutter to tie the rows to the
  section above; `graph-settings-view.css` sizes both splits' panes to their content (the settings
  live in the scrolling settings sheet) instead of sharing a fixed host height;
- a **port row** is a nested `CollapsibleView` pane with a compact `headerHeight` (shorter than the
  section header) whose body holds a `ToolbarView` (move up, move down, delete) plus a `TextControl`
  for the name and the multi-select `DropdownControl` for the data types, whose options come from
  `collection.getAllDataTypes()` and are labelled through `resolveLocalizedName()`. **Input rows**
  additionally hold a default-type `DropdownControl` (hidden for single-type ports), a default value
  editor (`NumberControl`/`CheckboxControl`/`TextControl`, re-rendered in place when the type
  changes), and Min/Max/Step (UI) `TextControl`s shown only for numeric defaults; the value editor
  clamps a typed number into `min`/`max` and snaps its text to the stored value on blur, while
  `step` is only an increment hint. Output rows keep the name/type fields alone. Every row (input and
  output) also holds a `MarkdownEditorControl` for the port's Markdown documentation, writing
  `updateFunctionPort(kind, portId, { documentation })`, appended after the name/type fields (and after
  the input-only default fields).

The block drives the phase-2 graph API (`addFunctionPort`, `updateFunctionPort`,
`removeFunctionPort`, `moveFunctionPort`, `setFunctionCategory`, `getFunctionIcon`,
`setFunctionIcon`) and never mutates the signature
itself: invalid names are reported inline and never written, and in-form edits refresh row titles,
type values and hints without recreating the control the user is typing in. See
[nodes/function-graphs.md](../nodes/function-graphs.md) for the model and transpiler contract.

### Shared Execution Settings Module

The execution-type values, the sleep bounds and the normalization rules live in
`js/data/graph-execution-settings.ts`, which both this view and the graph panel toolbar import:

```ts
export type ExecutionType = 'startup' | 'continuous' | 'irq' | 'event';
export const GRAPH_EXECUTION_TYPES: readonly ExecutionType[]; // ['startup', 'continuous', 'irq', 'event']
export const DEFAULT_EXECUTION_TYPE: ExecutionType; // 'continuous'
export const DEFAULT_GRAPH_ENABLED = true;
export const MIN_SLEEP_MS = 0;
export const DEFAULT_SLEEP_MS = 500;
export const MAX_SLEEP_MS = 60000;
export function normalizeExecutionType(value: unknown): ExecutionType;
export function normalizeGraphEnabled(value: unknown): boolean;
export function clampSleepDuration(value: unknown): number;
```

`normalizeGraphEnabled()` returns `false` only for the literal boolean `false` (and the string
`'false'`); everything else — including a missing key from a legacy collection — yields
`DEFAULT_GRAPH_ENABLED`, so existing collections keep transpiling.

`normalizeExecutionType()` accepts case-insensitive/whitespace-padded strings and falls back to
`continuous` for anything unknown, so neither surface can render an invalid selection.
`clampSleepDuration()` floors the value and clamps it into `MIN_SLEEP_MS … MAX_SLEEP_MS`, so `0`
survives as a valid interval. Blank strings, whitespace-only strings, `null`, `undefined`,
non-numeric strings and other non-number/non-string values fall back to `DEFAULT_SLEEP_MS` (`500`),
never to `0`; a negative number clamps to `0`.

### Second Surface: Graph Panel Toolbar

The execution type and interval are editable from the toolbar of the graph panel
(`GraphPanelView`, see [GraphPanelView Architecture](graph-panel-view-architecture.md#panel-toolbar)):

- **Toolbar → model:** the dropdown calls `graph.setExecutionType(...)`, the interval input commits
  on `change`/`blur` through `graph.setTriggerInterval(...)`.
- **Model → both views:** `NodeGraph` emits `executionType` / `interval`; this view reacts through
  its `graph.on('*')` subscription, the toolbar through `_syncToolbarControls()`.

The **enabled** flag is not in the panel toolbar. It is editable from the graph-tab context menu
(`collection.tabContextMenu.enabled`), which calls `graph.setEnabled()`; `GraphPanelView` follows the
same `enabled` event and repaints its canvas.

No other wiring exists between the views — the `NodeGraph` mutators normalize and persist the
values (autosave), and every surface simply renders the resulting events. The settings view keeps
its longer labels (`settings.graph.*`), the toolbar has its own shorter namespace
(`graph.toolbar.*`) because horizontal space is tight: its dropdown renders without a visible
title (the label doubles as the `aria-label` of the `<select>`) and its options read
`Startup` / `Loop`.

### Context Management

**Setting Active Graph:**

```ts
setGraph(graph) {
    if (this._graph === graph) {
        return; // No change
    }

    // Unsubscribe from old graph
    this._unsubscribeGraph?.();

    this._graph = graph;

    if (!graph) {
        this._clearControls();
        return;
    }

    // Subscribe to new graph events
    this._unsubscribeGraph = graph.on('change', (event) => {
        this._handleGraphChange(event);
    });

    this._refreshAllControls();
}
```

---

## AllSettingsView

**Purpose:** Provide a unified settings interface with collapsible sections.

**Layout:** Vertical stack of three **CollapsibleView** containers

**Constructor Options:**

```ts
new AllSettingsView({
    workspace, // Required: Workspace instance
    collectionManager, // Required: CollectionManager instance
    i18nService, // Optional: I18n service
    title, // Optional: View title (default: 'Settings')
    icon, // Optional: Icon identifier (default: 'settings')
    id, // Optional: View ID
    logger, // Optional: Logger function
});
```

### Layout Structure

```
┌─────────────────────────────────────┐
│ ▶ General Settings                  │  ← CollapsibleView (collapsed)
├─────────────────────────────────────┤
│ ▼ Collection Settings               │  ← CollapsibleView (expanded)
├─────────────────────────────────────┤
│   Collection Name: [My Project   ]  │
│   Runtime:        [General ▼]       │  ← Content area
│   Target Device:  [ESP32-S3 ▼]      │
│   Version:        1.0.0              │
├─────────────────────────────────────┤
│ ▼ Graph Settings                    │  ← CollapsibleView (expanded)
├─────────────────────────────────────┤
│   Graph Name:     [Main Loop    ]   │
│   Execution Type: [Continuous ▼]    │  ← Content area
│   Interval:       [1000] ms         │
└─────────────────────────────────────┘
```

### Child View Creation

The AllSettingsView creates three CollapsibleView instances, each wrapping a settings view:

```ts
// General settings section
const generalCollapsible = new CollapsibleView({
    headerTitle: this.t('settings.section.general'),
    collapsed: false,
    contentView: this._generalSettingsView,
    sizeToContent: true,
    i18nService: this._i18nService,
});

// Collection settings section
const collectionCollapsible = new CollapsibleView({
    headerTitle: this.t('settings.section.collection'),
    collapsed: false,
    contentView: this._collectionSettingsView,
    sizeToContent: true,
    i18nService: this._i18nService,
});

// Graph settings section
const graphCollapsible = new CollapsibleView({
    headerTitle: this.t('settings.section.graph'),
    collapsed: false,
    contentView: this._graphSettingsView,
    sizeToContent: true,
    i18nService: this._i18nService,
});
```

### Header Interaction

Because the three sections are **direct** `SplitView` panes, each header renders the solo button
next to its title, and clicking anywhere on a header toggles that section. The solo button
(`collapsibleView.solo`) asks the hosting `SplitView` to expand that section and collapse the other
two; the host drives the collapse through `CollapsibleView.isCollapsible` and the public
`collapse()`/`expand()` methods, so the sections keep their own `sizeToContent` caps afterwards.
Sections that are not collapsible panes (nested containers, `TabbedView` panes) are unaffected.

### Content-height Sizing

All three sections set `sizeToContent: true`. Each collapsible measures its rendered header and the
natural height of its settings root, then publishes
`ceil(header + content + content box padding + 2px pane border)` as the pane's `maxHeight`. The
content box padding of `.collapsible-view__content` is zero for these panels, so the cap is the
header plus the settings root. `SplitView` caps the pane at that value. When the three measured
heights fit in the available vertical space, the panes use only their content height and the
leftover space remains unused.

`SplitView` keeps its ratios normalized to one but converts them into CSS flex factors by dividing
them by the smallest positive ratio (`_flexGrowScale()`), so the factors are expressed in units of
the smallest pane and every pane weighs at least one. That matters because CSS distributes the space
released by frozen (content-capped) panes only in proportion to the factors of the panes that are
still unfrozen, and hands out just `sum × free space` when that subset sums to less than one: with
bare normalized ratios the last uncapped pane received only its own fraction of the released space
and the rest stayed empty below the panes. The transparent filler receives the residual ratio in the
same units, so it still absorbs only the unused space and cannot compete with the capped panes during
flex normalization. When the panes do not fit, they stay capped and each `.collapsible-view__content`
scrolls vertically.

`SETTINGS_MIN_PANE_HEIGHT = 72` remains the `SplitView` fallback floor used when a child does not
report its own minimum. The collapsible sections report `minHeight = 28` (their header height), so
that header minimum is the effective pane floor for these panels.

### Context Forwarding

AllSettingsView listens for active collection/graph changes and forwards them:

```ts
afterAttach() {
    super.afterAttach();

    // Forward active collection changes
    this._unsubscribeCollectionManager = this._collectionManager.onChange((event) => {
        if (event.name !== 'activeCollectionChanged') {
            return;
        }

        assertAppEventPayloadType(
            event,
            'CollectionManager.ActiveCollectionChanged.v2',
            'AllSettingsView collection manager listener'
        );

        const activeCollection = this._collectionManager.getActiveCollection();
        this._collectionSettingsView.setCollection(activeCollection);
        this._graphSettingsView.setGraph(activeCollection?.getActiveGraph?.() || null);
    });

    // Initialize with current active collection/graph
    const activeCollection = this._collectionManager.getActiveCollection();
    this._collectionSettingsView.setCollection(activeCollection);

    this._graphSettingsView.setGraph(activeCollection?.getActiveGraph?.() || null);
}
```

### Serialization

AllSettingsView serializes the collapsed state of each section:

```ts
serialize() {
    const base = super.serialize();
    return {
        ...base,
        collapsedStates: {
            general: this._generalCollapsible.collapsed,
            collection: this._collectionCollapsible.collapsed,
            graph: this._graphCollapsible.collapsed,
        },
    };
}

static deserialize(data, viewFactory, context) {
    const view = new AllSettingsView({
        workspace: context.workspace,
        collectionManager: context.collectionManager,
        i18nService: context.i18nService,
        title: data.title,
        icon: data.icon,
        id: data.id,
    });

    // Restore collapsed states after render
    const states = data.collapsedStates || {};
    if (states.general !== undefined) {
        view._generalCollapsible.collapsed = states.general;
    }
    if (states.collection !== undefined) {
        view._collectionCollapsible.collapsed = states.collection;
    }
    if (states.graph !== undefined) {
        view._graphCollapsible.collapsed = states.graph;
    }

    return view;
}
```

---

## CollapsibleView Container

**Purpose:** Provide a consistent collapsible section UI for settings panels.

**Features:**

1. **Header with Toggle Button** - Chevron icon that rotates on expand/collapse
2. **Content Panel** - Hosts any ViewBase-derived view
3. **Height Management** - Automatically adjusts constraints when collapsed
4. **State Persistence** - Serializes collapsed state

### Usage Pattern

```ts
const collapsible = new CollapsibleView({
    headerTitle: 'My Section',
    collapsed: false,
    contentView: mySettingsView,
    i18nService: i18nService,
});

// Programmatically toggle
collapsible.collapsed = true; // Collapse
collapsible.collapsed = false; // Expand

// Change content view
collapsible.contentView = differentView;

// Update header title
collapsible.headerTitle = 'New Title';
```

### Height Constraints

When collapsed, CollapsibleView sets maximum height to header height:

```ts
_updateCollapsedState() {
    if (this._collapsed) {
        // Collapsed: hide content, set max height to header height
        this.setMaxHeight(this._headerHeight);
        if (this._contentContainer) {
            this._contentContainer.style.display = 'none';
        }
    } else {
        // Expanded: show content, remove max height
        this.setMaxHeight(null);
        if (this._contentContainer) {
            this._contentContainer.style.display = '';
        }
    }

    this._updateToggleIcon();
}
```

This integrates with SplitView to automatically resize sections when collapsed/expanded.

---

## I18n Integration

All settings views support internationalization through the I18nService.

### Translation Keys

**General Settings:**

```
settings.general.title
settings.general.theme.label
settings.general.theme.description
settings.general.language.label
settings.general.language.description
```

**Collection Settings:**

```
settings.collection.title
settings.collection.name.label
settings.collection.runtime.label
settings.collection.runtime.description
settings.collection.target.label
settings.collection.target.description
settings.collection.version.label
```

**Graph Settings:**

```
settings.graph.title
settings.graph.name.label
settings.graph.executionType.label
settings.graph.executionType.startup
settings.graph.executionType.continuous
settings.graph.sleepDuration.label
settings.graph.sleepDuration.description
```

**Graph Panel Toolbar:**

```
graph.toolbar.alignToGrid
graph.toolbar.alignToGridUndo
graph.toolbar.executionType.label
graph.toolbar.executionType.startup
graph.toolbar.executionType.loop
graph.toolbar.sleepDuration.label
```

The toolbar deliberately uses a shorter wording than `settings.graph.*` because it shares a 36 px
row with the align button: the dropdown has no rendered title (`executionType.label` becomes the
`aria-label` of the `<select>`) and its options read `Startup` / `Loop` instead of the full
sentences of the settings view. The `graph.toolbar` key set must stay identical in `en.json` and
`de.json` — a parity test in
`tests/views/graph-panel-toolbar.test.js` enforces this.

**Graph Tab Context Menu:**

```
collection.tabContextMenu.rename
collection.tabContextMenu.enabled
menu.item.deleteGraph
```

**Section Headers:**

```
settings.all.title
settings.section.general
settings.section.collection
settings.section.graph
```

### Dynamic Updates

All views re-render when language changes:

```ts
afterAttach() {
    super.afterAttach();

    this._subscribeToLanguageChanges(() => {
        this._applyLocalizedText(); // Update all labels and descriptions
        this._refreshControls();     // Re-populate dropdowns with translated options
    });
}
```

---

## CSS Styling

**Stylesheet:** `src/micro_otter/nodes/html/css/views/settings.css`

**Class Naming Convention:**

- `view-general-settings` - GeneralSettingsView root
- `view-collection-settings` - CollectionSettingsView root
- `view-graph-settings` - GraphSettingsView root
- `view-all-settings` - AllSettingsView root

**Common Patterns:**

```css
/* Section containers */
.view-general-settings,
.view-collection-settings,
.view-graph-settings {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-md);
    padding: var(--spacing-md);
}

/* Control groups */
.view-general-settings__group,
.view-collection-settings__group,
.view-graph-settings__group {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-sm);
}

/* Labels */
.view-general-settings__label,
.view-collection-settings__label,
.view-graph-settings__label {
    font-weight: 500;
    color: var(--color-text-primary);
}

/* Form controls */
.view-general-settings__select,
.view-general-settings__input,
.view-collection-settings__select,
.view-collection-settings__input,
.view-graph-settings__select,
.view-graph-settings__input {
    min-width: 200px;
    max-width: 400px;
}
```

---

## Integration with ViewManager

### Registration

AllSettingsView must be registered with ViewManager for serialization:

```ts
viewManager.registerViewType('AllSettingsView', AllSettingsView);
```

### Tab View Integration

Add AllSettingsView to the right tabbed view (second tab from top):

```ts
const settingsView = new AllSettingsView({
    workspace: this.workspace,
    collectionManager: this.collectionManager,
    i18nService: this.i18nService,
    title: 'Settings',
    icon: 'settings',
});

rightTabbedView.addTab({
    view: settingsView,
    closeable: false, // Keep settings tab always available
});
```

---

## Testing Strategy

### Unit Tests

**File:** `tests/views/settings/all-settings-view.test.js`

**Test Cases:**

1. **Creation and Initialization**
    - Creates all three child views
    - Creates three CollapsibleView wrappers
    - Sets up event listeners

2. **Context Forwarding**
    - Active collection change forwards to CollectionSettingsView
    - Active graph change forwards to GraphSettingsView

3. **Serialization**
    - Saves collapsed states
    - Restores collapsed states on deserialize

4. **Language Changes**
    - Section titles update when language changes
    - Child views receive language change notifications

### Integration Tests

**File:** `tests/views/settings/settings-integration.test.js`

**Test Cases:**

1. **End-to-End Settings Flow**
    - Change theme → workspace config updates → UI reflects change
    - Change collection name → collection updates → version increments
    - Change execution type → graph updates → interval visibility toggles

2. **Context Switching**
    - Switch active collection → settings update to new collection
    - Switch active graph → settings update to new graph
    - Delete active collection → settings show empty state

3. **Persistence**
    - Change settings → serialize → deserialize → verify state restored
    - Collapse sections → reload → verify collapsed state persists

---

## Best Practices

### 1. **Use Public APIs Only**

Never access private fields of data models. Always use public getters/setters:

```ts
// ✅ CORRECT
const name = collection.title;
collection.setTitle('New Name');

// ❌ WRONG
const name = collection._title;
collection._title = 'New Name';
```

### 2. **Subscribe and Unsubscribe Properly**

Always clean up event listeners in `beforeDetach()`:

```ts
afterAttach() {
    this._unsubscribe = collection.on('change', this._handleChange);
}

beforeDetach() {
    this._unsubscribe?.();
    this._unsubscribe = null;
    super.beforeDetach();
}
```

### 3. **Handle Null Context Gracefully**

Settings views should handle missing collection/graph context:

```ts
setCollection(collection) {
    this._collection = collection;

    if (!collection) {
        this._clearControls();
        this._disableControls();
        return;
    }

    this._enableControls();
    this._refreshControls();
}
```

### 4. **Validate User Input**

Always validate before updating data models:

```ts
_handleNameChange(event) {
    const newName = event.target.value.trim();

    if (!newName) {
        this._showError('Name cannot be empty');
        return;
    }

    if (newName.length > 100) {
        this._showError('Name too long');
        return;
    }

    this._collection.setTitle(newName);
}
```

### 5. **Debounce Rapid Changes**

For text inputs, debounce to avoid excessive saves:

```ts
_handleNameInput(event) {
    clearTimeout(this._nameInputTimeout);

    this._nameInputTimeout = setTimeout(() => {
        this._updateCollectionName(event.target.value);
    }, 500); // 500ms debounce
}
```

---

## Related Documentation

- **[view-system-architecture.md](view-system-architecture.md)** - ViewBase lifecycle and event handling
- **[collapsible-view.md](collapsible-view.md)** - CollapsibleView container documentation
- **[i18n-architecture.md](../core/i18n-architecture.md)** - Internationalization system
- **[data-backbone-architecture.md](../core/data-backbone-architecture.md)** - Collection and NodeGraph APIs
- **[coding-style-guide.md](../guides/coding-style-guide.md)** - Encapsulation and naming conventions
