# Device Tools Reference

**Status**: Complete (Phase 2)  
**Related**: [Device Folder Structure](device-folder-structure.md), [Tools Integration Plan](../../ldev/todos/deployment/tools-folder-integration-plan.md)

---

## Overview

The device tools folder (`/tools`) contains Python utility modules deployed to ESP32 devices alongside the runtime. These modules provide essential device-side functionality for WiFi management, filesystem operations, logging, and runtime inspection.

**Location on Device**: `/tools/`  
**Location on Host**: `src/micro_otter/nodes/device/tools/`  
**Deployment**: Uploaded with every runtime deployment using hash-based incremental updates  
**Manifest**: `tools/manifest.json`

---

## Module Index

| Module                             | Purpose                    | Key Functions                                             |
| ---------------------------------- | -------------------------- | --------------------------------------------------------- |
| [fs_utils.py](#fs_utilspy)         | Filesystem operations      | ensure_dirs, path_exists, read_file, wipe_filesystem      |
| [wifi_manager.py](#wifi_managerpy) | WiFi connection management | connect_station, start_access_point, wifi_status_snapshot |
| [runtime_info.py](#runtime_infopy) | Runtime introspection      | print_runtime_metadata                                    |
| [runtime_log.py](#runtime_logpy)   | Structured logging         | log_event, log_startup, log_error, log_exception, log_plain |
| [set_wifi.py](#set_wifipy)         | WiFi configuration CLI     | set_wifi (function)                                       |
| [wifi_probe.py](#wifi_probepy)     | WiFi status inspection     | ensure_wifi_status                                        |
| [wifi_diag.py](#wifi_diagpy)       | WiFi diagnostics           | main (standalone script)                                  |

> `otter_runtime/wifi_boot.py` (runtime, not a device tool) owns the boot-time
> interface bring-up and the station supervisor; see
> [wifi_boot.py](#wifi_bootpy-runtime).

---

## fs_utils.py

Filesystem operations for WebSerial bridge and deployment operations.

### Functions

#### `ensure_dirs(path: str) -> None`

Create directory tree (like `mkdir -p`). Idempotent, no error if directory exists.

**Parameters**:

- `path` (str): Directory path to create (nested paths supported)

**Behavior**:

- Normalizes path (converts backslashes, removes duplicates)
- Creates each segment in path
- Silently succeeds if directory already exists
- Does nothing if path is empty

**Example**:

```python
from tools.fs_utils import ensure_dirs

ensure_dirs('app/libs/stdmo')  # Creates app/, app/libs/, app/libs/stdmo/
ensure_dirs('')  # No-op
```

---

#### `path_exists(path: str) -> bool`

Check if path exists on filesystem.

**Parameters**:

- `path` (str): Path to check

**Returns**: `True` if path exists (file or directory), `False` otherwise

**Example**:

```python
from tools.fs_utils import path_exists

if path_exists('config.json'):
    print('Config found')
else:
    print('Config missing')
```

---

#### `read_file(path: str) -> str`

Read entire file content as string.

**Parameters**:

- `path` (str): File path to read

**Returns**: File content as string

**Raises**:

- `ValueError`: If path is empty
- `OSError`: If file not found or not readable

**Example**:

```python
from tools.fs_utils import read_file

content = read_file('collection/node_graph_cln.json')
print(content)
```

---

#### `print_file(path: str) -> None`

Print file content to stdout (used by WebSerial protocol).

**Parameters**:

- `path` (str): File path to print

**Raises**: Same as `read_file()`

**Example**:

```python
from tools.fs_utils import print_file

# WebSerial command: download file
print_file('app/main_loop.py')  # Prints to stdout for capture
```

---

#### `reset_file(path: str) -> None`

Create empty file, truncating if exists. Ensures parent directories exist.

**Parameters**:

- `path` (str): File path to create/truncate

**Raises**:

- `ValueError`: If path is empty

**Example**:

```python
from tools.fs_utils import reset_file

reset_file('logs/app.log')  # Creates empty logs/app.log
```

---

#### `append_base64_chunk(path: str, chunk_b64: str) -> None`

Append base64-encoded chunk to file (used for file uploads).

**Parameters**:

- `path` (str): File path to append to
- `chunk_b64` (str): Base64-encoded data chunk

**Raises**:

- `ValueError`: If path is empty

**Example**:

```python
from tools.fs_utils import reset_file, append_base64_chunk

# Upload file in chunks
reset_file('app/uploaded.py')
append_base64_chunk('app/uploaded.py', 'ZGVmIG1haW4oKToKICAgIHBhc3M=')
append_base64_chunk('app/uploaded.py', 'Cm1haW4oKQo=')
```

---

#### `wipe_filesystem(excludes=None) -> None`

Recursively delete all files and directories except specified exclusions.

**Parameters**:

- `excludes` (list[str], optional): Paths to preserve (default: `None`)

**Behavior**:

- Deletes files and directories recursively
- Skips paths in `excludes` list
- Normalizes all paths before comparison
- Does not delete root directory itself

**⚠️ Warning**: Destructive operation. Use with caution.

**Example**:

```python
from tools.fs_utils import wipe_filesystem

# Wipe everything except boot.py and /tools
wipe_filesystem(excludes=['boot.py', 'tools'])

# Result: Only boot.py and /tools remain
```

---

## wifi_manager.py

WiFi connection management for station (STA) and access point (AP) modes.

### Settings Document

`wifi_settings.json` keeps one **independent profile per mode** (`version: 2`):

```json
{
  "version": 2,
  "reconnect_interval_s": 30,
  "profiles": {
    "sta": {"enabled": true, "ssid": "MyNetwork", "password": "password123"},
    "ap": {"enabled": false, "ssid": "MicroOtter-AP", "password": ""}
  }
}
```

Each profile owns its `enabled` flag, so station and access point can run independently (STA only,
AP only, both, or neither). Next to `profiles` the module still writes the legacy flat keys
`mode`, `modes`, `enabled`, `ssid` and `password` as **derived mirrors** of the primary profile (the
station when it is enabled, otherwise the access point). `mode` always stays `'sta'` or `'ap'` -
never `'both'`/`'none'` - because `maybe_create_interface()` and `wifi_probe.py` branch on it.
Documents without a `profiles` mapping are migrated on read: their flat fields seed that mode's
profile and the other mode starts disabled.

A top-level `reconnect_interval_s` (default `30`, clamped to `1..600`) configures the station
supervisor retry cadence. It is optional and back-compatible: documents without it read back as
`30`. `load_wifi_reconnect_interval()` returns the clamped value, and
`save_wifi_profiles(..., reconnect_interval_s=…)` overrides it while a plain save preserves the
stored value.

**Validation rules** (a disabled profile is never validated, so it may hold incomplete data):

- `ssid`: 1-32 characters when the profile is enabled; the access-point profile falls back to
  `DEFAULT_AP_SSID` when left empty
- `password`: empty, or 8-63 characters
- enabling the station profile requires both an SSID and a password

An empty access-point password is a supported configuration: `start_access_point()` then configures
`AUTH_OPEN`, i.e. an open access point. The device view mirrors that rule - its
`wifi_ap_password` control accepts an empty value or 8-63 printable characters, so a device that was
provisioned with an open access point (CLI, `set_wifi.py` or a migrated legacy document) stays
editable from the browser.

Constants: `WIFI_SETTINGS_VERSION` (`2`), `WIFI_PROFILE_MODES` (`("sta", "ap")`),
`VALID_WIFI_MODES` (`("sta", "ap")`), `DEFAULT_AP_SSID` (`"MicroOtter-AP"`),
`DEFAULT_RECONNECT_INTERVAL_S` (`30`), `RECONNECT_INTERVAL_MIN_S` (`1`),
`RECONNECT_INTERVAL_MAX_S` (`600`).

#### Runtime modes (APSTA)

| Profiles | Interfaces created | IPs | Web server |
| --- | --- | --- | --- |
| station only | `WLAN(IF_STA)` | one (router DHCP) | bound when the station connects |
| access point only | `WLAN(IF_AP)` | one (`192.168.4.1`) | bound at boot |
| **both** | `WLAN(IF_AP)` **and** `WLAN(IF_STA)` | two | one server on `0.0.0.0` |
| neither | none | none | none |

"Both" is the intended APSTA mode: one radio, one channel, **no NAT/bridging** between the AP subnet
and the station LAN, and `host_ip` reports the station address. The access point is brought up first
and is not stopped when the station connects.

#### Deployment and migration

The device Python is baked into the firmware, so the runtime must be rebuilt
(`mo cr --runtime-id general --board esp32 --clean-staging --clean-build`) and deployed again
(`mo dr --port <PORT>`). `/wifi_settings.json` is listed in the runtime manifest's `preservedPaths`,
so even `--wipe-filesystem` keeps it and the document is migrated to `version: 2` on the first read.

### Exception Classes

#### `WifiSettingsError`

Raised when WiFi settings are invalid or cannot be loaded.

**Example**:

```python
from tools.wifi_manager import WifiSettingsError, load_wifi_settings

try:
    settings = load_wifi_settings()
except WifiSettingsError as e:
    print(f'Invalid WiFi config: {e}')
```

---

#### `WifiUnavailableError`

Raised when requested WiFi interface is not available on device.

**Example**:

```python
from tools.wifi_manager import WifiUnavailableError, maybe_create_interface

iface = maybe_create_interface('sta')
if iface is None:
    raise WifiUnavailableError('Station mode not supported')
```

---

### Functions

#### `load_wifi_profiles(file_path=WIFI_SETTINGS_FILE) -> dict`

Load and validate the two-profile settings document, migrating legacy flat documents.

**Parameters**:

- `file_path` (str): Path to settings file (default: `'/wifi_settings.json'`)

**Returns**: Dictionary mapping each mode in `WIFI_PROFILE_MODES` to its profile:

```python
{
    "sta": {"enabled": True, "ssid": "MyNetwork", "password": "password123"},
    "ap": {"enabled": False, "ssid": "MicroOtter-AP", "password": ""},
}
```

**Raises**:

- `WifiSettingsError`: If the file is missing, unreadable, not a JSON object, or an **enabled**
  profile fails validation

**Example**:

```python
from tools.wifi_manager import load_wifi_profiles

profiles = load_wifi_profiles()
print(f"AP enabled: {profiles['ap']['enabled']}")
```

---

#### `save_wifi_profiles(profiles, *, reconnect_interval_s=None, file_path=WIFI_SETTINGS_FILE) -> dict`

Validate and store the two-profile settings document, including the derived legacy mirrors.

**Parameters**:

- `profiles` (dict): Mapping of mode to profile. A mode that is **missing** keeps the profile
  currently stored on disk, so callers can persist a single mode without discarding the other.
- `reconnect_interval_s` (int | None): Station reconnect interval in seconds. When `None`
  (default), the value currently stored on disk is preserved; otherwise it is clamped to
  `RECONNECT_INTERVAL_MIN_S..RECONNECT_INTERVAL_MAX_S` and written.
- `file_path` (str): Path to settings file (default: `'/wifi_settings.json'`)

**Returns**: The merged profile mapping that was written.

**Raises**:

- `WifiSettingsError`: If an enabled profile fails validation or the file cannot be written

**Example**:

```python
from tools.wifi_manager import save_wifi_profiles

# Enable the access point, leave the station profile untouched
save_wifi_profiles({"ap": {"enabled": True, "ssid": "Boat-AP", "password": "otter12345"}})

# Turn all WiFi off (saving "disabled" is always allowed)
save_wifi_profiles({"sta": {"enabled": False, "ssid": "", "password": ""}})
```

---

#### `load_wifi_reconnect_interval(file_path=WIFI_SETTINGS_FILE) -> int`

Read the top-level station reconnect interval in seconds, clamped to `RECONNECT_INTERVAL_MIN_S..RECONNECT_INTERVAL_MAX_S`. A missing/invalid document or field yields `DEFAULT_RECONNECT_INTERVAL_S`; never raises.

**Example**:

```python
from tools.wifi_manager import load_wifi_reconnect_interval

print(load_wifi_reconnect_interval())  # e.g. 30
```

---

#### `load_wifi_settings(*, file_path=WIFI_SETTINGS_FILE, require_station_credentials=True) -> dict`

Back-compatible flat view over the profiles, used by `set_wifi.py`, `wifi_probe.py`,
`wifi_diag.py` and `otter_main.py`.

**Parameters**:

- `file_path` (str): Path to settings file (default: `'/wifi_settings.json'`)
- `require_station_credentials` (bool): Enforce SSID/password for the station profile
  (default: `True`). With `False` the station profile is not validated at all, so status tooling
  can still read a half-configured document.

**Returns**: Dictionary with keys:

- `ssid` (str): SSID of the primary profile (station when enabled, otherwise the access point)
- `password` (str): Password of the primary profile
- `mode` (str): `'sta'` or `'ap'` - the primary profile, never `'both'`/`'none'`
- `enabled` (bool): Whether **any** profile is enabled
- `modes` (list): Enabled modes in `("sta", "ap")` order
- `profiles` (dict): The full per-mode profiles (same shape as `load_wifi_profiles()`)

**Raises**:

- `WifiSettingsError`: If the file is missing/invalid, an enabled profile fails validation, or
  `require_station_credentials` is `True` while the station profile is enabled without an SSID

**Example**:

```python
from tools.wifi_manager import load_wifi_settings

settings = load_wifi_settings()
print(f"Mode: {settings['mode']}, SSID: {settings['ssid']}, modes: {settings['modes']}")
```

---

#### `save_wifi_settings(ssid, password, mode='sta', *, enabled=True, file_path=WIFI_SETTINGS_FILE) -> dict`

Back-compatible single-profile writer (used by `set_wifi.py`). It normalizes `mode` to `'sta'` or
`'ap'`, writes only that profile through `save_wifi_profiles()`, and therefore **leaves the other
mode's credentials untouched**. The access-point password rule (empty or >= 8 characters) is still
enforced by `_validate_profile()`.

**Parameters**:

- `ssid` (str): Network SSID
- `password` (str): Network password
- `mode` (str): `'sta'` or `'ap'` (default: `'sta'`)
- `enabled` (bool): Enable this profile (default: `True`)
- `file_path` (str): Path to settings file (default: `'/wifi_settings.json'`)

**Returns**: The merged profile mapping that was written.

**Raises**:

- `WifiSettingsError`: If mode is invalid, credentials are incomplete for an enabled profile, or
  the access-point password is shorter than 8 characters

**Example**:

```python
from tools.wifi_manager import save_wifi_settings

save_wifi_settings('MyNetwork', 'password123', mode='sta', enabled=True)
```

---

#### `maybe_create_interface(mode: str) -> network.WLAN | None`

Create WiFi interface if available on device.

**Parameters**:

- `mode` (str): `'sta'` (station) or `'ap'` (access point)

**Returns**: `network.WLAN` instance or `None` if unavailable

**Example**:

```python
from tools.wifi_manager import maybe_create_interface

sta_if = maybe_create_interface('sta')
if sta_if:
    print('Station interface available')
else:
    print('Station interface not supported')
```

---

#### `wifi_status_snapshot(file_path=WIFI_SETTINGS_FILE) -> dict`

Get the status of **both** WiFi interfaces plus the stored profiles.

**Returns**: Dictionary with keys:

- `enabled` (bool): Whether any profile is enabled
- `modes` (list): Enabled modes in `("sta", "ap")` order
- `mode` (str): Primary profile (`'sta'` or `'ap'`)
- `ssid` (str): SSID of the primary profile
- `ip` (str): IP address of the primary interface
- `active` / `connected` (bool): State of the primary interface
- `status_code` / `status_label` (int / str): Station status (`'got-ip'`, `'connecting'`, ...);
  for the access point `status_label` is `'active'`, `'starting'` or `'inactive'`
- `searching` (bool): Station-only - the station is up but has not obtained an IP yet
- `profiles` (dict): Stored profiles (same shape as `load_wifi_profiles()`)
- `sta` / `ap` (dict): Per-interface view,
  `{enabled, active, connected, ip, ssid, status_code, status_label}`
- `error` (str): Present only when the settings file is invalid or an interface is unavailable

The top-level legacy keys mirror the **station** interface when its profile is enabled (otherwise the
access point), so `wifi_probe._station_should_retry()` keeps working. No `network.WLAN` object is
constructed while both profiles are disabled.

**Example**:

```python
from tools.wifi_manager import wifi_status_snapshot

status = wifi_status_snapshot()
print(f"STA: {status['sta']['ip']} | AP: {status['ap']['ip']} ({status['ap']['status_label']})")
```

---

#### `write_wifi_status_json(file_path=WIFI_SETTINGS_FILE) -> None`

Print the JSON payload of `wifi_status_snapshot()` to stdout (the raw-REPL friendly output used by
`wifi_probe.py` and the device tooling).

**Example**:

```python
from tools.wifi_manager import write_wifi_status_json

write_wifi_status_json()
```

---

#### `async connect_station(sta_if, ssid: str, password: str, status_callback=None) -> dict`

Connect to WiFi network in station mode (async).

**Parameters**:

- `sta_if` (network.WLAN): Station interface (from `maybe_create_interface('sta')`)
- `ssid` (str): Network SSID
- `password` (str): Network password
- `status_callback` (callable, optional): Status update callback `fn(state: str, **fields)`

**Returns**: Dictionary with connection info:

- `ip` (str): Assigned IP address
- `netmask` (str): Network mask
- `gateway` (str): Gateway address
- `dns` (str): DNS server

**Raises**:

- `WifiUnavailableError`: If interface is `None`

**Timeout**: 20 seconds (`STATION_CONNECT_TIMEOUT_MS`, default; overridable via the `timeout_ms`
argument)

**Example**:

```python
import uasyncio as asyncio
from tools.wifi_manager import maybe_create_interface, connect_station

async def connect():
    sta_if = maybe_create_interface('sta')
    ipconfig = await connect_station(sta_if, 'MySSID', 'password123')
    print(f"Connected: {ipconfig['ip']}")

asyncio.run(connect())
```

---

#### `async start_access_point(ap_if, ssid: str, password: str, status_callback=None) -> dict`

Start WiFi access point (async).

**Parameters**:

- `ap_if` (network.WLAN): AP interface (from `maybe_create_interface('ap')`)
- `ssid` (str): Network SSID
- `password` (str): Network password (min 8 chars or empty for open AP)
- `status_callback` (callable, optional): Status update callback

**Returns**: Dictionary with AP configuration

**Raises**:

- `WifiUnavailableError`: If interface is `None`

**Example**:

```python
import uasyncio as asyncio
from tools.wifi_manager import maybe_create_interface, start_access_point

async def start_ap():
    ap_if = maybe_create_interface('ap')
    config = await start_access_point(ap_if, 'MicroOtter-AP', 'password123')
    print(f"AP started: {config}")

asyncio.run(start_ap())
```

---

## runtime_info.py

Runtime introspection for device capabilities.

### Functions

#### `print_runtime_metadata() -> None`

Print MicroPython runtime metadata to stdout (one line per field).

**Output Format** (3 lines):

```
micropython
1.26.0
esp32
```

**Fields**:

1. Implementation name (e.g., `micropython`)
2. Version string (e.g., `1.26.0`)
3. Platform (e.g., `esp32`)

**Example**:

```python
from tools.runtime_info import print_runtime_metadata

print_runtime_metadata()
# Output:
# micropython
# 1.26.0
# esp32
```

**Usage in Deployment**:

```ts
// TypeScript (host-side)
const command = `
from tools.runtime_info import print_runtime_metadata
print_runtime_metadata()
`.trim();

const output = await deviceConnection.executeCode(command);
const [name, version, platform] = output.trim().split('\n');
console.log(`Runtime: ${name} ${version} on ${platform}`);
```

---

## runtime_log.py

Structured JSON logging for device events.

### Log Format

All log functions emit JSON to stdout with prefix `[otter]`:

```
[otter] {"event": "startup", "phase": "wifi", "ts_ms": 12345, "level": "info"}
```

`print()` calls elsewhere in the runtime write plain, human-readable lines whose first
token is a level tag the web UI turns into a filter:

```
[error] controller: main loop load failed; the app did not start (SyntaxError: invalid syntax)
```

The accepted tags are `system`, `otter`, `info`, `warning`, `error`, `success` and
`data` (plus `user` for output produced by the collection itself); anything untagged
ends up in the `raw` view. Use `log_plain()` (see below) for editor-facing one-liners
and the JSON functions for everything a tool should parse. A failure that stops a
subsystem from working **must** produce a plain line as well: JSON events land in the
generic `otter` filter and are unreadable at a glance.

The full taxonomy, the rules for choosing a tag and the list of declarations that have
to stay in sync are in
[log-prefix-conventions.md](log-prefix-conventions.md); `tests/test_log_prefix_contract.py`
fails the build when device code uses a tag outside it.

### Functions

#### `log_event(event: str, **fields) -> None`

Log generic event with custom fields.

**Parameters**:

- `event` (str): Event type identifier
- `**fields`: Additional key-value pairs

**Auto-Added Fields**:

- `ts_ms` (int): Timestamp in milliseconds
- `level` (str): Log level (default: `'info'`)

**Example**:

```python
from tools.runtime_log import log_event

log_event('user-action', action='button-press', button_id=5)
# Output: [otter] {"event": "user-action", "action": "button-press", "button_id": 5, "ts_ms": 12345, "level": "info"}
```

---

#### `log_message(message: str, **fields) -> None`

Log text message.

**Parameters**:

- `message` (str): Message text
- `**fields`: Additional key-value pairs

**Example**:

```python
from tools.runtime_log import log_message

log_message('Device initialized successfully', device_id='esp32-001')
# Output: [otter] {"event": "message", "message": "Device initialized successfully", "device_id": "esp32-001", ...}
```

---

#### `log_startup(phase: str, **fields) -> None`

Log startup event.

**Parameters**:

- `phase` (str): Startup phase identifier (e.g., `'wifi'`, `'init'`, `'ready'`)
- `**fields`: Additional key-value pairs

**Example**:

```python
from tools.runtime_log import log_startup

log_startup('wifi', mode='sta', ssid='MyNetwork')
# Output: [otter] {"event": "startup", "phase": "wifi", "mode": "sta", "ssid": "MyNetwork", ...}
```

---

#### `log_wifi_state(state: str, **fields) -> None`

Log WiFi state change.

**Parameters**:

- `state` (str): WiFi state (e.g., `'connecting'`, `'connected'`, `'disconnected'`)
- `**fields`: Additional key-value pairs

**Example**:

```python
from tools.runtime_log import log_wifi_state

log_wifi_state('connected', ip='192.168.1.100', ssid='MyNetwork')
# Output: [otter] {"event": "wifi", "state": "connected", "ip": "192.168.1.100", ...}
```

---

#### `log_error(message: str, **fields) -> None`

Log error message.

**Parameters**:

- `message` (str): Error message
- `**fields`: Additional key-value pairs

**Auto-Set**:

- `level`: `'error'` (overrides default)

**Example**:

```python
from tools.runtime_log import log_error

log_error('Failed to connect to WiFi', ssid='MyNetwork', reason='timeout')
# Output: [otter] {"event": "error", "message": "Failed to connect to WiFi", "level": "error", ...}
```

---

#### `log_exception(event: str, exc: BaseException, **fields) -> None`

Log exception with traceback.

**Parameters**:

- `event` (str): Event type identifier
- `exc` (BaseException): Exception instance
- `**fields`: Additional key-value pairs

**Auto-Added Fields**:

- `message` (str): Exception message (`str(exc)`)
- `exception` (str): Collapsed traceback (newlines replaced with `<<NL>>`)
- `level` (str): `'error'` (default)

**Example**:

```python
from tools.runtime_log import log_exception

try:
    result = 1 / 0
except ZeroDivisionError as e:
    log_exception('calculation-error', e, operation='divide')
# Output: [otter] {"event": "calculation-error", "message": "division by zero", "exception": "Traceback...<<NL>>...", ...}
```

---

#### `log_plain(level: str, source: str, message: str) -> None`

Print one short `[level] source: message` line, so a swallowed failure is visible in the
serial console and under the matching filter in the device log.

**Parameters**:

- `level` (str): One of `system`, `otter`, `info`, `warning`, `error`, `success`, `data`
- `source` (str): Subsystem tag, e.g. `controller`, `service-controller`, `mqtt`
- `message` (str): Single-line description; keep it short, the detail belongs in a JSON event

Errors are swallowed on purpose: logging must never take the runtime down.

**Example**:

```python
from tools.runtime_log import log_exception, log_plain

try:
    module = reload_module('app.main_loop')
except BaseException as exc:
    log_plain('error', 'controller', 'main loop load failed; the app did not start')
    log_exception('controller-main-loop-load-failed', exc, module='app.main_loop')
# Output: [error] controller: main loop load failed; the app did not start
#         [otter] {"event": "controller-main-loop-load-failed", "level": "error", "exception": "SyntaxError: invalid syntax", ...}
```

---

#### `describe_exception(exc: BaseException, limit: int = 200) -> str`

Return a single-line, length-limited `Type: message` description of an exception, ready
for `log_plain()`. Newlines and carriage returns collapse to spaces and long text is cut
to `limit` characters with a trailing `...`.

**Example**:

```python
from tools.runtime_log import describe_exception

describe_exception(SyntaxError('invalid syntax'))
# 'SyntaxError: invalid syntax'
```

---

## set_wifi.py

CLI utility for persisting WiFi credentials.

### Functions

#### `set_wifi(ssid: str, password: str, mode: str = 'sta', enabled: bool = True) -> None`

Persist the credentials of a single WiFi profile and print a confirmation. It calls
`wifi_manager.save_wifi_settings()`, which writes only the selected profile - the other mode's
credentials and `enabled` flag stay untouched, so the access point can be configured without
losing the station network (and vice versa).

**Parameters**:

- `ssid` (str): Network SSID
- `password` (str): Network password
- `mode` (str): `'sta'` or `'ap'` (default: `'sta'`)
- `enabled` (bool): Enable this profile (default: `True`)

**Output**: Prints confirmation message to stdout

**Example (Device REPL)**:

```python
>>> import set_wifi
>>> set_wifi.set_wifi('MyNetwork', 'password123', 'sta', enabled=True)
WiFi settings saved successfully.
Mode: sta
SSID: MyNetwork
Enabled: True
Restart the device for changes to take effect.
```

**Example (Via mpremote)**:

```bash
mpremote exec "import set_wifi; set_wifi.set_wifi('MySSID', 'password', 'sta')"
```

---

## wifi_probe.py

WiFi status inspection with auto-reconnect.

### Functions

#### `ensure_wifi_status(auto_connect: bool = True) -> dict`

Get WiFi status and optionally attempt reconnection.

**Parameters**:

- `auto_connect` (bool): Attempt reconnection if disconnected (default: `True`)

**Returns**: Dictionary with WiFi status (same as `wifi_status_snapshot()`)

**Behavior**:

- Loads the back-compatible flat settings view (station profile as the primary profile)
- Checks current status
- If `auto_connect=True`, the station profile is enabled and has credentials, and the station is
  idle, attempts reconnection
- Returns final status

**Note**: reconnection is only attempted for the station profile; when the device runs AP-only the
snapshot is returned unchanged.

**Example**:

```python
from tools.wifi_probe import ensure_wifi_status

status = ensure_wifi_status(auto_connect=True)
if status['status_label'] == 'got-ip':
    print(f"Connected: {status['ip']}")
else:
    print(f"Status: {status['status_label']}")
```

---

## wifi_diag.py

Diagnostic script for WiFi troubleshooting (standalone).

### Functions

#### `main() -> None`

Run comprehensive WiFi diagnostics and print results.

**Output**:

- WiFi settings file status
- Interface availability (STA and AP)
- Current WiFi status
- Network scan results (if available)

**Example (Device REPL)**:

```python
>>> import wifi_diag
>>> wifi_diag.main()
=== WiFi Diagnostics ===

WiFi Settings:
  File: wifi_settings.json
  Mode: sta
  SSID: MyNetwork
  Enabled: True

Station Interface: Available
AP Interface: Available

Current Status:
  Status: got-ip
  IP: 192.168.1.100
  ...
```

**Example (Via mpremote)**:

```bash
mpremote exec "import wifi_diag; wifi_diag.main()"
```

---

## wifi_boot.py (runtime)

`src/micro_otter/nodes/device/runtime/general/otter_runtime/wifi_boot.py` is the **single place where
boot-time WiFi bring-up happens**. `otter_main.main()` only loads the profiles
(`tools.wifi_manager.load_wifi_profiles()`), logs the result and wires the supervisor; all interface
handling lives here. The module depends on `tools.wifi_manager` only, so it is unit-testable on the
host (`tests/test_wifi_boot.py`).

Constants:

- `WIFI_STA_RETRY_INTERVAL_MS = 30000` - supervisor retry interval
- `WIFI_STA_RETRY_LOG_EVERY = 10` - failure logging throttle

#### `async bring_up_wifi(profiles, *, status_callback=None) -> dict`

Bring up exactly the interfaces the profiles ask for: **access point first** (reachable in about a
second, keeps the device administrable while the station connects), then the station.

**Returns**: Dict with keys

- `sta_enabled`, `ap_enabled` (bool): the requested profiles
- `sta_ssid`, `sta_password`, `ap_ssid`, `ap_password` (str): credentials carried for the supervisor
- `sta_connected`, `sta_ip`, `sta_interface`: station outcome (interface kept for reconnects)
- `ap_active`, `ap_ip`, `ap_interface`: access-point outcome
- `host_ip` (str): station IP when connected, else the AP IP, else `'0.0.0.0'`
- `retry_count` (int): incremented by the supervisor
- `errors` (dict): `{"sta": str|None, "ap": str|None}`

`sta_connected` can still become `True` **after** bring-up returns: while
`_RETURN_BEFORE_STATION_CONNECT` is on, `bring_up_wifi()` deliberately returns before the station
connect and the supervisor finishes the job on the same dict.

The result is **transport facts only** — it no longer computes an `enable_server` flag; service
enablement is the network-service controller's concern.

Failures never raise. **There is no AP fallback**: a failed station connect only records
`errors["sta"]` and leaves the retrying to the supervisor. Enabling both profiles is the intended
APSTA mode: one radio, two interfaces, two IPs, no NAT (the AP is not stopped when the station
connects).

#### `async station_supervisor(result, *, on_late_connect=None, on_transport_down=None, retry_interval_ms=WIFI_STA_RETRY_INTERVAL_MS, status_callback=None)`

Keep a failed station connection retrying in the background.

- Returns immediately when `result["sta_enabled"]` is false or no station interface exists.
- Healthy link (`result["sta_connected"]` and the interface still reports connected) → sleep one
  interval, never re-run `connect_station`.
- A connected→disconnected transition is detected as a **station link drop**: `sta_connected` is
  cleared, `host_ip` reverts to the AP IP (or `'0.0.0.0'`), `station-link-down` is emitted, and
  `on_transport_down()` is awaited once before the reconnect attempt.
- Otherwise run `connect_station()`; failures emit a `retry-failed` event **only on attempt 1 and
  every 10th attempt** (`WIFI_STA_RETRY_LOG_EVERY`) and the loop continues.
- An interface that is **already connected** while `result["sta_connected"]` is still false (soft
  reset / reload, where the radio was never torn down) is **adopted** instead of ignored: `sta_ip`
  and `host_ip` are read from the live interface via `_station_ip()` (falling back to `'0.0.0.0'`
  when `ifconfig()` raises), `errors["sta"]` is cleared, `wifi-boot: station already connected,
  adopted ip=…` is logged, `station-late-connect` is emitted and `on_late_connect(ip)` is awaited
  once. No `connect_station()` round trip happens and `retry_count` stays untouched. This is what
  keeps an MQTT link alive across a soft reset: without the adoption the transport facts would stay
  `False`, and the service controller would stop every station-only service on its next resync tick.
- On a late success (boot or after a drop): sets `sta_connected`/`sta_ip`/`host_ip`, clears
  `errors["sta"]`, emits `station-late-connect` and awaits `on_late_connect(ip)` once. Supervision
  continues afterwards, so a dropped link is re-established without a reboot.
- The reconnect path and the adoption path share one tail, `async
  _record_station_connected(result, station_ip, *, on_late_connect, status_callback)`, so the
  transport facts, the status event and the callback cannot drift apart.
- The loop body is wrapped in `try/except BaseException` and always sleeps at the end, so the task can
  never die and never busy-loops. `otter_main` keeps the task referenced in
  `_RUNTIME_BACKGROUND_TASKS` (MicroPython drops unreferenced tasks). The configured `retry_interval_ms`
  comes from `wifi_settings.json` (`load_wifi_reconnect_interval()`, seconds × 1000), not the
  `WIFI_STA_RETRY_INTERVAL_MS` default.

Late-connect / link-drop wiring in `otter_main`: both callbacks re-derive the transport facts from the
(mutated) `boot` result and call `controller.sync(network)`, so enabled services start/stop with the
link; the controller also re-syncs periodically (see `network-services.md`).

---

## Deployment

### Manifest

**File**: `tools/manifest.json`

```json
{
    "files": [
        "tools/__init__.py",
        "tools/wifi_manager.py",
        "tools/fs_utils.py",
        "tools/runtime_info.py",
        "tools/runtime_log.py",
        "tools/set_wifi.py",
        "tools/wifi_probe.py",
        "tools/wifi_diag.py"
    ]
}
```

### Upload Process

1. Host fetches tools manifest
2. Host calculates SHA-256 hashes for all tools files
3. Host loads centralized sync manifest from device (`/.micro-otter-sync-manifest`)
4. Host compares hashes and uploads only changed files
5. Host saves updated centralized sync manifest to device

**Performance**:

- First deployment: All files uploaded (~5 seconds)
- Subsequent deployments: Only changed files uploaded
- Unchanged deployment: No tools files uploaded (<1 second overhead)

### Hash Manifest

**File**: `/.micro-otter-sync-manifest` (auto-generated on device)

**Format**:

```json
{
    "version": "1.0.0",
    "created": "2026-04-18T00:00:00.000Z",
    "updated": "2026-04-18T00:00:00.000Z",
    "tools": {
        "files": {
            "tools/__init__.py": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            "tools/fs_utils.py": "abc123...",
            "tools/wifi_manager.py": "def456..."
        }
    }
}
```

**Purpose**: Enable incremental updates by comparing host and device file versions
across runtime, tools, and collection sections in one manifest.

---

## Usage Examples

### Example 1: WiFi Connection Workflow

```python
import uasyncio as asyncio
from tools.wifi_manager import (
    load_wifi_settings,
    maybe_create_interface,
    connect_station
)
from tools.runtime_log import log_startup, log_wifi_state, log_error

async def main():
    log_startup('wifi-init')

    try:
        # Load settings
        settings = load_wifi_settings()
        log_startup('settings-loaded', mode=settings['mode'], ssid=settings['ssid'])

        # Create interface
        sta_if = maybe_create_interface('sta')
        if not sta_if:
            log_error('Station interface unavailable')
            return

        # Connect
        log_wifi_state('connecting', ssid=settings['ssid'])
        ipconfig = await connect_station(sta_if, settings['ssid'], settings['password'])
        log_wifi_state('connected', ip=ipconfig['ip'], ssid=settings['ssid'])

    except Exception as e:
        log_error('WiFi connection failed', error=str(e))

asyncio.run(main())
```

---

### Example 2: File Upload Handler

```python
from tools.fs_utils import ensure_dirs, reset_file, append_base64_chunk

def handle_file_upload(path, chunks):
    """Upload file in base64 chunks."""
    # Ensure parent directory exists
    ensure_dirs('/'.join(path.split('/')[:-1]))

    # Create empty file
    reset_file(path)

    # Append chunks
    for chunk in chunks:
        append_base64_chunk(path, chunk)

    print(f'File uploaded: {path}')

# Example usage
handle_file_upload('app/user_script.py', [
    'ZGVmIG1haW4oKToK',  # def main():
    'ICAgIHBhc3MK'      #     pass
])
```

---

### Example 3: Deployment Hash Check

```python
from tools.fs_utils import path_exists, read_file
import ujson as json

def check_deployment_status():
    """Check if tools are deployed and up-to-date."""
    if not path_exists('.micro-otter-sync-manifest'):
        print('Tools not deployed (no sync manifest)')
        return False

    manifest = json.loads(read_file('.micro-otter-sync-manifest'))
    tool_files = ((manifest.get('tools') or {}).get('files') or {})
    print(f'Tools deployed: {len(tool_files)} files')
    for file, hash_val in tool_files.items():
        print(f'  {file}: {hash_val[:8]}...')

    return True

check_deployment_status()
```

---

## Related Documentation

- [Device Folder Structure](device-folder-structure.md) - Complete device filesystem layout
- [Tools Integration Plan](../../ldev/todos/deployment/tools-folder-integration-plan.md) - Implementation plan
- [Deployment System Architecture](deployment-system-architecture.md) - Overall deployment design
- [MicroPython Protocol](micropython-protocol.md) - WebSerial communication patterns

---

## Notes

### MicroPython Compatibility

All tools modules are designed for MicroPython 1.26+ on ESP32:

- Use `ujson` instead of `json`
- Use `uasyncio` instead of `asyncio`
- Use `uos` instead of `os`
- Use `ubinascii` for base64 operations

### Error Handling

Tools modules follow defensive programming:

- Normalize paths before filesystem operations
- Validate inputs before processing
- Return empty/None on errors where appropriate
- Raise specific exceptions for invalid inputs

### Performance Considerations

- `read_file()`: Reads entire file into memory (suitable for config files, not large binaries)
- `append_base64_chunk()`: Efficient for chunked uploads
- `wipe_filesystem()`: Can be slow on large filesystems (use excludes list)
- WiFi operations: Timeout defaults to 15 seconds (configurable in wifi_manager)

---

**End of Device Tools Reference**
