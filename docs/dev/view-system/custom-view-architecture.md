# Custom View Architecture

**Location**: `view-system/custom-view-architecture.md`  
**Status**: Active  
**Last Updated**: 2026-04-02

## Overview

Custom views provide runtime-specific configuration and control interfaces for deployed device firmware. They use a declarative JSON format combined with Python backend functions to create interactive settings panels without writing view code.

### Key Components

1. **JSON View Definition** - Declarative UI structure with sections and controls
2. **CustomViewRenderer** - Transforms JSON to interactive DOM elements
3. **Control Types** - Text, number, dropdown, checkbox, and button inputs
4. **Device Functions** - Python functions callable from the UI with parameter passing
5. **Response Protocol** - Structured JSON responses for control updates

---

## Architecture Layers

```
┌─────────────────────────────────────────────────────────┐
│  Custom View JSON Definition                            │
│  (device/runtime/{runtime_id}/custom_view.json)         │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│  CustomViewRenderer                                      │
│  - Parses JSON definition                               │
│  - Creates control instances                            │
│  - Manages parameter substitution                       │
│  - Delegates function execution to DeviceConnection     │
│  - Handles responses (updateControls/showMessage)       │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│  Control Classes                                         │
│  TextControl, NumberControl, DropdownControl, etc.      │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│  DeviceConnection                                        │
│  - Executes Python code on device via Web Serial        │
│  - Returns stdout output as result string               │
│  - Custom view boundary: executeCustomViewAction(...)   │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│  Device-Side Python Functions                           │
│  (device/runtime/{runtime_id}/app/custom_settings.py)   │
│  - Perform hardware operations                          │
│  - Return JSON strings with structured data             │
└─────────────────────────────────────────────────────────┘
```

---

## JSON View Definition

### File Location

```
src/micro_otter/nodes/device/runtime/{runtime_id}/custom_view.json
```

### Schema Structure

```json
{
  "$schema": "https://micro-otter.dev/schemas/custom-view-v1.json",
  "version": "1.0.0",
  "title": "i18n.key.title",
  "description": "i18n.key.description",
  "toolbar": {
    "controls": [
      {
        "id": "runtime_upload",
        "type": "button",
        "label": "i18n.key.upload",
        "icon": "upload"
      }
    ]
  },
  "setup": {
    "onError": {
      "message": "i18n.key.setupError"
    },
    "calls": [
      {
        "name": "read_wifi_settings",
        "parameters": [],
        "mapping": {
          "sta_ssid": "wifi_sta_ssid",
          "ap_ssid": "wifi_ap_ssid"
        }
      }
    ]
  },
  "sections": [
    {
      "id": "section_id",
      "title": "i18n.key.sectionTitle",
      "collapsible": true,
      "collapsed": false,
      "controls": [ /* control definitions */ ]
    }
  ]
}
```

### Supported Declaration Model (Current)

Current runtime custom views use a function-based execution model.

- Setup-time calls are declared in `setup.calls[]` using function `name` + `parameters` + optional `mapping`.
- Interactive actions are declared in `controls[].function` (or `toolbar.controls[].function`) using function `name` + `parameters` and success/error handlers.
- First-class script declarations are not part of the current custom view JSON contract.

This document describes the currently implemented model and should remain aligned with runtime definitions under `device/runtime/*/custom_view.json`.

### Execution Boundary Contract (Phase 11)

- Custom runtime function/script execution must flow through `DeviceConnection.executeCustomViewAction(...)`.
- `CustomViewRenderer` is not allowed to execute runtime actions directly (for example, no `executeCode(...)` fallback path).
- If the boundary API is unavailable, renderer execution must fail with an explicit contract error rather than degrading to a legacy direct-execution path.

### Setup Section (Optional)

The top-level `setup` section runs one or more device functions before controls are rendered.

| Property | Type | Description |
| --- | --- | --- |
| `onError.message` | string | I18n key shown if any setup call fails |
| `calls` | array | Ordered setup function calls (executed sequentially) |
| `calls[].name` | string | Python function name in `app.custom_settings` |
| `calls[].parameters` | array | Function parameters (same rules as button functions) |
| `calls[].mapping` | object | Maps result keys to control IDs for initial values |

**Behavior contract**:
- Setup executes in order (fail-fast).
- While setup runs, runtime view shows a wait display.
- If any setup call fails (`success: false` or execution error), runtime view shows setup error and suppresses controls.
- On success, setup mappings initialize control values before controls are interactive.
- After setup succeeds and controls render, all dirty flags are reset to the setup-loaded baseline.

### Toolbar Section (Optional)

The top-level `toolbar` section renders controls using the view-system `ToolbarView`.

| Property | Type | Description |
| --- | --- | --- |
| `controls` | array | Ordered toolbar items (`button` or `separator`) |
| `controls[].id` | string | Unique control identifier |
| `controls[].type` | string | `button` or `separator` |
| `controls[].label` | string | I18n key for button label |
| `controls[].icon` | string | Icon name from `IconProvider` (or direct asset path) |
| `controls[].function` | object | Optional function execution config (same as normal button controls) |
| `controls[].enableOnDirty` | array | Optional list of control IDs that enable this button when dirty |
| `controls[].disableOnDirty` | array | Optional list of control IDs that disable this button when dirty |
| `controls[].clearDirty` | array | Optional list of control IDs whose dirty flags are cleared on successful click |

`clearDirty` applies to button controls only.

### Setup Example: General Runtime Initialization

Use `setup` to initialize control values for WiFi and webserver settings before rendering controls:

```json
{
  "setup": {
    "onError": {
      "message": "customRuntimeView.setup.error"
    },
    "calls": [
      {
        "name": "read_wifi_settings",
        "parameters": [],
        "mapping": {
          "sta_enabled": "wifi_sta_enabled",
          "sta_ssid": "wifi_sta_ssid",
          "sta_password": "wifi_sta_password",
          "ap_enabled": "wifi_ap_enabled",
          "ap_ssid": "wifi_ap_ssid",
          "ap_password": "wifi_ap_password"
        }
      },
      {
        "name": "read_webserver_settings",
        "parameters": [],
        "mapping": {
          "enable": "webserver_enable",
          "port": "webserver_port"
        }
      }
    ]
  }
}
```

This setup sequence ensures saved device settings are visible immediately when the runtime view opens.

The general runtime also defines an `mqtt_settings` section following the same model. MQTT is opt-in: its `mqtt_enabled` checkbox defaults to `false`, and the runtime only starts the MQTT client/message pump when the saved `mqtt_settings.json` has `enabled: true`. See `docs/dev/nodes/mqtt-node-system.md`.

### Section Properties

| Property      | Type    | Description                                    |
| ------------- | ------- | ---------------------------------------------- |
| `id`          | string  | Unique section identifier                      |
| `title`       | string  | I18n key for section header                    |
| `collapsible` | boolean | Whether the section header toggles its body (`CollapsibleView`) |
| `collapsed`   | boolean | Initial collapsed state (default: `false`)     |
| `controls`    | array   | Array of control definitions or layout entries |

> Sections render as `CollapsibleView` instances inside a vertical `SplitView`; a
> non-collapsible section uses `CollapsibleView({ collapsible: false })`, which pins it
> open and renders no toggle or solo button. Section bodies are `StackView` form
> containers.

The definition's top-level `title`/`description` render in a `CollapsibleView` header by
default. A host that provides its own `CollapsibleView` can pass `showHeader: false` to
`CustomRuntimeView` (forwarded to `CustomViewRenderer`); the description then renders as
the first `MessageView` in the content `StackView` and the host supplies the section
title. `DeviceConnectionView` uses this option to host the General Runtime Configuration
inside a collapsible pane without a duplicate header.

### Layout Entries: `row` and `stack`

Sections can define grouped layout entries for side-by-side controls.

#### Row entries

A `row` places controls on a single horizontal line:

```json
{
  "type": "row",
  "controls": [
    {
      "id": "wifi_status",
      "type": "text",
      "grow": true
    },
    {
      "id": "wifi_refresh",
      "type": "button",
      "width": 42
    }
  ]
}
```

Supported row sizing flags per row control:

- `grow: true` → expands to fill remaining row width
- `width` → fixed width (`number` in px, numeric string, or CSS width string)

#### Stack entries

A `stack` is a generic flow container for arbitrary child entries (controls,
`row` entries, or nested `stack` entries). It is the "wrapping horizontal stack":
children flow left-to-right and wrap onto a new line when they run out of space.

```json
{
  "type": "stack",
  "direction": "horizontal",
  "wrap": true,
  "gap": "8px",
  "align": "flex-start",
  "controls": [
    { "id": "mqtt_host", "type": "text", "grow": true },
    { "id": "mqtt_port", "type": "number", "width": 130 }
  ]
}
```

Properties:

- `direction` — `horizontal` (children in a row) or `vertical` (children in a column, like a section body). Default: `horizontal`.
- `wrap` — for horizontal stacks, whether children wrap onto additional lines. Default: `true`.
- `gap` — flex gap between children (px number or CSS string). Default: `8px`.
- `align` — `align-items` value. Default: `flex-start` for horizontal, `stretch` for vertical.
- `controls` — child controls, `row` entries, or nested `stack` entries.

Horizontal stack children honour the same sizing flags as row children (`grow`
and `width`); a `grow` child uses a `220px` flex-basis so it can shrink and wrap
gracefully. The `general` runtime uses stacks for the webserver and MQTT sections
so their controls sit side by side on wide panels and wrap on narrow ones.

---

## Control Types

### Common Properties

All controls share these base properties:

```json
{
  "id": "control_id",           // Unique control identifier
  "type": "text|number|...",    // Control type
  "label": "i18n.key.label",    // I18n key for label
  "defaultValue": "...",        // Initial value
  "disabled": false,             // Disable state (default: false)
  "enableOnDirty": ["id_a"],    // Optional: enable when any listed control is dirty
  "disableOnDirty": ["id_b"],   // Optional: disable when any listed control is dirty
  "visibleWhen": {              // Optional: show only while another control matches
    "controlId": "wifi_sta_enabled",
    "equals": true
  }
}
```

Dirty state means current control value differs from the setup/default baseline value.

#### `visibleWhen`

`visibleWhen` hides a control while another control's value does not match. It accepts either a single
condition object or an **array of conditions that are ANDed**:

```json
{
  "id": "wifi_sta_ssid",
  "type": "text",
  "label": "generalRuntime.wifiSettings.staSsid",
  "visibleWhen": {"controlId": "wifi_sta_enabled", "equals": true}
}
```

Condition keys:

- `controlId` (required): control whose value drives the visibility
- `equals` / `notEquals`: compared with the renderer's `_valuesEqual()`, so checkbox booleans
  (`true`/`false`) and dropdown string values both match
- `in`: array of accepted values

Semantics:

- An array is ANDed: every condition must be satisfied.
- A condition that references a **control id that does not exist** is treated as satisfied, so a view
  can be written before the driver control is added.
- A `row` or `stack` whose children are **all hidden** is hidden as well (avoids a stray flex gap).
- Visibility is re-evaluated after every value change, after `updateControls` mappings, and at the end
  of the initial render.
- Buttons skip hidden controls in their `validate` array, so a disabled mode's fields never block a
  save.
- The renderer toggles the native `hidden` attribute through `StackItem.setHidden()`.
  `StackView` applies it to both the item host and the control wrapper, so a hidden
  control matches `[data-control-id][hidden]` while its flex display stays under the
  theme's control.

### Text Control

```json
{
  "id": "wifi_sta_ssid",
  "type": "text",
  "label": "generalRuntime.wifiSettings.staSsid",
  "placeholder": "generalRuntime.wifiSettings.staSsidPlaceholder",
  "defaultValue": "",
  "password": false,            // Use password masking
  "readonly": false,            // Make read-only
  "linkifyIpAddress": false,    // Read-only only: render detected IPv4 as clickable link
  "visibleWhen": {              // Only shown while the station is enabled
    "controlId": "wifi_sta_enabled",
    "equals": true
  },
  "validation": {
    "maxLength": 32,
    "minLength": 1,
    "pattern": "^[\\x20-\\x7E]+$",  // Regex pattern
    "errorMessage": "generalRuntime.wifiSettings.staSsidError"
  }
}
```

> `required` at the control root is **not** evaluated by the renderer. Express requirements inside
> `validation` (`minLength`, `pattern`, …); hidden controls are skipped by `validate` arrays.

### Number Control

```json
{
  "id": "webserver_port",
  "type": "number",
  "label": "generalRuntime.webserverSettings.port",
  "defaultValue": 80,
  "min": 1,
  "max": 65535,
  "step": 1
}
```

### Dropdown Control

```json
{
  "id": "log_level",
  "type": "dropdown",
  "label": "i18n.key.logLevel",
  "defaultValue": "info",
  "options": [
    {
      "value": "info",
      "label": "i18n.key.logLevelInfo"
    },
    {
      "value": "debug",
      "label": "i18n.key.logLevelDebug"
    }
  ]
}
```

### Checkbox Control

```json
{
  "id": "webserver_enable",
  "type": "checkbox",
  "label": "generalRuntime.webserverSettings.enable",
  "defaultValue": true
}
```

Checkbox rendering uses a single `label` field, displayed to the right of the checkbox input.

### Button Control

Buttons trigger device function execution:

```json
{
  "id": "wifi_check_btn",
  "type": "button",
  "label": "generalRuntime.wifiSettings.checkButton",
  "icon": "sync",
  "iconOnly": true,
  "style": "primary|secondary",
  "clearDirty": ["wifi_sta_ssid", "wifi_sta_password", "wifi_ap_ssid", "wifi_ap_password"],
  "function": {
    "name": "check_wifi_status",
    "parameters": [],
    "onSuccess": { /* success handler */ },
    "onError": { /* error handler */ }
  },
  "validate": ["wifi_sta_ssid", "wifi_sta_password", "wifi_ap_ssid", "wifi_ap_password"]  // Optional: validate controls before execution
}
```

`iconOnly: true` renders only the icon and uses the translated `label` as tooltip/accessible name.

---

## Device Function Execution

### Parameter Substitution

Button functions can pass control values using `${}` syntax:

```json
{
  "function": {
    "name": "create_wifi_settings",
    "parameters": [
      "${wifi_sta_enabled}",     // Value from control with id="wifi_sta_enabled"
      "${wifi_sta_ssid}",
      "${wifi_sta_password}",
      "${wifi_ap_enabled}",
      "${wifi_ap_ssid}",
      "${wifi_ap_password}"
    ]
  }
}
```

**Parameter Types**:
- **Control Reference**: `"${control_id}"` → replaced with control's current value
- **Literal Values**: `"my_string"`, `42`, `true` → passed as-is

### Python Command Generation

The renderer builds Python commands with automatic module import and `print()` wrapping:

```python
# Template:
import {module}; print({module}.{functionName}({args}))

# Example for check_wifi_status():
import app.custom_settings; print(app.custom_settings.check_wifi_status())

# Example with parameters:
import app.custom_settings; print(app.custom_settings.create_wifi_settings('MySSID', 'password123', 'STA'))
```

**Critical**: The function return value is wrapped in `print()` so it's sent back to the browser via REPL stdout.

### Module Path

Default module: `app.custom_settings`

Python functions are expected in:
```
device/runtime/{runtime_id}/app/custom_settings.py
```

---

## Device Function Response Protocol

### Return Format

Python functions **must return JSON strings** for structured control updates:

```python
def check_wifi_status():
    """Check WiFi status and return JSON."""
    snapshot = wifi_status_snapshot(WIFI_SETTINGS_FILE)

    return json.dumps({
        'status': build_status_text(snapshot),
        'sta_enabled': snapshot['sta']['enabled'],
        'sta_active': snapshot['sta']['active'],
        'sta_connected': snapshot['sta']['connected'],
        'sta_ip': snapshot['sta']['ip'],
        'ap_enabled': snapshot['ap']['enabled'],
        'ap_active': snapshot['ap']['active'],
        'ap_ip': snapshot['ap']['ip'],
        'mode': snapshot['mode'],
        'modes': snapshot['modes']
    })
```

**Important**: The function returns a JSON string, which gets printed to stdout. The browser receives this JSON and parses it.

### Response Types

#### 1. Success Response with Data

Used for functions that query device state or return information:

```python
return json.dumps({
    'status': 'Connected to MyNetwork (IP: 192.168.1.100)',
    'ssid': 'MyNetwork',
    'ip': '192.168.1.100'
})
```

The renderer receives this as a parsed object and can use it with `onSuccess.mapping`.

#### 2. Success Response with Status

Used for functions that perform operations:

```python
return json.dumps({
    'success': True,
    'message': 'WiFi settings saved successfully'
})
```

#### 3. Error Response

Used when operations fail:

```python
return json.dumps({
    'success': False,
    'error': 'SSID must be 1-32 characters'
})
```

**Note**: If a Python exception occurs, the renderer catches it and triggers `onError` handlers automatically.

#### 4. Dialog Directive (Generalized UI Feedback)

Any response object can include dialog directives to instruct the renderer to show info or error dialogs.

```python
return json.dumps({
  'success': True,
  'message': 'WiFi settings saved',
  'dialog': {
    'type': 'info',
    'title': 'generalRuntime.wifiSettings.restartRequiredTitle',
    'message': 'generalRuntime.wifiSettings.restartRequiredMessage'
  }
})
```

Supported forms:

- `dialog`: single dialog object
- `dialogs`: array of dialog objects

Dialog object fields:

- `type`: `"info"`, `"warning"` or `"error"` — a missing type counts as `"info"`
- `title`: i18n key or literal title
- `message`: i18n key or literal body text
- `detail` (optional): additional detail text (used for error dialogs)
- `icon`, `confirmLabel`, `scrim` (optional): forwarded to dialog APIs

Behavior:

- Dialog directives are processed for both success and failure responses.
- `dialog` is shown first, then every entry of `dialogs`, in array order.
- `type: "warning"` opens the info dialog with the title `Warning` and the icon `⚠️` unless
  `title`/`icon` say otherwise. Use it for something that *was* accepted but will not take
  effect as configured — e.g. settings that were saved while their section is disabled.
- For `type: "error"` dialogs on a failed response (`success: false`), the renderer avoids showing a duplicate generic error modal.

---

## Success Handlers

The `onSuccess` configuration defines what happens when a function completes successfully.

### Action: `updateControls`

Updates control values from the returned JSON object:

```json
{
  "onSuccess": {
    "action": "updateControls",
    "mapping": {
      "status": "wifi_status",        // result.status → control with id="wifi_status"
      "sta_ssid": "wifi_sta_ssid",    // result.sta_ssid → control with id="wifi_sta_ssid"
      "ap_ssid": "wifi_ap_ssid"
    }
  }
}
```

**How It Works**:
1. Python function returns JSON: `{"status": "Connected", "ssid": "MyNet"}`
2. Renderer parses JSON into object
3. For each mapping entry:
   - Reads `result[key]` (e.g., `result.status`)
   - Resolves the mapping value (string form or `{ controlId, translate }` object form)
   - Calls `control.setValue(_translateMappedValue(translate, result[key]))`

**Mapping entry forms**

Each mapping value is either a plain control ID (string) or an object:

```json
{
  "mapping": {
    "status": "wifi_status",
    "message": { "controlId": "runtime_status", "translate": true }
  }
}
```

- **String form** — the value is passed through unchanged (literal data such as SSID, IP address, port, or booleans).
- **Object form** `{ "controlId": string, "translate": boolean }` — when `translate` is `true`, string values are resolved through the i18n service (`_t(...)`) before `setValue`. Non-string values always pass through unchanged.

This mirrors the translation already applied to `dialog` and `showMessage` messages, so device functions can return i18n keys for user-facing messages while literal values stay untranslated.

**Example**: WiFi Status Check

```json
{
  "id": "wifi_check_btn",
  "type": "button",
  "label": "Check Status",
  "function": {
    "name": "check_wifi_status",
    "parameters": [],
    "onSuccess": {
      "action": "updateControls",
      "mapping": {
        "status": "wifi_status"
      }
    }
  }
}
```

```python
def check_wifi_status():
    snapshot = wifi_status_snapshot(WIFI_SETTINGS_FILE)
    sta = snapshot['sta']

    if sta['connected']:
        status = f"STA connected (IP: {sta['ip']})"
    elif sta['enabled']:
        status = f"STA enabled, not connected ({sta['status_label']})"
    else:
        status = "WiFi disabled"

    return json.dumps({'status': status})
```

Result: The text control with `id="wifi_status"` displays the connection status.

### Action: `showMessage`

Displays a notification message (currently logs to console, future: toast/modal):

```json
{
  "onSuccess": {
    "action": "showMessage",
    "messageType": "success",
    "message": "generalRuntime.wifiSettings.saveSuccess"
  }
}
```

**Message Types**: `success`, `info`, `warning`, `error`

### Action: `softReset`

Displays an optional success message, then sends a device soft reset (Ctrl+D) via Web Serial.

```json
{
  "onSuccess": {
    "action": "softReset",
    "messageType": "success",
    "message": "generalRuntime.wifiSettings.saveSuccess"
  }
}
```

Use this for settings that are persisted immediately but only applied on runtime restart (for example WiFi mode/credentials).

**Current recommendation**: Prefer `showMessage` plus response-driven `dialog` directives for restart-required workflows. This keeps restart decisions explicit for users (for example: show an info dialog instructing hard reset + reconnect after WiFi settings save), rather than automatically resetting on save.

### Action: `refresh`

Placeholder for future functionality (reload view, refresh device info).

---

## Error Handlers

The `onError` configuration defines what happens when a function fails.

### Action: `showMessage`

```json
{
  "onError": {
    "action": "showMessage",
    "messageType": "error",
    "message": "generalRuntime.wifiSettings.checkError"
  }
}
```

**Triggers**:
- Python exception during function execution
- Device communication timeout
- JSON parse error (if result looks like JSON but is malformed)

### Action: `updateControls`

Writes the error message into one or more controls (useful for inline status lines):

```json
{
  "onError": {
    "action": "updateControls",
    "mapping": {
      "error": "runtime_status"
    }
  }
}
```

**How It Works**: For each mapping value, the renderer resolves the control ID and calls `control.setValue(error.message)`. Device error strings are treated as literal text (not translated).

---

## Validation

### Pre-Execution Validation

Buttons can specify which controls to validate before executing:

```json
{
  "id": "runtime_save_btn",
  "type": "button",
  "function": {
    "name": "create_runtime_settings",
    "parameters": [
      "${wifi_sta_enabled}",
      "${wifi_sta_ssid}",
      "${wifi_sta_password}",
      "${wifi_ap_enabled}",
      "${wifi_ap_ssid}",
      "${wifi_ap_password}",
      "${webserver_enable}",
      "${webserver_port}",
      "${mqtt_enabled}",
      "${mqtt_host}",
      "${mqtt_port}",
      "${mqtt_client_id}",
      "${mqtt_user}",
      "${mqtt_password}",
      "${mqtt_keepalive}",
      "${mqtt_pump_delay_ms}"
    ]
  },
  "validate": [
    "wifi_sta_enabled",
    "wifi_sta_ssid",
    "wifi_sta_password",
    "wifi_ap_enabled",
    "wifi_ap_ssid",
    "wifi_ap_password"
  ]
}
```

The `parameters` order mirrors the device signature
`create_runtime_settings(wifi_sta_enabled, wifi_sta_ssid, wifi_sta_password, wifi_ap_enabled,
wifi_ap_ssid, wifi_ap_password, webserver_enable=True, webserver_port=80, mqtt_enabled=False,
mqtt_host='', mqtt_port=1883, mqtt_client_id='', mqtt_user='', mqtt_password='', mqtt_keepalive=60,
mqtt_pump_delay_ms=50)`. Controls hidden through `visibleWhen` are skipped by `validate`, so a
disabled profile never blocks the save.

If any control fails validation:
- Function is **not** executed
- The offending controls receive the `.custom-control.is-invalid` marker until their value changes
- The failure is reported to the user: the message is routed through the button's `onError` handler
  (the general runtime upload writes it into `runtime_status`), otherwise the renderer shows an error
  dialog, otherwise it falls back to the console
- No device communication occurs

The message is `customView.validationFailed` followed by the translated labels of the offending
controls (for example `Please correct validation errors before saving: Access Point Password`).
Earlier revisions only logged the failure to the browser console, which made a refused upload look
like a silent no-op.

Controls hidden by `visibleWhen` are **skipped** by the `validate` array (they cannot be seen, so they
cannot be fixed). A control id that is referenced but does not exist at all still blocks execution.

### Control-Level Validation

Text controls support validation rules:

```json
{
  "validation": {
    "minLength": 8,
    "maxLength": 63,
    "pattern": "^[\\x20-\\x7E]{8,63}$",
    "errorMessage": "generalRuntime.wifiSettings.passwordError"
  }
}
```

`minLength`/`maxLength` and `pattern` are independent checks. To express "empty **or** 8-63
printable characters" for an optional credential (the access-point password supports an open access
point), set `"allowEmpty": true` together with a `pattern` for the non-empty form — the renderer
accepts an empty value before applying `pattern`/`minLength`:

```json
{
  "validation": {
    "allowEmpty": true,
    "pattern": "^[\\x20-\\x7E]{8,63}$",
    "errorMessage": "generalRuntime.wifiSettings.apPasswordError"
  }
}
```

`allowEmpty` only affects an exactly empty string (`''`); a whitespace-only value is still subject to
`pattern`/`minLength` and is rejected unless the pattern allows it.

Validation is checked:
1. On button click (if control is in `validate` array)
2. Programmatically via `control.validate()`

---

## Complete Example: WiFi Settings

The device stores one profile per mode (`profiles.sta` / `profiles.ap`, `version: 2`); a legacy flat
`{"ssid", "password", "mode", "enabled"}` file is migrated on the first read. The view below therefore
exposes a checkbox plus SSID/password per mode and hides the fields of a disabled mode.

### View Definition

```json
{
  "sections": [
    {
      "id": "wifi_settings",
      "title": "WiFi Settings",
      "collapsible": true,
      "collapsed": false,
      "controls": [
        {
          "id": "wifi_status",
          "type": "text",
          "label": "Connection Status",
          "defaultValue": "Unknown",
          "readonly": true
        },
        {
          "id": "wifi_check_btn",
          "type": "button",
          "label": "Check Status",
          "style": "secondary",
          "function": {
            "name": "check_wifi_status",
            "parameters": [],
            "onSuccess": {
              "action": "updateControls",
              "mapping": {
                "status": "wifi_status"
              }
            },
            "onError": {
              "action": "showMessage",
              "messageType": "error",
              "message": "Failed to check WiFi status"
            }
          }
        },
        {
          "id": "wifi_sta_enabled",
          "type": "checkbox",
          "label": "Station (STA) enabled",
          "defaultValue": false
        },
        {
          "id": "wifi_sta_ssid",
          "type": "text",
          "label": "Station network name (SSID)",
          "defaultValue": "",
          "validation": {
            "maxLength": 32
          },
          "visibleWhen": "wifi_sta_enabled"
        },
        {
          "id": "wifi_sta_password",
          "type": "text",
          "label": "Station password",
          "defaultValue": "",
          "password": true,
          "validation": {
            "minLength": 8,
            "maxLength": 63
          },
          "visibleWhen": "wifi_sta_enabled"
        },
        {
          "id": "wifi_ap_enabled",
          "type": "checkbox",
          "label": "Access point (AP) enabled",
          "defaultValue": false
        },
        {
          "id": "wifi_ap_ssid",
          "type": "text",
          "label": "Access point name (SSID)",
          "defaultValue": "MicroOtter-AP",
          "validation": {
            "maxLength": 32
          },
          "visibleWhen": "wifi_ap_enabled"
        },
        {
          "id": "wifi_ap_password",
          "type": "text",
          "label": "Access point password (empty for open AP)",
          "defaultValue": "",
          "password": true,
          "validation": {
            "minLength": 8,
            "maxLength": 63
          },
          "visibleWhen": "wifi_ap_enabled"
        },
        {
          "id": "wifi_save_btn",
          "type": "button",
          "label": "Save Settings",
          "style": "primary",
          "function": {
            "name": "create_wifi_settings",
            "parameters": [
              "${wifi_sta_enabled}",
              "${wifi_sta_ssid}",
              "${wifi_sta_password}",
              "${wifi_ap_enabled}",
              "${wifi_ap_ssid}",
              "${wifi_ap_password}"
            ],
            "onSuccess": {
              "action": "softReset",
              "messageType": "success",
              "message": "WiFi settings saved"
            }
          },
          "validate": [
            "wifi_sta_enabled",
            "wifi_sta_ssid",
            "wifi_sta_password",
            "wifi_ap_enabled",
            "wifi_ap_ssid",
            "wifi_ap_password"
          ]
        }
      ]
    }
  ]
}
```

### Python Implementation

```python
import json

from tools.wifi_manager import save_wifi_profiles, wifi_status_snapshot

WIFI_SETTINGS_FILE = '/wifi_settings.json'


def check_wifi_status():
    """Report both WiFi interfaces without opening them when disabled."""
    snapshot = wifi_status_snapshot(WIFI_SETTINGS_FILE)

    parts = []
    if snapshot['sta']['enabled']:
        sta = snapshot['sta']
        if sta['connected']:
            parts.append(f"STA connected (IP: {sta['ip']})")
        else:
            parts.append(f"STA enabled, not connected ({sta['status_label']})")
    if snapshot['ap']['enabled']:
        ap = snapshot['ap']
        if ap['connected']:
            parts.append(f"AP active (IP: {ap['ip']})")
        else:
            parts.append("AP enabled, not active")

    return json.dumps({
        'status': " | ".join(parts) if parts else "WiFi disabled",
        'sta_enabled': snapshot['sta']['enabled'],
        'sta_connected': snapshot['sta']['connected'],
        'ap_enabled': snapshot['ap']['enabled'],
        'ap_active': snapshot['ap']['active'],
        'modes': snapshot['modes']
    })


def create_wifi_settings(sta_enabled, sta_ssid, sta_password,
                         ap_enabled, ap_ssid, ap_password):
    """Persist both profiles; validation is owned by tools.wifi_manager."""
    try:
        save_wifi_profiles({
            'sta': {'enabled': bool(sta_enabled), 'ssid': sta_ssid, 'password': sta_password},
            'ap': {'enabled': bool(ap_enabled), 'ssid': ap_ssid, 'password': ap_password}
        }, file_path=WIFI_SETTINGS_FILE)

        return json.dumps({
            'success': True,
            'message': 'WiFi settings saved successfully'
        })

    except Exception as e:
        return json.dumps({
            'success': False,
            'error': str(e)
        })
```

---

## Execution Flow

### Button Click Flow

```
1. User clicks "Check Status" button
   ├── Renderer calls _executeFunction(buttonDef)
   │
2. Validate controls (if specified in buttonDef.validate)
   ├── If validation fails → mark the offending controls, report via onError/dialog, abort
   │
3. Extract parameters with ${} substitution
   ├── "${wifi_sta_ssid}" → control.getValue()
   │
4. Execute via custom-view boundary API
  ├── DeviceConnection.executeCustomViewAction("check_wifi_status", [], { runtimeImpact: "none" })
  │
5. DeviceConnection executes on device
  ├── Maps action name/parameters to runtime execution transport
   ├── Wait for response
   │
6. Device executes function
   ├── check_wifi_status() returns JSON string
   ├── print() sends JSON to stdout
   │
7. Browser receives result
   ├── Parse JSON string to object
   │
8. Handle success (onSuccess configuration)
   ├── action: "updateControls"
   ├── For each mapping: result[key] → control.setValue()
   │
9. Show visual feedback
   └── Button pulse animation (green flash)
```

### Error Handling Flow

```
Error → DeviceConnection.executeCustomViewAction() throws
     ├── Catch in _executeFunction()
     │
     ├── Show error modal (if ViewManager available)
     │   └── Title: "Execution Error"
     │       Message: "Function failed: check_wifi_status"
     │       Detail: error.message
     │
     └── Trigger onError handler
         └── action: "showMessage" → log error
```

---

## Frozen Runtime-State Ownership Contract (Phase 11 Step 1)

This contract is frozen as of 2026-04-01 for frontend runtime synchronization.

### Authority

- `DeviceConnection` is the single source of truth for authoritative runtime connection and execution state.
- Authoritative runtime state includes connection lifecycle state (for example disconnected/connecting/connected/disconnecting/error) and execution-running state.

### View Boundaries

- View classes (including `DeviceConnectionView`, `CustomViewRenderer`, and control/view helpers) must not own authoritative runtime state.
- View classes must not infer authoritative runtime state from ad hoc UI signals (for example button disabled state, optimistic local flags, or inferred command intent).
- Views may keep transient presentation-only state (for example loading indicators, open/closed sections, animation state), but this state is non-authoritative and must be derived from or reconciled against `DeviceConnection` state/events.

### Integration Rules

- Runtime-impacting actions initiated by views must route through `DeviceConnection` public APIs.
- UI enablement/disablement for runtime controls must be driven by `DeviceConnection` state getters and canonical runtime events.
- Any transition that can change authoritative runtime state must be represented through `DeviceConnection` transition handling and event emission, not view-local transition logic.

### Scope Note

- This step defines ownership and boundaries only. API shape, transition semantics, event normalization, and implementation details are handled in subsequent Phase 11 steps.

---

## Custom View Runtime-Impact and Invocation Contract (Phase 11 Step 10)

This section defines the extension contract for adding new custom-view functions that may affect runtime execution state.

### Runtime Impact Declaration

Declare runtime impact on the function definition:

```json
{
  "function": {
    "name": "save_runtime_settings",
    "parameters": ["${wifi_sta_ssid}", "${wifi_sta_password}"],
    "runtimeImpact": "restart"
  }
}
```

Supported values:

- `none`: Function does not require runtime stop/start transitions.
- `stop`: Runtime must stop before function execution.
- `restart`: Runtime must stop before execution and start again after success.

Default and backward compatibility behavior:

- If `runtimeImpact` is omitted, behavior defaults to `none`.
- Existing custom-view functions without `runtimeImpact` remain valid and continue to execute as no-impact actions.

### Required Invocation Boundary

All custom-view function execution from view code must go through `DeviceConnection.executeCustomViewAction(functionName, parameters, { runtimeImpact })`.

- Do use the dedicated custom-view boundary API above.
- Do not call `DeviceConnection.executeCode(...)` directly from custom-view action paths.
- Do not call raw command transport paths directly from view code.

This keeps runtime transitions, event payloads, and state flags centralized in `DeviceConnection`.

### Transition and Event Expectations

For UI consumers (including `DeviceConnectionView`) to stay synchronized, custom-view actions must follow canonical transition semantics via `DeviceConnection`:

- `runtimeImpact: none`
  - Execute function only.
  - No synthetic stop/start transition is introduced.
- `runtimeImpact: stop`
  - Perform canonical stop transition before function execution.
  - Runtime execution state is reflected through canonical execution events.
- `runtimeImpact: restart`
  - Perform canonical stop transition, run function, then perform canonical start transition.
  - Consumers observe the same execution transition model used by toolbar actions.

Event detail for custom-view initiated transitions must preserve source metadata (`source: custom-view-action`) and include action context fields where applicable (for example `functionName`, `runtimeImpact`, and `transitionStep` on transition failures).

### Migration Notes for Existing Functions

- Keep existing settings/query functions unchanged if they do not affect runtime state (`runtimeImpact` omitted or `none`).
- For functions that currently stop or restart runtime implicitly, add explicit `runtimeImpact` in JSON and route execution through `executeCustomViewAction(...)`.
- If any legacy custom-view path still executes functions through direct `executeCode(...)`, migrate it to the dedicated boundary API to maintain canonical state/event synchronization.

---

## Implementation Guidelines

### Device-Side Python

1. **Always return JSON strings** for structured data:
   ```python
   return json.dumps({...})
   ```

2. **Use consistent error format**:
   ```python
   return json.dumps({
       'success': False,
       'error': 'Error message'
   })
   ```

3. **Include all data needed for UI updates**:
   ```python
   # ✓ Good: Includes all mapped fields
   return json.dumps({
       'status': 'Connected',
       'ssid': 'MyNetwork',
       'ip': '192.168.1.100'
   })
   
   # ✗ Bad: Missing mapped fields
   return json.dumps({
       'status': 'Connected'
   })  # UI expects 'ssid' and 'ip' but they're undefined
   ```

4. **Validate inputs** to avoid device crashes:
   ```python
   if not ssid or len(ssid) > 32:
       return json.dumps({'success': False, 'error': 'Invalid SSID'})
   ```

### View Definition JSON

1. **Use i18n keys** for all user-facing strings
2. **Provide validation rules** where appropriate
3. **Map all returned fields** in `onSuccess.mapping`
4. **Specify validation dependencies** in button `validate` arrays

---

## Future Enhancements

### Planned Features

1. **Dynamic Control Visibility**
   - Show/hide controls based on other control values
   - Enable/disable controls via function responses

2. **Improved Message Display**
   - Toast notifications for success/info messages
   - Modal dialogs for errors
   - Inline validation feedback

3. **Multi-Control Updates**
   - Bulk control updates from single function call
   - Conditional updates based on result flags

4. **Custom Control Types**
   - File upload controls
   - Color pickers
   - Range sliders with labels

---

## Related Documentation

- [View System Architecture](view-system-architecture.md) - Base ViewBase class and lifecycle
- [Device Deployment View Architecture](device-deployment-view-architecture.md) - Custom view loading in deployment view
- [I18n Architecture](../core/i18n-service.md) - Translation system integration

---

## Troubleshooting

### Problem: Control Not Updating After Function Call

**Symptoms**: Button flashes green but control value doesn't change

**Cause**: Function returns data but control isn't receiving it

**Debug Steps**:
1. Check browser console for `[DeviceConnection] code-executed` log
2. Verify `outputLength` is > 0
3. Check if Python function returns JSON string: `return json.dumps({...})`
4. Verify `onSuccess.mapping` matches JSON keys: `result.status` → `mapping.status`
5. Check control ID matches: `mapping.status: "wifi_status"` → control has `id="wifi_status"`

**Solution**: Ensure Python function returns JSON and mapping is correct.

### Problem: Function Execution Timeout

**Symptoms**: "Execution timeout" error after 10 seconds

**Cause**: Function takes too long or hangs

**Solutions**:
- Optimize function logic
- Use background tasks for long operations
- Increase timeout (requires code change in CustomViewRenderer)

### Problem: Validation Always Fails

**Symptoms**: Button never executes function

**Cause**: Validation rules too strict or regex pattern incorrect

**Debug Steps**:
1. Check control validation rules: `minLength`, `maxLength`, `pattern`
2. Test regex pattern separately
3. Verify control has valid value

**Solution**: Adjust validation rules or use `required: false`.

---

**Document Version**: 1.0  
**Maintained by**: Development Team  
**Last Review**: 2026-02-12
