# Device Communication Documentation

This folder contains documentation about device communication protocols, WebSerial API integration, device tools, and testing procedures.

## Files

- **[webserial-architecture.md](webserial-architecture.md)** - Architecture of the WebSerial-based communication system for connecting to ESP32 devices via USB.

- **[device-connection-ui.md](device-connection-ui.md)** - The one device connection surface: the shared `DeviceConnectionMonitor`, the title-bar badge contract, the connection dialog and the one-writer port rule.

- **[webserial-testing.md](webserial-testing.md)** - Automated testing procedures for WebSerial functionality.

- **[webserial-manual-testing.md](webserial-manual-testing.md)** - Manual testing checklist for WebSerial features.

- **[micropython-protocol.md](micropython-protocol.md)** - Communication protocol specification for interacting with MicroPython REPL on ESP32 devices: the raw-REPL byte frame, entry/exit timing, and the stdout-vs-stderr error contract.

- **[websocket-serial-bridge.md](websocket-serial-bridge.md)** - Architecture of the local WebSocket serial bridge for ESP32 devices without Web Serial, including port ownership, the `exclusive` open with retry, and the `read(4096)` coalescing contract.

- **[ota-deployment-roadmap.md](ota-deployment-roadmap.md)** - Design note for device-hosted (serverless) OTA deployment.

- **[device-folder-structure.md](device-folder-structure.md)** - Organization and structure of device-side files and firmware.

- **[device-tools-reference.md](device-tools-reference.md)** - Reference documentation for device-side tools and utilities.

- **[log-prefix-conventions.md](log-prefix-conventions.md)** - The canonical device log prefix taxonomy (`system`, `otter`, `info`, `warning`, `error`, `success`, `data`, `user`), how to pick the right tag, and which declarations must stay in sync.

- **[runtime-web-shell-requirements.md](runtime-web-shell-requirements.md)** - Required `index.html` shell contract for runtimes that support Web View nodes, including mount-point structure and fallback behavior.

- **[network-services.md](network-services.md)** - The general runtime's network-service model, controller, adapters and settings store.
