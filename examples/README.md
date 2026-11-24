# Example add-ons

Installable add-on node packages. Device code is namespaced `moa_<id>` /
`moa_<id>_<variant>`; `otter_*` is reserved for Micro-Otter built-ins.

- `hello` — a single-implementation package (`moa_hello`). Ships a working
  `hello.greet` node (a fixed greeting string).
- `pulse` — a variant package: `manifest.json` (base, `moa_pulse`) plus
  `manifest.viper.json` (viper variant, `moa_pulse_viper`). Ships a working
  `pulse.tick` node (gated value with interval, duty, and invert controls).

Build either into firmware from the Firmware tab, or validate/install with:

```sh
mo addons validate examples/addons/node_pkgs/hello
mo addons install examples/addons/node_pkgs/pulse
```
