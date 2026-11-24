# Changes since version 1.23.0

## New Features
- **Type column in the node "Show Info" dialog** — every input, output, and control row now shows
  a **Type** column. Inputs list their allowed/initial types, outputs their output type plus any
  dynamic alternatives (dropdown `outputTypes`, `outputTypeByControlValue`, `type_input_source`),
  and controls their widget type. Type chips are colour-matched to their connectors. The info
  overlay is slightly wider (460 px) and the node description now renders above the parameter
  tables.

## Changes
- **Web view persistence guidance** — the five webview input controls
  (`web-view-number-input`, `web-view-string-input`, `web-view-slider`, `web-view-checkbox`,
  `web-view-select`) now document that `persist` keeps the value in the in-memory `_webcontrol`
  store and only survives a reboot when paired with **Web Value Store Save** and **Web Value Store
  Load**, with the Load node placed in a separate **Init** (startup) graph. `web-store-save` /
  `web-store-load` got the same guidance, and the previously misleading "across reboots" wording
  was corrected.
- **German node documentation** — all node packages (`core`, `led`, `mqtt`, `otter_audio_viper`,
  `power`, `stdmo`, `vars`, `webview`) now provide `de` for every title, info, connector/control
  name, label, description, option label, and default-control label, and the 185 parameters that
  had no description at all now have one in both `en` and `de`. Missing German UI strings in
  `locales/de.json` were also filled in.
