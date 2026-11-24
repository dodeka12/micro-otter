# I2S Input

Reads mono 16-bit audio blocks from an I2S audio input.

## Inputs

| Port | Type | What it receives |
|---|---|---|
| `Enabled` | `bool` | enable or disable live audio input capture |

## Outputs

| Port | Type | What it emits |
|---|---|---|
| `Block` | `audio.block` | captured mono audio block (16-bit samples) |
| `Level` | `float` | current input signal level (0.0 to 1.0) |

## Parameters

| Control | Type | Default | Effect |
|---|---|---|---|
| `I2S Peripheral` | dropdown | `0` | I2S controller id |
| `BCLK Pin` | dropdown | `4` | I2S bit-clock pin (shared with the output) |
| `WS Pin` | dropdown | `5` | I2S word-select / left-right clock pin (shared with the output) |
| `Data Pin` | dropdown | `7` | I2S data input from the source DOUT |
| `Sample Rate` | dropdown | `16 kHz` | audio sample rate in Hz |
| `Block Samples` | dropdown | `256` | number of samples per audio block |

## Behaviour

- Init builds the I2S peripheral from the pin and block settings and registers the node as a chain
  source; the first source in wiring order becomes the primary working buffer.
- Samples stream through the chain's own task, so the graph loop never touches a sample: it only
  copies `Enabled` and reads `Level`.
- `Block` is a position in the chain, not a buffer in the graph — wire it into an effect or straight
  into `I2S Output`.
- `Enabled` off stops the capture while the chain keeps running for the other sources.
- BCLK and WS are shared with the I2S output, because MicroPython's I2S is controller-only, and the
  first blocks are replaced with silence so the power-on pop never reaches the speaker.

## Example

1. Set `I2S Peripheral`, `BCLK Pin`, `WS Pin` and `Data Pin` to match the microphone board.
2. Wire `Block` into `Gain` and then into `I2S Output` for a first pass-through chain.
3. Wire `Level` into a `Web Value Write` to show the input meter.

## See also

- [Audio package](index.md) — pins, sample rate and the streaming chain
- [I2S Output](i2s-output.md) — the sink that has to share BCLK and WS
- [Oscillator](oscillator.md) — a second source that mixes into the same chain

