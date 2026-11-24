# Core package

The baseline every collection can rely on: constants, math, logic, timing, pins, ADC/DAC and the
tuple helpers that move several values through one wire.

## Setup

| Requirement | Detail |
|---|---|
| Pin dropdowns | filled from the active target's pin capabilities; a node whose capability the target lacks carries a badge |
| Analog inputs | only pins the target declares as Wi-Fi-safe ADC pins are offered, so an ADC node cannot break the radio |
| DAC | only on targets that declare a DAC pin |
| Analog range | every analog node works in 0–3.3 V, the ESP32 ADC attenuation range |
| [ADC Block](adc-array.md) | the capture blocks the rest of the graph for samples ÷ rate seconds; keep the block short |
| Companion packages | none |

## Nodes

| Node | What it does |
|---|---|
| [Constant](const.md) | emits a value of the selected type, or a built-in constant such as Pi or a degree/radian factor |
| [Print](print.md) | writes the value it receives to the console while `Enabled` is true |
| [Math](math.md) | applies one arithmetic operation to two inputs |
| [Range Adapt](range-adapt.md) | clamps, wraps, mirrors (ping-pong) or falls back to a default |
| [Range Convert](range-convert.md) | maps a value between two ranges with a linear, power, exponential or stepped transfer |
| [Compare](compare.md) | compares two numbers with one of the usual operators |
| [Logic](logic.md) | combines two booleans with and, or, xor, nand, nor or not |
| [Time](time.md) | emits uptime and the time since the last pass in the selected unit |
| [Memory Info](memoryInfo.md) | reports free heap in KB, optionally running the garbage collector first |
| [ADC Input](adc-input.md) | reads one analog pin as a voltage |
| [ADC Block](adc-array.md) | captures a fixed-size block of samples at a fixed rate and emits it as an array |
| [DAC Output](dac-output.md) | writes a voltage to a DAC pin |
| [Digital Input](digital-input.md) | reads a digital pin as a boolean |
| [Digital Output](digital-output.md) | writes a boolean to a digital output pin |
| [Voltage Divider](voltage-divider.md) | recovers the source voltage from a measured divider voltage and its ratio |
| [Select](select.md) | picks one of two values from a boolean condition |
| [Select by Index](select-index.md) | forwards one of up to eight values chosen by a zero-based index |
| [Compose](compose.md) | collects connected values into one tuple |
| [Decompose](decompose.md) | reads one position of a tuple |
| [Tuple Select](tuple-select.md) | returns one tuple position by zero-based index |

## Shared concepts

- Unconnected inputs fall back to the value in their inline control; `Select`, `Compose` and
  `Decompose` pass `None` for a position that is neither wired nor set.
- `Enabled` gates the effect of a node, not the graph: a disabled `Print` prints nothing, a
  disabled `Digital Output` leaves the pin as it was.
- An analog reading is a voltage, not a physical quantity; use `Range Convert`, `Range Adapt` or a
  `Math` chain for calibration.

## Related

- [Settings view](../../app/settings-view.md) — where the target and its pin capabilities come from
- [vars package](../vars/index.md) — arrays, stores and signals
- [led package](../led/index.md), [stdmo package](../stdmo/index.md) — pins used for output
