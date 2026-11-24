# Copilot Instructions

## Project Purpose & Layout

- Micro-Otter pairs a browser-based node editor with MicroPython runtime scaffolding so users can design ESP32 firmware visually; the editor assets live under [src/micro_otter/nodes/html](../src/micro_otter/nodes/html) and the editor entry point is [src/micro_otter/nodes/html/js/main.js](../src/micro_otter/nodes/html/js/main.js). Firmware templates ship in [src/micro_otter/nodes/device/general/device.json](../src/micro_otter/nodes/device/general/device.json).
- `uv run micro-otter` executes [micro_otter.tools.serve_nodes:main](../src/micro_otter/tools/serve_nodes.py) which serves `src/micro_otter/nodes/` on http://localhost:8000 with JSON-friendly MIME types and `/device` passthroughs.
- Python packaging is defined in [pyproject.toml](../pyproject.toml); dependencies assume Python 3.13 with `uv` for env management and Hatchling for builds.

## Tooling Defaults

- Always execute Python snippets with the workspace virtualenv at `.venv/Scripts/python.exe` (configured via `C:/Users/chris/Documents/Code/github/micro-otter/.venv/Scripts/python.exe`). Avoid the system interpreter so dependency resolution stays consistent.

- When reviewing files or debugging unexpected errors, explicitly scan for unterminated/overlong comments (/_ ... _/ or /\*_ ... _/) that might inadvertently swallow code; verify comments close before import/logic blocks.

## MicroPython Runtime Expectations

- The flashed firmware boots [src/micro_otter/nodes/device/general/main.py](../src/micro_otter/nodes/device/general/main.py): it loads `wifi_settings.json`, joins WiFi, then instantiates `WebInterface` from [app/web_interface.py](../src/micro_otter/nodes/device/general/app/web_interface.py).
- `WebInterface` keeps a `uasyncio` web server plus a hot-swappable `app.main_loop` coroutine; `request_main_loop_reload()` cancels the task, purges the module from `sys.modules`, and reloads it.
- The default `app/main_loop.py` is a placeholder loop; generated code overwrites this file and should expose an async `run()` coroutine.
- Shared peripherals (display, motor, servo, receiver, ultrasonic, logger, HTTP parsing) live in [libs/](../src/micro_otter/nodes/device/general/libs/web_server.py); keep implementations MicroPython-safe (no CPython-only modules, prefer `uasyncio`, guard RAM usage).

## Editor & Graph Pipeline

- Node canvas state is modeled in [core/graph.js](../src/micro_otter/nodes/html/js/core/graph.js) which tracks nodes, connections, dynamic inputs/controls, and enforces layout constants.
- [core/ui.js](../src/micro_otter/nodes/html/js/core/ui.js) renders the palette/properties panel, injects localized labels via `i18n.js`, and surfaces control editors.
- [core/config.js](../src/micro_otter/nodes/html/js/core/config.js) loads `device/devices.json`, caches device descriptors, applies overrides, and resolves node definition/generator URLs.
- [nodes/transpiler.js](../src/micro_otter/nodes/html/js/nodes/transpiler.js) topologically sorts the graph, feeds inputs/defaults into node implementations, and emits language-specific code via regex templates, module functions, or `NodeCodeGenerators.*` hooks.
- [webserial/deployer/index.js](../src/micro_otter/nodes/html/js/webserial/deployer/index.js) orchestrates deployment actions (connect, sync, deploy, restart/reset).

## Front-End JavaScript Structure

1. **Top-Level Flow**

   - [main.js](../src/micro_otter/nodes/html/js/main.js) is the entry point; it wires up localization, the core runtime, node tooling, and the WebSerial bridge in that order.
   - The codebase now groups browser logic by responsibility: shared runtime logic under [core/](../src/micro_otter/nodes/html/js/core), graph-facing helpers under [nodes/](../src/micro_otter/nodes/html/js/nodes), and the deployment stack under [webserial/](../src/micro_otter/nodes/html/js/webserial).

2. **Core Runtime (src/micro_otter/nodes/html/js/core/)**

   - [environment.js](../src/micro_otter/nodes/html/js/core/environment.js) creates the canvas, manages viewport math, DOM references (panels, buttons, serial widgets), and exposes helpers like `screenToWorld()` and `ensureReadabilityCanvasSize()`.
   - [graph.js](../src/micro_otter/nodes/html/js/core/graph.js) owns node/connection state, selection + dragging, dynamic inputs/controls, and localized titles. It exports setters/getters consumed across the UI and transpiler.
   - [render.js](../src/micro_otter/nodes/html/js/core/render.js) is the only module that paints to the canvas. It imports `environment.js` for contexts/viewport math and `graph.js` for state, then renders grid, nodes, and animated connection feedback.
   - [ui.js](../src/micro_otter/nodes/html/js/core/ui.js) builds the properties panel, control editors, palette, and selection logic. It depends on `environment.js` for DOM hooks and on `graph.js` for node state.
   - [config.js](../src/micro_otter/nodes/html/js/core/config.js) fetches device manifests, resolves relative assets, initializes default graphs, and triggers `render.js`’s draw loop once configuration loads. It also hydrates `core/graph` with definitions and dynamic inputs.
   - Support files: [dialogs.js](../src/micro_otter/nodes/html/js/core/dialogs.js) handles accessible modal dialogs; [loader.js](../src/micro_otter/nodes/html/js/core/loader.js) proxies to the splash/loading overlay; [settings.js](../src/micro_otter/nodes/html/js/core/settings.js) persists UI prefs in cookies.

3. **Node Tooling (src/micro_otter/nodes/html/js/nodes/)**

   - [events.js](../src/micro_otter/nodes/html/js/nodes/events.js) centralizes canvas + document listeners (dragging, zoom, context menu, about overlay). It stitches together `core/environment`, `core/graph`, `core/ui`, and `core/config`, then calls into the transpiler and renderer when interactions require it.
   - [transpiler.js](../src/micro_otter/nodes/html/js/nodes/transpiler.js) houses all code-generation logic: graph sorting, template rendering, generator invocation, and import collection. It only imports `core/graph` data and exposes `transpileToLanguage()` for UI + deployment.

4. **WebSerial Stack (src/micro_otter/nodes/html/js/webserial/)**
   - [constants.js](../src/micro_otter/nodes/html/js/webserial/constants.js) and [utils.js](../src/micro_otter/nodes/html/js/webserial/utils.js) hold timing constants, regex helpers, and shared Serial helpers.
   - [console.js](../src/micro_otter/nodes/html/js/webserial/console.js) manages the on-page serial console window, including printable filtering and IO visibility toggles.
   - [micropython-client.js](../src/micro_otter/nodes/html/js/webserial/micropython-client.js) abstracts the browser Serial API into connect/disconnect/fs helpers tuned for our MicroPython firmware.
   - [deployer/index.js](../src/micro_otter/nodes/html/js/webserial/deployer/index.js) orchestrates connection + deployment workflows.
   - [setup.js](../src/micro_otter/nodes/html/js/webserial/setup.js) binds the DOM buttons from `environment.js` to the deployer + console.

## Device Profiles & Code Generators

- Each device folder (default `device/general`) exposes metadata through [device.json](../src/micro_otter/nodes/device/general/device.json), node definitions under `nodes/node_definitions.json`, JavaScript generators, and MicroPython support libs.
- [NODE_SYSTEM_README.md](../NODE_SYSTEM_README.md) documents the JSON schema for node controls, localized labels, and `implementations` block.
- Sample definitions in [node_definitions.json](../src/micro_otter/nodes/device/general/nodes/node_definitions.json) show bilingual titles, default input controls, and dropdown-driven connector visibility (see `math` node `affectsInputs/affectsControls`).
- Complex emitters should use [node_generators.js](../src/micro_otter/nodes/device/general/nodes/node_generators.js); helpers there convert angle units, register Python imports, and enforce safe divide-by-zero fallbacks.

## Deployment & Debugging Workflows

- Preferred dev loop: `uv sync` → `uv run micro-otter` → edit nodes → transpile/deploy through WebSerial (Chrome/Edge) or export code and use `mpremote`.
- Serial docs in [docs/serial_readme.md](../docs/serial_readme.md), [serial_file_commands.md](../docs/serial_file_commands.md), and [code_injection.md](../docs/code_injection.md) explain raw REPL control characters, file RPCs, and hot reload sequences; keep tooling consistent with those protocols.
- For manual deployments call `mpremote connect <port> fs cp app/main_loop.py :app/main_loop.py` then `mpremote reset`; do not reboot the board automatically from generated code.
- WiFi credentials must be provisioned via [tools/set_wifi.py](../src/micro_otter/nodes/device/tools/set_wifi.py) (writes `wifi_settings.json`); fail fast with `UserError` if missing to keep the serial console usable.
- When modifying the runtime, preserve the `request_main_loop_reload()` hook so both WebSerial and `mpremote` flows keep working.

## Coding Conventions & Pitfalls

- Front-end modules use ES modules with shared state exported from `core-environment`; avoid introducing global mutations outside those modules.
- Icon-only buttons (buttons that only contain an icon) must use the menu column’s borderless style: no background, no border, no box-shadow/glow; keep hover/focus states consistent with the sidebar menu buttons.
- Node IDs and connector arrays are mutated in place; always call `applyDynamicInputs/Controls` plus `refreshNodeHeight()` when altering definitions so the canvas and properties panel stay in sync.
- MicroPython libs throttle hardware changes (`Motor.set_speed`, `Servo.set_angle`) by wall-clock deltas—honor these rate limits when adding new APIs.
- All firmware modules run on-device: rely on `uasyncio`, `machine`, `ubinascii`, etc., and wrap blocking IO in asyncio-friendly patterns; no CPython-only packages.
- Inline function documentation should use JSDoc format (`/** ... */` with `@param` / `@returns`) so standard doc tools can parse it consistently.

## Reference Docs & Assets

- User-facing README lives at [README.md](../README.md); keep it aligned with actual commands and ports.
- `NODE_SYSTEM_README.md` plus the docs under [docs/](../docs/serial_readme.md) should be updated whenever schemas or serial workflows change.
- Images/icons reside under [src/micro_otter/nodes/html](../src/micro_otter/nodes/html/js/main.js); `core-config` resolves relative paths, so ship assets alongside their definition JSONs to avoid broken references.

## Copilot-Focused Docs

When working on the web app / editor internals, also consult:

- [docs/copilot_web_app_playbook.md](../docs/copilot_web_app_playbook.md)
  - Copilot-oriented extension checklist + invariants.
- [docs/web_app_overview.md](../docs/web_app_overview.md)
  - Big-picture architecture and “where to change X”.
- [docs/web_app_features.md](../docs/web_app_features.md)
  - Feature-by-feature implementation notes with file references.

Please let me know if any section needs more detail or if other workflows should be documented.
