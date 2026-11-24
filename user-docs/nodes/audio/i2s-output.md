# I2S Output

Writes mono 16-bit audio blocks to an I2S class-D amplifier (e.g.

## Inputs

| Port | Type | What it receives |
|---|---|---|
| `Block` | `audio.block` | audio block to play |
| `Enabled` | `bool` | enable or disable audio output (false also mutes the amplifier) |
| `Gain Level` | `bool` | drives the amplifier gain pin high when true and low when false |

## Outputs

None — the node has no outputs.

## Parameters

| Control | Type | Default | Effect |
|---|---|---|---|
| `I2S Peripheral` | dropdown | `1` | I2S controller id |
| `BCLK Pin` | dropdown | `4` | I2S bit-clock output (shared with the input) |
| `WS Pin` | dropdown | `5` | I2S word-select / left-right clock output (shared with the input) |
| `Data Pin` | dropdown | `6` | I2S data output to the amplifier DIN |
| `SD Pin` | dropdown | empty | amplifier shutdown/mute pin (optional; MAX98357A SD) |
| `Gain Pin` | dropdown | empty | amplifier gain-select pin (optional) |
| `Sample Rate` | dropdown | `16 kHz` | audio sample rate in Hz |
| `Block Samples` | dropdown | `256` | number of samples per audio block |

## Behaviour

- Init registers the node as the chain sink and starts the streaming task only after every filter of
  the chain has registered, so the task never runs against a half-built chain.
- Loop copies `Enabled` and `Gain Level`; `Gain Level` drives the optional `Gain Pin` high or low,
  because what that pin does is hardware dependent.
- `SD Pin` stays low (muted) from construction until the first block has been written, so the
  amplifier unmutes onto silence instead of into stale DMA memory.
- `Enabled` off stops the write, but it does not mute the amplifier — use `SD Pin` when the output must
  actually go quiet.
- `Sample Rate` and `Block Samples` must match the input and every effect in the chain; BCLK and WS are
  shared with the input.

## Example

1. Wire the last `audio.block` output of the chain into `Block`.
2. Set `Data Pin` to the amplifier's DIN and, if the board has a shutdown line, `SD Pin` to it.
3. Wire a bool into `Gain Level` when the amplifier has a selectable gain pin.

## See also

- [Audio package](index.md) — chain topology and shutdown pins
- [I2S Input](i2s-input.md) — the source that shares the clock pins
- [Gain](gain.md) — level control inside the chain

