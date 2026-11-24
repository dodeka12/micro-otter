# Random Value

Emits one uniform or normal sample per pass, as a float or a rounded integer.

## Inputs

| Port | Type | What it receives |
|---|---|---|
| `Min` | `float` `int` | lowest output value (uniform range or normal cut) |
| `Max` | `float` `int` | highest output value (uniform range or normal cut) |
| `Mean` | `float` `int` | mean of the normal distribution |
| `Std. Dev.` | `float` `int` | standard deviation of the normal distribution |

## Outputs

| Port | Type | What it emits |
|---|---|---|
| `Value` | `float` `int` | one random sample per pass |

## Parameters

| Control | Type | Default | Effect |
|---|---|---|---|
| `Distribution` | dropdown | `Uniform` | distribution to sample from: a uniform range or a normal distribution cut to the range |
| `Value Type` | dropdown | `Float` | float returns the raw sample, Integer rounds it to the nearest whole number |

## Behaviour

- Loop: draws one sample per pass, from a uniform range or from a normal distribution cut to
  `Min`..`Max`.
- `Uniform` reads `Min` and `Max`; `Normal` reads all four inputs, with `Mean` and `Std. Dev.` shaping
  the distribution before the range cut.
- `Value Type` also sets the connector type: `Integer` rounds the sample to the nearest whole number
  and emits an `int`, `Float` keeps the raw sample.
- Samples come from the generator shared with `Array Set`'s random modes, so a `Random Seed` node
  affects all of them.
- Without a connected output the node emits nothing — an unwired `Value` costs no runtime work.

## Example

1. Leave the defaults with `Uniform` and `Value Type` `Float` for a 0..1 value per pass.
2. Switch to `Normal` to jitter a temperature setpoint around `Mean` 22 with a small `Std. Dev.`.
3. Wire `Value` into `Logic` with a threshold to decide once per pass.

## See also

- [Vars package](index.md) — distributions and the shared generator
- [Random Seed](random-seed.md) — make a sequence reproducible
- [Array Set](array-set.md) — the same random draws for a whole array

