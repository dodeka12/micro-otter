# Developer Documentation - Complete File Index

Complete listing of all developer documentation files organized by category.

---

## 📚 Guides

General development guides including architecture overview, build system, and coding standards.

- **[architecture-overview.md](guides/architecture-overview.md)** - High-level overview of the entire Micro-Otter architecture and how components interact.

- **[build-and-deployment.md](guides/build-and-deployment.md)** - Build system configuration, development workflows, dependency management, and production deployment strategies.

- **[testing-architecture.md](guides/testing-architecture.md)** - Canonical test architecture and framework usage across Node.js, browser, and Python test suites.

- **[coding-style-guide.md](guides/coding-style-guide.md)** - Coding standards for Python (PEP 8) and TypeScript, including critical encapsulation rules and naming conventions.

---

## 🏗️ Core Systems

Core system architectures including data models, internationalization, logging, and event systems.

- **[data-backbone-architecture.md](core/data-backbone-architecture.md)** - Hierarchical data model with Workspace, Collection, NodeGraph, NodeData, and NodeControl, featuring event-driven updates and IndexedDB persistence.

- **[collection-version-policy.md](core/collection-version-policy.md)** - Collection version bump policy: when dirty flags are set vs when the semantic version is actually incremented (load, export, backup, transpile).

- **[user-target-config-architecture.md](core/user-target-config-architecture.md)** - User target config persistence, runtime-independent target merging, JSONC upload/template handling, and backup/restore integration.

- **[i18n-architecture.md](core/i18n-architecture.md)** - I18nService implementation for lazy-loading translations, variable interpolation, fallback handling, and view system integration.

- **[i18n-service.md](core/i18n-service.md)** - Detailed documentation of the I18nService API and usage patterns.

- **[logging-system-usage.md](core/logging-system-usage.md)** - Guide for using the logging system to debug and trace application behavior.

- **[progress-event-system.md](core/progress-event-system.md)** - ProgressEventBus pub/sub pattern for tracking long-running operations like startup, file transfers, and deployment.

- **[event-api-unification-adr.md](core/event-api-unification-adr.md)** - Architecture decision record for internal event API unification on `AppEventEmitter` and boundary use of `EventTarget`.

- **[undo-redo-architecture.md](core/undo-redo-architecture.md)** - Delta-based undo/redo system: HistoryManager API, operation types, control-value change flow, connection restoration, and how to add new operation types.

---

## 👁️ View System

View architecture and UI components documentation.

### Core Architecture

- **[view-system-architecture.md](view-system/view-system-architecture.md)** - Entry point and navigation guide for the view system documentation (split into focused guides below).

- **[view-system-overview.md](view-system/view-system-overview.md)** - Architecture overview, class hierarchy, view categories, and quick start examples.

- **[viewbase-lifecycle.md](view-system/viewbase-lifecycle.md)** - ViewBase lifecycle management, attachment flow, and hooks.

- **[view-manager.md](view-system/view-manager.md)** - ViewManager layer management, modal dialogs, themes, and context integration.

- **[deployment-progress-dialog.md](view-system/deployment-progress-dialog.md)** - `DeploymentProgressDialogView`, the one modal progress surface for device write operations (deploy/sync/remove/runtime).

- **[view-events.md](view-system/view-events.md)** - Event system, communication patterns, and data flow.

- **[view-constraints.md](view-system/view-constraints.md)** - Size constraint propagation and enforcement.

- **[view-serialization.md](view-system/view-serialization.md)** - State persistence and layout saving.

- **[view-integration.md](view-system/view-integration.md)** - i18n integration, Node UI integration, and best practices.

- **[view-api-reference.md](view-system/view-api-reference.md)** - Complete ViewBase and ViewManager API documentation.

### Specialized Features

- **[viewbase-resize-observer-guide.md](view-system/viewbase-resize-observer-guide.md)** - ResizeObserver integration in ViewBase with onInitialSize() and onResized() hooks for size-dependent rendering logic.

- **[viewbase-desired-size-guide.md](view-system/viewbase-desired-size-guide.md)** - Desired size feature for views to communicate size preferences to hosting containers like SplitView.

- **[collapsible-view.md](view-system/collapsible-view.md)** - CollapsibleView container with collapsible header and content panel for building expandable/collapsible UI sections.

- **[settings-views-guide.md](view-system/settings-views-guide.md)** - Settings view system architecture including GeneralSettingsView, CollectionSettingsView, GraphSettingsView, and AllSettingsView for configuration management.

- **[collection-view-architecture.md](view-system/collection-view-architecture.md)** - CollectionView component for managing projects and graphs with lazy-loaded tab views.

- **[graph-panel-view-architecture.md](view-system/graph-panel-view-architecture.md)** - GraphPanelView modular architecture with viewport, rendering, selection, interaction, and clipboard modules for canvas-based node graph editing.

- **[graph-panel-view-modularization-guide.md](view-system/graph-panel-view-modularization-guide.md)** - Implementation guide for integrating GraphPanelView modules with step-by-step migration patterns and code examples.

- **[node-ui-module-structure.md](view-system/node-ui-module-structure.md)** - NodeUi modular architecture split into constants, helpers, hit-testing, editors, and rendering modules for maintainability and testability.

- **[tabbed-view-hooks.md](view-system/tabbed-view-hooks.md)** - TabbedView extensibility hooks for lazy loading and custom view lifecycle.

- **[standard-theme-styling-guide.md](view-system/standard-theme-styling-guide.md)** - CSS customization guide for the Standard Compact Dark theme including view borders, padding, spacing, and CSS variable usage.

- **[device-deployment-view-architecture.md](view-system/device-deployment-view-architecture.md)** - DeviceDeploymentView component for managing runtime and collection deployment with status display, progress tracking, and custom runtime views.

- **[custom-view-architecture.md](view-system/custom-view-architecture.md)** - Custom view JSON definition format, control types, device function execution with parameter substitution, and structured JSON response protocol for updating UI controls.

---

## 📦 Node System

Node definitions, transpiler, and code generation system.

- **[node-validation-architecture.md](nodes/node-validation-architecture.md)** - Where a check belongs: declarations, per-node capability checks, graph rules, resource validator — for every package.

- **[node-definition-reference.md](nodes/node-definition-reference.md)** - Complete JSON schema for node definitions including inputs/outputs, controls, dynamic structure, implementations, capabilities, and i18n support.

- **[addons/index.md](nodes/addons/index.md)** - Add-on node packages authoring guide: an overview of an add-on's parts (manifest, `moa_` module namespace, variants, node definitions, generators, capability checks) with per-feature detail documents under `nodes/addons/`.

- **[transpiler-architecture.md](nodes/transpiler-architecture.md)** - Architecture of the transpiler system that converts node graphs into executable MicroPython code.

- **[function-graphs.md](nodes/function-graphs.md)** - The `function` execution type: persisted signature and port rules, optional structural input/output nodes, the graph-settings editor, generated `function_graph.<id>` palette definitions, the emitted `async def` with hoisted init and call validation, and graph copy/paste.

- **[webview-node-system.md](nodes/webview-node-system.md)** - Developer guide for Web View nodes, including phase model, generators, runtime integration, refresh behavior, and mount contract.

- **[webview-node-contribution-contract.md](nodes/webview-node-contribution-contract.md)** - Node-specific contribution contract for modular webview code generation and shared orchestration boundaries.

---

## 🔌 Device Communication

Device communication protocols, WebSerial API integration, and testing procedures.

- **[webserial-architecture.md](device-communication/webserial-architecture.md)** - Architecture of the WebSerial-based communication system for connecting to ESP32 devices via USB.

- **[webserial-testing.md](device-communication/webserial-testing.md)** - Automated testing procedures for WebSerial functionality.

- **[webserial-manual-testing.md](device-communication/webserial-manual-testing.md)** - Manual testing checklist for WebSerial features.

- **[micropython-protocol.md](device-communication/micropython-protocol.md)** - Communication protocol specification for interacting with MicroPython REPL on ESP32 devices.

- **[device-folder-structure.md](device-communication/device-folder-structure.md)** - Organization and structure of device-side files and firmware.

- **[device-tools-reference.md](device-communication/device-tools-reference.md)** - Reference documentation for device-side tools and utilities.

- **[log-prefix-conventions.md](device-communication/log-prefix-conventions.md)** - Canonical device log prefix taxonomy (`system`, `otter`, `info`, `warning`, `error`, `success`, `data`, `user`), how to pick the right tag, and which declarations must stay in sync.

- **[runtime-web-shell-requirements.md](device-communication/runtime-web-shell-requirements.md)** - Required root `index.html` shell structure for runtime web pages so Web View node output can mount into a stable body container.

---

## 🚀 Deployment System

Deployment system architecture, access control, and device deployment APIs.

- **[deployment-system-architecture.md](deployment/deployment-system-architecture.md)** - Complete architecture of the deployment system including managers, coordinators, and device communication layers.

- **[deployment-access-control.md](deployment/deployment-access-control.md)** - Access control mechanisms for managing deployment permissions and security.

- **[device-deployment-api.md](deployment/device-deployment-api.md)** - API reference for device deployment operations including file transfers, configuration, and validation.

---

## ⚙️ MPY Precompilation

Developer documentation for deterministic MicroPython `.mpy` precompilation, compile-profile tracking, and cross-language hash consistency.

- **[workflow.md](mpy-precompilation/workflow.md)** - Developer workflow for probing compatibility, compiling from manifests, and validating `__mpycache__` outputs.

- **[hash-spec.md](mpy-precompilation/hash-spec.md)** - Canonical compile-profile hash specification (canonical JSON + SHA-256 truncation) shared by Python tooling and frontend JavaScript.

---

## 🧱 Firmware Compile

Developer documentation for firmware-embedded runtime compilation and packaging contracts.

- **[runtime-packaging-contract.md](firmware-compile/runtime-packaging-contract.md)** - Phase 1 packaging contract covering included runtime/tools/package assets, canonical path mapping, target module layout, startup shim contract, immutable `/otter/` metadata schema, and merge behavior with dynamic upload metadata.
- **[embedded-metadata-api-contract.md](firmware-compile/embedded-metadata-api-contract.md)** - Phases 8-9 API contract for embedded runtime metadata plus bootstrap setup status/apply host-call boundaries.
- **[bootstrap-setup-validation-targets.md](firmware-compile/bootstrap-setup-validation-targets.md)** - Validation matrix for bootstrap setup status/apply/startup and host integration behavior.

---

## 📑 Quick Access

### By Topic

**Getting Started**

- [Architecture Overview](guides/architecture-overview.md)
- [Coding Style Guide](guides/coding-style-guide.md)

**Data & State Management**

- [Data Backbone Architecture](core/data-backbone-architecture.md)
- [Undo/Redo Architecture](core/undo-redo-architecture.md)
- [Progress Event System](core/progress-event-system.md)

**UI Development**

- [View System Overview](view-system/view-system-overview.md)
- [View System Architecture](view-system/view-system-architecture.md) (navigation guide)
- [Standard Theme Styling Guide](view-system/standard-theme-styling-guide.md)

**Node Development**

- [Node Validation Architecture](nodes/node-validation-architecture.md)
- [Node Definition Reference](nodes/node-definition-reference.md)
- [Add-on Node Packages](nodes/addons/index.md)
- [Transpiler Architecture](nodes/transpiler-architecture.md)
- [Function Graphs](nodes/function-graphs.md)
- [Web View Node System](nodes/webview-node-system.md)
- [Webview Node Contribution Contract](nodes/webview-node-contribution-contract.md)

**Device Integration**

- [WebSerial Architecture](device-communication/webserial-architecture.md)
- [MicroPython Protocol](device-communication/micropython-protocol.md)
- [Runtime Web Shell Requirements](device-communication/runtime-web-shell-requirements.md)
- [Deployment System Architecture](deployment/deployment-system-architecture.md)

**Internationalization**

- [I18n Architecture](core/i18n-architecture.md)
- [I18n Service](core/i18n-service.md)

**Testing & Debugging**

- [Logging System Usage](core/logging-system-usage.md)
- [Testing Architecture](guides/testing-architecture.md)
- [WebSerial Testing](device-communication/webserial-testing.md)
- [WebSerial Manual Testing](device-communication/webserial-manual-testing.md)

---

## 📖 Navigation

- **[README.md](README.md)** - Main documentation index with folder overview
- **[guides/index.md](guides/index.md)** - Guides folder index
- **[core/index.md](core/index.md)** - Core systems folder index
- **[view-system/index.md](view-system/index.md)** - View system folder index
- **[nodes/index.md](nodes/index.md)** - Node system folder index
- **[device-communication/index.md](device-communication/index.md)** - Device communication folder index
- **[deployment/index.md](deployment/index.md)** - Deployment system folder index
- **[mpy-precompilation/index.md](mpy-precompilation/index.md)** - MPY precompilation docs index
- **[firmware-compile/index.md](firmware-compile/index.md)** - Firmware compile docs index
- **[../tools/mpy-runtime-workflow.md](../tools/mpy-runtime-workflow.md)** - MPY tooling workflow: probe firmware ABI, compile runtime profiles, and deploy .mpy artifacts.
