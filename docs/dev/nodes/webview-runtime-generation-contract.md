# Webview Runtime Generation Contract

This document defines the strict runtime contract for webview loop-code generation.

## Scope

The contract applies to generated Python runtime code for webview nodes, with first focus on
`joystick-display` loop generation.

## Contract Version

- `webview-runtime/strict-v1`

## Guarantees By Init Completion

Generated `init_webview` setup guarantees the following runtime symbols for generated loop code:

- `_WEBVIEW_PUBLISH_VALUES` is present and callable.
- `_WEBVIEW_CONSUME_VALUES` is bound from `WEB_INTERFACE.consume_webview_values_keys`
  (may be `None` when unavailable; loop code must gate with `callable(...)`).

## Module-Prologue Imports Guaranteed For Strict Loop Generation

Strict loop generation registers these imports in the module prologue:

- `import math as _wv_math`

Loop generation may rely on these imports without emitting per-node dynamic import fallback logic.

## Allowed Loop Assumptions

When `webview-runtime/strict-v1` is in effect, generated loop code may assume:

- Publish/consume symbol names and semantics are stable.
- Helper-owned state stores are initialized and owned by generated/runtime code paths.
- Module-prologue strict imports are available.

## Compatibility Notes

- The contract does not change node definition schemas, payload keys, or hook APIs.
- Any contract revision must increment the contract version string and update tests.

## Number-Input Generation

`web-view-number-input` is the one input control whose generated shape carries bounds. Its
generated pieces are:

- **Init** — the control is constructed with the normalized bounds from the node controls
  (`minValue`, `maxValue`; `step` is reference-only):

  ```python
  node_ctrl = _wv_numinput.DualInputControl(default_value, min_value, max_value)
  ```

  The emitted `default_value` literal is already clamped into `[min_value, max_value]`.

- **Markup** — the generated container and field carry the bounds twice:

  ```html
  <div id="…" class="wv-input-control wv-number-input" data-wv-payload-key="…"
       data-wv-input-kind="number" data-wv-max-digits="6"
       data-wv-min="0" data-wv-max="100" data-wv-step="1">
    <label class="wv-input-label">…</label>
    <input type="number" class="wv-input-field" style="width:6ch"
           min="0" max="100" step="1" value="0" />
  </div>
  ```

- **Client update payload** — element updates may carry `min`, `max` and `step`; the generated
  helper writes them to the input element and to the container `data-wv-*` attributes, and the
  `change` handler clamps a typed value to the active min/max before posting it back to the
  device. A value that is off-step is posted unchanged (clamped only); the browser never snaps it.
