# Pulse example add-on

A variant-capable add-on that exposes one working `pulse.tick` node. `manifest.json` holds the
base implementation (`moa_pulse`); `manifest.viper.json` holds the viper variant
(`moa_pulse_viper`), which is selected only when the target advertises the `viper` capability.
In the Firmware tab the base shows as `Py` and the viper entry as `Viper`, each with its
description as the tooltip.

## Node: Pulse (`pulse.tick`)

Emits a value while a square wave is high and 0 while it is low. The phase comes from
`time.ticks_ms()`, so the wave restarts on boot and two Pulse nodes with the same interval stay
in step.

| Port / control | Type | Meaning |
| --- | --- | --- |
| Value (input) | any numeric | the value emitted while the wave is high |
| Interval (input) | int | full period in milliseconds (default 1000) |
| Out (output) | mirrors Value | the value while high, or 0 while low |
| Duty (control) | 0..100 | share of the period spent high (default 50) |
| Invert (control) | checkbox | swap the high and low phases |

### Try it in the editor

1. Install and build: `mo addons install examples/addons/node_pkgs/pulse`.
2. In the palette, drop **Pulse** and a **Single LED**.
3. Keep the defaults (Interval 1000, Duty 50) and wire Pulse **Out** → LED **Value**.
4. Deploy to an ESP32. The LED lights for half a second, then stays dark for half a second.

### Device API

Both implementations expose the same function:

```python
high(ticks: int, interval: int, duty: int) -> int
```

It returns `1` while the wave is high and `0` while it is low; `ticks` is a millisecond tick
count (`time.ticks_ms()`), `interval` the period in milliseconds, and `duty` the high share in
percent. The generated program imports whichever module the firmware staged:

```python
try:
    import moa_pulse as _moa_pulse
except ImportError:
    import moa_pulse_viper as _moa_pulse
```

The base module is pure MicroPython; the viper module wraps the same math in
`@micropython.viper` (with a host fallback so CPython tests can import it).

## Licence

GPL-3.0-only. The full licence text ships as `LICENSE` inside this package, and the node's
**Show Information** dialog repeats the same statement.

## Install and validate

```sh
mo addons validate examples/addons/node_pkgs/pulse
mo addons install examples/addons/node_pkgs/pulse
```

