# MDI Icon Picker Control

`js/views/controls/mdi-icon-picker-control.ts` — the reusable searchable Material Design Icons
picker: one labelled text field plus an anchored popover of glyph tiles. The field doubles as the
search filter and as the value (`mdi:<name>`), so hosts never need a second input.

Use it whenever a UI surface needs the user to choose an MDI icon (graph settings, node control
editors, inspectors). Do not hand-roll a second picker surface.

## Options

| Option | Type | Meaning |
|--------|------|---------|
| `label` | string | Visible title left of the field; translated through `t()`. Omitted → title-less compact row. |
| `value` | string | Initial value. Any string is stored verbatim, including foreign sets (`ph:house`). |
| `placeholder` | string | Overrides the default hint (`controls.iconPicker.hint`). |
| `disabled` | boolean | Render disabled and refuse to open. |
| `portal` | `'body' \| 'inline'` | Where the popover lives; default `'body'`. See below. |
| `onChange` | `(value: string) => void \| null` | Called for every committed value (tile click, Clear, Enter, blur commit). |
| `onDismiss` | `() => void \| null` | Called instead of committing when a host-owned session ends (Enter, Escape on a closed grid, focus-out). See *Host-field mode*. |
| `translate` | `(key, params?) => string \| null` | Locale lookup for the picker strings; defaults to the view's i18n service. A host that renders its own field passes its own `t()`. |
| `i18nService` / `logger` | — | Shared `ViewBase` services. |

## Public API

- `render(container)` — builds the wrapper, the field and the popover (attaching the popover to its
  portal), then paints the initial grid.
- `render(container, { input })` — **host-field mode**: adopt a field the host already rendered,
  mount the popover into `container` and wire the keyboard/blur map. The host keeps ownership of
  the field, the value and the commit path.
- `open()` / `close()` — reveal/hide the popover. `open()` starts the lazy index load; rendered
  tiles survive `close()`, so re-opening shows the same page.
- `isOpen` — whether the popover is currently shown; hosts mirror the editor state with it.
- `getValue()` / `setValue(value)` — read/replace the value, e.g. after undo. `setValue` does not
  fire `onChange`.
- `setDisabled(boolean)` — mirrors the flag onto the field and `.mdi-icon-picker--disabled`;
  disabling closes an open popover.
- `onChange(callback)` — register/replace the change callback after construction.
- `detach()` / `beforeDetach()` — removes the popover and every global listener. In host-field mode
  `detach()` only runs `beforeDetach()`: the host's wrapper is the picker's container, so the
  inherited `detach()` must not empty it.

## Behaviour

- **Free text is never rejected.** A value outside the bundled MDI release — or a foreign icon set
  the host already stored — keeps its text and only shows the `controls.iconPicker.unknown` hint.
  Validation must not force an MDI-only rewrite.
- **Lazy index.** The first `open()` calls `preloadMdiIconIndex()`/`loadMdiIconIndex()` from
  `js/data/mdi-icons.ts`; the module caches the promise, so later pickers reuse it. A failed load
  degrades to a plain text field showing `controls.iconPicker.unavailable`.
- **Paged search.** `searchMdiIconPage` ranks names *and* aliases. The status line reads
  `{{shown}} of {{total}} icons`; `Show more` appends the next `MDI_SEARCH_DEFAULT_LIMIT` page, so
  every bundled icon is reachable without rendering thousands of tiles.
- **Tile click** writes `formatIconValue(hit.name)` (`mdi:<name>`), fires `onChange` and keeps the
  popover open so the user can compare glyphs. `Clear` empties the value and also keeps it open.
- **Keyboard.** Arrow keys move the roving-tabindex tile; `Enter` takes the arrow-keyed tile when
  the user actually browsed alternatives, otherwise it commits the typed text; `Escape` closes the
  popover. The handler is attached to the field *and* the popover so `Tab`-reached tiles follow the
  same map.
- **Blur** commits the typed text unless focus moved into the popover (the popover's `mousedown` is
  suppressed to keep the field focused until the click lands).
- **Glyph preview.** The field's right edge shows the resolved glyph of the committed value once the
  index is loaded (`.mdi-icon-picker__preview` inside `.mdi-icon-picker__field`); free text, foreign
  sets and empty values leave it hidden, so the text stays readable. The preview resolves from the
  cached index on re-render without forcing a fetch.

## Host-field mode

When the host already renders its own field — the node editor's `IconControlUi` extends
`TextControlUi`, which owns the input and the live-typing plumbing — call `render(wrapper,
{ input })` with `onChange`/`onDismiss` instead of the self-contained mode:

- The picker adopts the host field as its filter: it adds `role=combobox`, `aria-expanded` and
  `aria-controls`, mounts the popover into the wrapper, and wires focus/click/input/blur/keydown on
  the field.
- The host keeps every value path. A tile click arrives through `onChange` (the picker has already
  written the value into the field); Enter, a second Escape and a focus-out arrive through
  `onDismiss`, and the host decides what committing and closing mean.
- The host removes the field's own blur/keydown handlers (the base `TextControlUi` ones close the
  editor on the first blur/Enter/Escape), keeping only its `input` handler for live value tracking.
- The popover must stay a child of the host wrapper, exactly like the `'inline'` portal: the node
  editor's click-away closes it for any click outside the wrapper.

`IconControlUi` is the reference host: `_mountPicker()` builds the picker with `portal: 'inline'`
and the two callbacks, `_applyValue()` funnels `onChange` into `_notifyChange()`, and
`_handlePickerDismiss()` commits then closes. This is the single grid implementation — the node
editor no longer carries its own copy.

## Portal modes

| Mode | DOM parent | Positioning | Use for |
|------|-----------|-------------|---------|
| `'body'` | `document.body` | `position: fixed`, viewport coordinates from the field; flips above when there is no room below and shifts left at the right edge | Settings panels and dialogs whose host does not close on outside clicks |
| `'inline'` | the control wrapper (`.mdi-icon-picker`) | `position: absolute` against the wrapper | Hosts such as the node editor whose click-away handler closes the owner for any click outside it — an outside click must still hit the owner |

Both modes close on an outside `click` (document capture) and on input blur.

## Styling

The picker surface reuses the existing `.icon-control__*` classes from
`styles/standard/controls/icon-control.css` verbatim — `.icon-control__popover`, `__grid`, `__tile`,
`__glyph`, `__footer`, `__status`, `__more`, `__clear`, `__hint`. Only the host wrapper
(`.mdi-icon-picker`, `__label`, `__field`, `__input`, `__preview`, `--labeled`, `--disabled`) is new.
Do not restyle or duplicate the popover classes.

## Glyph helpers

`js/data/mdi-icons.ts` owns the pure conversion shared by the picker tiles, the canvas icon control
and the node header:

- `mdiGlyphFromCodepoint(codepoint)` — hex string → `String.fromCodePoint`, `''` when unusable.
- `resolveMdiGlyph(value, index)` — `parseIconValue` → MDI set → `resolveMdiIconName` → glyph, or
  `null` while unresolvable (empty value, foreign set, unknown name).

## Tests

`tests/views/mdi-icon-picker-control.test.js` (Node test runner + `tests/helpers/dom-harness.js`,
`resetMdiIconIndexCache()` in `beforeEach` with a stubbed `fetch`) covers render/portal placement,
lazy load, filtering, tile selection + `onChange`, Clear, Show-more paging, keyboard navigation,
free-text blur commit, the degraded state, `setValue`/`setDisabled`, click-away and detach cleanup.
