# Audio package

I2S audio input and output plus block-level effects for voice processing: a source feeds a chain of
effects, the chain writes to one sink, and a background task pumps the samples.

## Setup

| Requirement | Detail |
|---|---|
| I2S pins | `BCLK Pin`, `WS Pin`, `Data Pin` (and `SD Pin` for the output) come from the target's I2S capabilities; a target without I2S cannot use the package |
| I2S peripheral | `I2S Peripheral` lists the controllers the target declares |
| Sample rate | 4, 8, 16, 22.05 or 44.1 kHz, default 16 kHz |
| Block size | 64–1024 samples, default 256 — larger blocks mean more latency |
| Chain shape | exactly one source and one sink per chain; effects sit in between in wiring order |
| Runtime | the sample loop runs as native code (`@micropython.viper`), which is why the effects stay cheap |

- Wire `block` outputs to `block` inputs only: the audio connector is the only type that links these
  nodes, and the transpiler registers the chain in topological (wiring) order.
- The chain is started in one shared init block, so the graph never has to call anything to begin
  playing; a graph loop stays free for control logic.
- `Gain Pin` and `SD Pin` on the output drive an amplifier's shutdown and gain pins when wired; leave
  them unset for a plain amplifier.

## Nodes

| Node | What it does |
|---|---|
| [I2S Input](i2s-input.md) | reads mono 16-bit blocks from an I2S microphone or codec |
| [I2S Output](i2s-output.md) | writes blocks to an I2S class-D amplifier such as the MAX98357A |
| [Overdrive](overdrive.md) | gain plus hard clipping |
| [Bitcrusher](bitcrusher.md) | drops low bits for lo-fi grit |
| [Square Fuzz](square-fuzz.md) | squares the waveform with a wet level and dry/wet mix |
| [Downsampler](downsampler.md) | sample-and-hold decimation on a continuous hold grid |
| [Gain](gain.md) | gain in dB with clipping |
| [Pitch Shifter](pitch-shifter.md) | shifts pitch in semitones without changing speed |
| [Filter](filter.md) | band-pass (high-pass plus low-pass) for a telephone voice |
| [Ring Modulator](ring-mod.md) | multiplies the signal by a sine carrier |
| [Noise](noise.md) | adds white noise that follows the input level |
| [Oscillator](oscillator.md) | generates a sine, square, triangle or sawtooth test signal |

## Shared concepts

- `Enabled` is a bypass: the effect fades to the dry signal over roughly 128 samples instead of
  switching hard, so toggling it does not click, and the chain keeps running.
- `Level` on the input and `Level` on the output are plain floats, usable from the rest of the graph
  for meters or gain staging.
- Only one chain exists per collection: a second source or sink is a wiring error rather than a
  second voice.

## Related

- [Graph panel](../../app/graph-panel.md) — wiring rules for typed ports
- [Settings view](../../app/settings-view.md) — where I2S pins are declared
- [core package](../core/index.md) — scalars and math for control around the chain
