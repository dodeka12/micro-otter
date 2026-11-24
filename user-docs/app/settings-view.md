# Settings view

The Settings tab configures the workspace and the active collection, and the Target Config tab reports
what the selected target offers.

## Settings tab

The tab stacks three collapsible sections — General Settings, Collection Settings and Graph Settings —
all open by default.

### General Settings

| Setting | Effect |
|---|---|
| Theme | switches the editor theme immediately; shipped themes: Standard Compact Dark |
| Language | switches the interface language immediately; English or Deutsch |

Both values are stored in the browser workspace and restored on the next visit.

### Collection Settings

These apply to the active collection.

| Setting | Effect |
|---|---|
| Collection Name | the collection title; committed with Enter or when the field loses focus, a blank name is reverted |
| Runtime | the runtime profile the collection is built against |
| Target Device | the board the collection is built for; the list follows the selected runtime |
| Web Asset Format | Compressed (`.gz`) or Plain text for generated web assets |
| Collection Version | read-only; the version the collection is currently at |

Changing the runtime rebuilds the target list. When the current target is not offered by the new
runtime, the first target of that runtime is selected instead.

The title bar shows the same runtime, target and version; see [The app](index.md).

### Graph Settings

These apply to the graph in the active tab.

| Setting | Effect |
|---|---|
| Enabled | unticked graphs stay in the tab strip but are skipped by code generation |
| Name | the graph name; must be unique inside the collection |
| Execution Type | Startup, Loop, Interrupt, Event or Function |

The remaining rows depend on the execution type.

| Execution type | Extra settings |
|---|---|
| Startup | — (runs once at boot) |
| Loop | Interval (ms); `0` yields without waiting |
| Interrupt | Interrupt — a trigger name taken from the interrupt-capable nodes in the collection |
| Event | Signals, Trigger mode (Any / All), Run once at startup |
| Function | Category, Icon, Description, Inputs, Outputs |

- **Signals** lists the signal names that `signal-post` nodes declare in the collection. An event graph
  with no signal shows an error, and a selected name that no node produces any more is marked with a
  warning so you can remove it.
- **Any** runs the graph when one watched signal fires; **All** needs every watched signal to have
  fired since the last run.
- **Function** describes the callable node the graph becomes: its palette category, an MDI icon
  (`mdi:…`), a description, and its input and output ports. Each port has a name, the data types it
  accepts (`Any` accepts everything), an optional default value with Min/Max/Step for numbers, and its
  own documentation. Ports can be reordered and deleted; the list stops adding ports at its limit.

The graph toolbar in the graph panel edits the same values; see [Graph panel](graph-panel.md).

## Target Config tab

This tab is read-only reference data for the target picked in Collection Settings, with a single
**Refresh** button. Without a target it says `No target selected`.

| Section | Content |
|---|---|
| Target Header | target display name and the firmware target line |
| General Capabilities | Wi-Fi and Bluetooth status, notes, other capability flags |
| Pin Capability Icon Legend | what each capability icon means; collapsed by default |
| Hardware Resources | resource limits of the target |
| Capabilities Per Pin | per-pin capability icons and pin notes |
| Capability to Pins | the pins that provide each capability |

The firmware target line reads `Firmware target: <board> (port: <port>)` when the target maps to a
compile target, and `Firmware target: any board (not specific)` when it does not.

| Capability | Meaning |
|---|---|
| Digital I/O, Digital Input, Digital Output | general-purpose pin use in either direction |
| Interrupt (IRQ) | pin can raise an interrupt |
| PWM I/O, PWM Input, PWM Output | pulse-width modulation |
| Pull Up/Down, Pull Up, Pull Down | internal pull resistors |
| ADC | analog input |
| DAC | analog output |
| Touch | capacitive touch input |
| SPI, SPI MISO, SPI MOSI, SPI SCK, SPI CS | SPI bus roles |
| I2C, I2C SDA, I2C SCL | I2C bus roles |
| UART / Serial, Serial RX, Serial TX | serial port roles |
| I2S, I2S Data Out, I2S Data In, I2S Bit Clock, I2S Word Select, I2S Master Clock | I2S bus roles |
| RTC GPIO | pin usable by the low-power/RTC domain |

## Related

- [The app](index.md) — title-bar shortcuts for runtime, target and version.
- [Graph panel](graph-panel.md) — the graph toolbar with the same execution settings.
- [Collection view](collection-view.md) — collecting and switching collections.
