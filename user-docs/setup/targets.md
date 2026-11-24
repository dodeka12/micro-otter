# Targets

A target is the capability map of one board family: which pins exist, what each pin can do, how many
PWM, ADC, DAC, touch, UART, I²C, SPI and I²S resources the chip has, and what the CPU can do with
floats. Node pin pickers and the deploy-time capability check both read this map.

## Shipped targets

| Target id | Shown as | What it is | Runtime mode |
|---|---|---|---|
| `esp32_wroom` | ESP32-WROOM | classic ESP32 module, 32 pins mapped | embedded |
| `esp32_s2` | ESP32-S2 | ESP32-S2 chip, 43 pins mapped | embedded |
| `esp32_s3` | ESP32-S3 | chip-level map for the ESP32-S3 (quad PSRAM), 45 pins mapped | embedded |
| `esp32_s3_mini` | ESP32-S3 Mini | derived from `esp32_s3` (FH4R2 module: 4 MB flash + 2 MB PSRAM): pins, resources and capabilities are inherited, one note is appended to the inherited notes | embedded |
| `generic_micropython` | Generic | open pin set: any pin 0–255 may be selected for any function, capability validation is bypassed | dynamic |

New collections start on `generic_micropython`. It is a convenience for boards the app has no pin map
for, so nothing is checked against it — the pin you pick is your responsibility. It is also the one
target you cannot build a firmware image for: the build target dropdown leaves it out, because no
concrete board is compiled for it.

## Resources

| Target | PWM | ADC | DAC | Touch | UART | I²C | SPI | I²S |
|---|---|---|---|---|---|---|---|---|
| `esp32_wroom` | 16 ch / 8 timers | 2 units (8 + 10 ch) | 2 ch | 10 ch | 3 | 2 | 2 | 2 |
| `esp32_s2` | 8 ch / 4 timers | 2 units × 10 ch | 2 ch | 14 ch | 2 | 2 | 2 | 1 |
| `esp32_s3` | 8 ch / 4 timers | 2 units × 10 ch | — | 14 ch | 3 | 2 | 2 | 2 |
| `esp32_s3_mini` | as `esp32_s3` | as `esp32_s3` | — | as `esp32_s3` | as `esp32_s3` | as `esp32_s3` | as `esp32_s3` | as `esp32_s3` |

Analog input is available on all three chips (`supportsAnalog`), and ADC unit 2 is unusable while WiFi is
active on every ESP32 target. The ESP32-S3 family has no DAC, so a `dac-output` node fails the
capability check there; it passes on `esp32_wroom` (GPIO25/26) and `esp32_s2` (GPIO17/18). On
`generic_micropython` nothing is checked, so a DAC node is accepted whatever the board really has.

## CPU and radio

| Target | WiFi | Bluetooth | Cores / threading |
|---|---|---|---|
| `esp32_wroom` | yes, generation not declared | yes, version not declared | not declared |
| `esp32_s2` | WiFi 4 | — | 1 core, no threading, async |
| `esp32_s3` | WiFi 6 | BLE 5 | 2 cores, threading, async |
| `esp32_s3_mini` | as `esp32_s3` | as `esp32_s3` | as `esp32_s3` |
| `generic_micropython` | — | — | not declared |

All three ESP32 chips declare Viper code, single-precision floats in hardware, double-precision floats
in software and 32-bit integers; complex numbers are not supported on any target. Core count,
threading and async support are declared by `esp32_s2` and `esp32_s3` only — `esp32_s3_mini` inherits
them from its base, and `esp32_wroom` leaves them undeclared. The generic target declares software
floating point and no radio, and leaves Viper undeclared; a capability that is not declared counts as
missing, so a Viper requirement fails there.

The **Target Config** tab lists every pin of the selected target, one row per pin, plus the resource
totals and the general capabilities. See [Settings view](../app/settings-view.md) for that tab.

## Pick a target for a device

The device target is asked for once — while the runtime is installed for the first time. Installing the
runtime again on a device that already has a target reuses it without asking.

1. Connect the board and open the **Deploy** view.
2. Click **Install Runtime**.
3. The **Select Device Target** dialog opens: choose the board from the **Device Target** dropdown.
4. Read the **Target Description** (it updates as you change the selection) and optionally add your own
   note in **Your Description (Optional)**, for example which pin is broken on that particular board.
5. Confirm with **Continue**. **Cancel** aborts the installation before anything is written, with
   *"Target selection was cancelled. Runtime installation aborted."*

The app writes the choice to the device at `/device/targets/active_target.json`. Only the app writes
that file — a freshly flashed board has none, and that is normal.

## Change the target

| You want to change | Where |
|---|---|
| the target a collection is built for | **Settings** → **Collection** → **Target Device** |
| the target stored on the connected device | **Deploy** view toolbar → **Edit Device Target** |
| the note stored with the device target | same dialog, **Your Description (Optional)** |

**Edit Device Target** reopens the same dialog with the current target pre-selected and rewrites the
device file. It needs a connected device with a detected runtime; otherwise it fails with *"Device not
connected"* or *"No runtime available for target selection"*.

The collection's target must be exactly the target the device holds. Deploy is refused with
`Collection target '<a>' does not match device target '<b>'`, and the error details repeat the
collection target, the device target and two ways out: use a device with the matching target, or
upload a derived target config that matches the device. Changing either side makes the two agree.

## Only targets the firmware can run are offered

Each firmware image records the board family it was built for, and the target dropdown is filtered to
targets whose build base matches it:

- A target from another family is not listed at all.
- A target already stored on the device from another family is not adopted.
- A target stored without pin information (an old bootstrap skeleton) is kept only as a pre-fill hint,
  and the app asks you to select a target again.

While a board with recorded image identity is connected, a collection's **Target Device** dropdown is
filtered the same way.

Messages you may see when the image and the target do not agree:

> **Target '&lt;id&gt;' cannot run on the connected device's firmware.** Choose a target from the same
> board family, or flash firmware built for this target.

> **The target stored on this device does not match its firmware.** Select a target from the same
> board family.

> **No device targets available for selection** — the image was built for a board the app ships no
> target for.

## Capability checks

Two checks run against the target:

| When | What it does |
|---|---|
| while you edit a graph | the node is drawn with a red border and the offending control is outlined; hovering the node lists every message, e.g. `Missing required capability: dac` |
| on deploy | the deploy stops and lists `Missing required capability for <node type>: <capability>` for every offending node |

When the target has no pin for a capability at all, the per-pin messages are dropped: the node-level
"missing required capability" line already says everything there is to say.

Fixes: pick a pin that has the capability, choose a target that has it, or replace the node. For analog
output on an ESP32-S3, use LEDC PWM with an RC low-pass filter or an external I²C/SPI/I²S DAC.

## Import your own target

A user target is a *derived* target: a shipped base plus sparse overrides. Import one from the
workspace menu (☰ in the title bar) → **Target Config** → **Upload Target Config**.

1. Download the shape first: **Download Target Config Template** saves
   `micro-otter-target-config-template-<yyyymmdd>.jsonc`.
2. Give it a new `id` and `displayName`, and set `baseTargetId` to a shipped target such as
   `esp32_wroom`.
3. Copy the same `id` into `targetData` — the downloaded template leaves it out. The loader reads the
   target id from the payload (`targetData.id` or `targetData.targetId`), so a file that names the
   target only at the top level is rejected with *"Target config payload is missing target id."*
4. Put only the differences into `targetData`. In `pinCapabilities`, `null` removes a pin from the base
   map:

    ```json
    {
        "id": "my_esp32_wroom",
        "displayName": "My ESP32-WROOM",
        "version": "1.0.0",
        "created": "2026-01-01",
        "baseTargetId": "esp32_wroom",
        "targetData": {
            "id": "my_esp32_wroom",
            "pinCapabilities": { "5": null },
            "metadata": { "notes": ["Pin 5 removed."] }
        }
    }
    ```

5. Upload the file (`.json` and `.jsonc` are both accepted; comments are ignored). The upload reports
   **Target Config Uploaded** with the new target id, and the target is available for selection
   immediately.

`version` must be `x.y.z` and `created` must be a parseable date such as `2026-01-01`; both are
required. `displayName` is optional — the payload's own name, or the id, is used instead. A file with
no `targetData` object is read as the payload itself: the whole file becomes the override, and the
version and date default to `1.0.0` and today. Either way the payload must carry an id.

How `targetData` is merged onto the base:

- plain values replace the base value;
- `pinCapabilities` merges pin by pin, and `null` deletes a pin;
- `resources`, `generalCapabilities` and `capabilityToPins` merge key by key, the override winning;
- `metadata` merges key by key, and `metadata.notes` is appended to the base's notes;
- `openPins` cannot be changed by an override — the base's pin range, if any, is inherited.

If the id or the display name is already taken, **Target Config Conflict** shows the incoming and the
existing target and asks whether to **Overwrite**; declining leaves the stored target untouched.

| Rule | Rejection message |
|---|---|
| `baseTargetId` must name a shipped target | *"Target config base '&lt;id&gt;' is not a shipped target."* |
| a base cannot itself be a user target | *"Target config base '&lt;id&gt;' is itself a user target; a base must be a shipped target."* |
| a user target cannot declare `openPins` | *"User target configs cannot declare openPins; upload a specific capability map instead."* |
| the removed `metadata.isCustomTarget` flag is rejected | *"The Custom target is removed; import a derived target (baseTargetId + overrides) instead."* |
| the payload must carry a target id | *"Target config payload is missing target id."* |
| the top-level `id` must match the payload id | *"Target config id '&lt;a&gt;' does not match payload id '&lt;b&gt;'."* |
| an id may not shadow a shipped target | *"Target config '&lt;id&gt;' conflicts with a runtime-shipped target id."* |

Imported targets join the **Target Device** dropdown of a collection and the device selection dialog
like shipped ones, and they still have to belong to the flashed image's board family. The other
**Target Config** menu items download the active collection's target as a full map
(`micro-otter-target-config-<id>-<yyyymmdd>.json`) and back up or restore the user target database.

## Related

- [Connect a device](connect.md) — the connection dialog
- [Deploy view](../app/deploy-view.md) — install runtime, deploy, sync
- [Settings view](../app/settings-view.md) — Collection settings and the Target Config tab
