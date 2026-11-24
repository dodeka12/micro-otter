# Core Systems Documentation

This folder contains documentation about core system architectures including data models, internationalization, logging, and event systems.

## Files

- **[data-backbone-architecture.md](data-backbone-architecture.md)** - Hierarchical data model with Workspace, Collection, NodeGraph, NodeData, and NodeControl, featuring event-driven updates and IndexedDB persistence.

- **[markdown-and-math-rendering.md](markdown-and-math-rendering.md)** - Allowlisted Markdown renderer for documentation areas, math sentinel extraction, KaTeX CDN loader with offline fallback, and the `renderAreaMarkdown()` facade.

- **[app-event-envelope.md](app-event-envelope.md)** - Internal emitter event envelope standard using `name`, `detailType`, and dedicated payload class instances in `detail`.

- **[event-api-unification-adr.md](event-api-unification-adr.md)** - ADR describing the decision to standardize internal emitters on `AppEventEmitter` (`emit/on/off/once`) while keeping `EventTarget` at subsystem boundaries.

- **[collection-version-policy.md](collection-version-policy.md)** - Collection version bump policy: when dirty flags are set vs when the semantic version is actually incremented (load, export, backup, transpile).

- **[user-target-config-architecture.md](user-target-config-architecture.md)** - User target config persistence, runtime-independent target merge behavior, JSONC upload/template flow, and backup/restore parity semantics.

- **[i18n-architecture.md](i18n-architecture.md)** - I18nService implementation for lazy-loading translations, variable interpolation, fallback handling, and view system integration.

- **[i18n-service.md](i18n-service.md)** - Detailed documentation of the I18nService API and usage patterns.

- **[logging-system-usage.md](logging-system-usage.md)** - Guide for using the logging system to debug and trace application behavior.

- **[progress-event-system.md](progress-event-system.md)** - ProgressEventBus pub/sub pattern for tracking long-running operations like startup, file transfers, and deployment.

- **[server-connection.md](server-connection.md)** - The single `ServerConnectionMonitor` behind the title-bar offline badge and the reconnect dialog: three-valued state, adaptive polling, the badge and dialog contracts, and what it deliberately does not own.

- **[undo-redo-architecture.md](undo-redo-architecture.md)** - Delta-based undo/redo system: HistoryManager API, operation types, control-value change flow, connection restoration, and how to add new operation types.
