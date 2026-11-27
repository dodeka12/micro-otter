# Developer Documentation Index

This directory contains comprehensive documentation for the Micro-Otter V2 architecture and development practices.

## � Documentation Structure

Documentation is organized into focused subfolders. Each subfolder contains an `index.md` with detailed descriptions.

### [📚 guides/](guides/)

General development guides including architecture overview, build system, and coding standards.

- Includes [testing-architecture.md](guides/testing-architecture.md) as the canonical test framework and runner policy.

### [🏗️ core/](core/)

Core system architectures including data models, internationalization, logging, and event systems.

- [core/server-connection.md](core/server-connection.md) — the one `ServerConnectionMonitor` behind the
  title-bar offline badge and the reconnect dialog: state model, adaptive polling, and what it does not
  own.

### [👁️ view-system/](view-system/)

View architecture and UI components documentation. See the
[view-system index](view-system/index.md) for the full table of contents, and
[firmware-build-view-architecture.md](view-system/firmware-build-view-architecture.md) for the
Firmware tab.

### [📦 nodes/](nodes/)

Node definitions, transpiler, and code generation system.

- [nodes/addons/index.md](nodes/addons/index.md) - Add-on node packages authoring guide:
  an overview of an add-on's parts (manifest, `moa_` module namespace, variants, node definitions,
  generators, capability checks) with per-feature detail documents under `nodes/addons/`.
- [nodes/core-tuple-node-system.md](nodes/core-tuple-node-system.md) - The `core.tuple` value type
  and the built-in tuple nodes (`compose`, `decompose`, `tuple-select`) plus the single-channel
  `select`, the indexed N-way `select-index` mux, and the union rule that follows a node's active
  inputs.
- [nodes/core-pin-node-system.md](nodes/core-pin-node-system.md) - The `core` pin nodes
  (`adc-input`, the `adc-array` ADC Block, `dac-output`, `digital-input`, `digital-output`,
  `voltage-divider`), their target capabilities, and the paced `vars.array` capture contract.
- [nodes/irq-node-system.md](nodes/irq-node-system.md) - The `irq` node package: `interrupt-input`
  and `interrupt-enable`, the `otter_irq/interrupts.py` runtime contract, the 1:1:1 interrupt-name
  binding, and the exact generated statements.
- [nodes/signal-triggered-graphs.md](nodes/signal-triggered-graphs.md) - Cross-graph pulse signals and
  the `event` execution type (`any`/`all` trigger, run-on-start, generated-code shape, validation).
- [nodes/function-graphs.md](nodes/function-graphs.md) - The `function` execution type and the graph
  function contract: signature and port rules, structural input/output nodes, the settings editor,
  generated `function_graph.<id>` palette nodes, emitted `async def` code with hoisted init,
  validation message ids, and graph copy/paste.

### [🔌 device-communication/](device-communication/)

Device communication protocols, WebSerial API integration, and testing procedures.

- [device-communication/device-connection-ui.md](device-communication/device-connection-ui.md) -
  The one device connection surface: the `DeviceConnectionMonitor` state table, the title-bar badge,
  the connection dialog and the one-writer port rule.
- [device-communication/micropython-protocol.md](device-communication/micropython-protocol.md) -
  The raw-REPL frame (`OK` + stdout + `0x04` + stderr + `0x04` + `>`), entry/exit timing, and the
  stdout-vs-stderr error contract, verified against the pinned MicroPython sources.
- [device-communication/websocket-serial-bridge.md](device-communication/websocket-serial-bridge.md) -
  The `/serial` byte pipe: wire frames, port ownership, `exclusive` open with retry, and the
  `read(4096)` coalescing contract the protocol layer must survive.

### [🚀 deployment/](deployment/)

Deployment system architecture, access control, and device deployment APIs.

- [deployment/deploy-layout.md](deployment/deploy-layout.md) - Ownership contract for the top-level
  `deploy/` tree, the shared toolchain pin source, and the boundary that keeps node-package source
  upload out of the build/flash backends.
- [deployment/configuration.md](deployment/configuration.md) - Configuration reference: precedence
  chain, `micro-otter.toml` schema, platform defaults, state directory, and the `toolchain` /
  `doctor` / `serve` contracts.
- [deployment/deployment-system-architecture.md](deployment/deployment-system-architecture.md) -
  End-to-end deployment architecture.
- [deployment/hosted-webapp.md](deployment/hosted-webapp.md) - The browser-only hosted build: the
  Vite hosted mode and its env seam, what `/api` and the Firmware tab lose, the CSP, the generated
  `/firmware/` page, `webapp-build.json`, and `mo webapp build` / `mo webapp upload`.

### [⚙️ mpy-precompilation/](mpy-precompilation/)

Developer documentation for MicroPython `.mpy` precompilation workflows, compile-profile metadata, and canonical hash behavior.

### [🧱 firmware-compile/](firmware-compile/)

Developer documentation for firmware-embedded runtime compile contracts, packaging rules, metadata schema, and integration boundaries.

- [firmware-compile/build-backend-contract.md](firmware-compile/build-backend-contract.md) -
  `BuildBackend` protocol, registry, selection precedence, and the ESP-IDF adapter.
- [firmware-compile/flash-backend-contract.md](firmware-compile/flash-backend-contract.md) -
  `FlashBackend` protocol, registry, selection precedence, and the esptool adapter.
- [firmware-compile/board-catalog-contract.md](firmware-compile/board-catalog-contract.md) -
  Board catalog schema, including the optional backend metadata.
- [firmware-compile/process-streaming.md](firmware-compile/process-streaming.md) -
  The one seam every build/flash subprocess runs through: streamed lines, cancellation, timeout, and
  the `output`-frame mapping.
- [firmware-compile/firmware-runtime-payload-contract.md](firmware-compile/firmware-runtime-payload-contract.md) -
  What one image carries end to end: runtime modes, the frozen layout and relative-name invariant,
  the first-boot materialized `/`, the boot sequence, the deploy routing matrix, and the verification
  recipe.
- [firmware-compile/package-selection.md](firmware-compile/package-selection.md) -
  Which packages an image embeds (`packageIds`), the frozen variant, the packaging mode, and why that
  never affects source upload.
- [firmware-compile/archive-source-contract.md](firmware-compile/archive-source-contract.md) -
  The one "where is the archive?" rule for `addon.install`, `firmware.import`, and the
  `mo addons` / `mo firmware` verbs: the path policy, the URL policy, and the reproducible
  directory→zip packaging.
- [firmware-compile/server-firmware-api.md](firmware-compile/server-firmware-api.md) -
  `GET /api/server-capabilities`, its feature keys (including `local-file-access`), and the loopback
  `Host`/`Origin` trust model.
- [firmware-compile/firmware-build-websocket-protocol.md](firmware-compile/firmware-build-websocket-protocol.md) -
  The `WS /firmware` frame contract: client/server frames, the `fs.list` side channel, stable error
  codes, cancel/timeout/cleanup.
- [firmware-compile/firmware-deploy-contract.md](firmware-compile/firmware-deploy-contract.md) -
  The headless deploy helper: request/report types, image resolution, deploy payload, `flash-*` codes.
- [firmware-compile/firmware-index.md](firmware-compile/firmware-index.md) -
  `tools/make_release_index.py`: the `index.json` and release-body shape a manual firmware release
  publishes, why the `--base-url` is required, and the `release-index-*` failure codes.

## 📚 Additional Resources

### Development Planning

- `dev/todos/` - Implementation plans and roadmaps: one folder per plan with an `overview.md` plus one
  file per phase, and finished plans under `dev/todos/_done/`
- `dev/nodes/` - Node type design documents

### AI Guidance

- [AGENTS.md](../../AGENTS.md) - Canonical, harness-agnostic instructions for AI coding agents
- [ai/README.md](../../ai/README.md) - Canonical skills and the Cline/Copilot adapter layout

### Testing

- `../../tests/` - Unit and integration test suites
- Each architecture doc references related test files
- `guides/testing-architecture.md` - Framework/runner conventions for JS, browser, and Python tests

### Tools

- [../tools/mpy-runtime-workflow.md](../tools/mpy-runtime-workflow.md) - MPY tooling workflow for probing device ABI, compiling runtime profiles, and deploying .mpy files.
- [mpy-precompilation/hash-spec.md](mpy-precompilation/hash-spec.md) - Canonical compile-profile hash specification for Python and JavaScript parity.
- [../workflow/release.md](../workflow/release.md) - The manual release procedure: bump `release.json`, build and export per board in the compile image, generate the index and release body, tag `firmware-v<base>` (never move it), and upload with `gh release create --verify-tag`.

## 🤝 Contributing

When adding new documentation:

1. Place files in the appropriate subfolder within `docs/dev/`
2. Follow existing naming conventions (kebab-case)
3. Update the subfolder's `index.md` with a short description
4. Cross-reference related documents
5. Include code examples where applicable
6. Link to implementation files

## 📝 Documentation Standards

- Use clear, descriptive headings
- Include code examples for complex concepts
- Cross-reference related documents
- Keep examples up-to-date with implementation
- Explain **why** not just **what**
- Document design decisions and trade-offs

For general documentation, see `docs/general/`.
