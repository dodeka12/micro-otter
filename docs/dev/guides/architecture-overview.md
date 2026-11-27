# Micro-Otter Architecture Overview

## System Architecture

Micro-Otter is a browser-based visual node editor for creating ESP32 firmware using MicroPython. The system follows a modular, event-driven architecture with clear separation between data, views, and runtime components.

## Core Architecture Layers

### 1. Data Backbone

The data layer implements a hierarchical model: **Workspace → Collection → NodeGraph → NodeData → NodeControl**. Each level manages its own state and emits events for changes, enabling reactive UI updates. Data is persisted to IndexedDB with automatic serialization/deserialization.

**Key Components:**

- Workspace: Top-level container with global configuration
- Collection: Project-level container with device runtime association
- NodeGraph: Executable graph with nodes and connections
- NodeData: Individual node instances with properties and controls
- NodeControl: UI control values (number, text, dropdown, checkbox, color)

**See:** [data-backbone-architecture.md](../core/data-backbone-architecture.md)

### 2. View System

All UI components extend **ViewBase**, which provides lifecycle management (attach/detach), resize handling, event emission, and i18n integration. Views are organized into a three-layer hierarchy managed by **ViewManager**:

- **Root Layer**: Main application layout (SplitView, TabbedView containers)
- **Overlay Layer**: Floating windows (OverlayWindow)
- **Modal Layer**: Dialog boxes (ConfirmationDialogView, ErrorDialogView, etc.)

Views are serializable for layout persistence and receive dependencies via context injection.

**See:** [view-system-architecture.md](../view-system/view-system-architecture.md)

### 3. Node UI System

Node rendering is split into modular components:

- **NodeUi**: Main orchestrator managing lifecycle and control instances
- **Control Classes**: Polymorphic control types (NumberControlUi, DropdownControlUi, etc.)
- **Rendering Module**: Canvas drawing for nodes, connections, and controls
- **Hit Testing Module**: Mouse interaction detection
- **Input Default Controls**: Inline controls for disconnected inputs

**See:** [node-ui-module-structure.md](../view-system/node-ui-module-structure.md)

### 4. Code Generation & Deployment

The **Transpiler** converts node graphs to Python code for ESP32 deployment:

- **Node Implementations**: Three types (regex templates, function classes, code generators)
- **Capability System**: Validates device support before deployment
- **Web Serial Integration**: Direct deployment to ESP32 devices via browser API

**See:** [transpiler-architecture.md](../nodes/transpiler-architecture.md)

### 5. Web Serial Communication

The **WebSerial System** provides browser-based serial communication with ESP32 devices:

- **SerialConnectionBase**: Abstract interface for multiple connection types
- **WebSerialConnection**: Chrome/Edge Web Serial API implementation
- **WebSocketConnection**: Local WebSocket serial bridge implementation
- **DeviceConnection**: High-level manager with MicroPython protocol support
- **DeviceDeployment**: Business logic for runtime installation and collection deployment
- **ConsoleLogView**: Message display with type icons and circular buffer
- **DeviceConnectionView**: Composite UI with collapsible connection controls, runtime settings, and device log panes

**See:** [webserial-architecture.md](../device-communication/webserial-architecture.md), [deployment-system-architecture.md](../deployment/deployment-system-architecture.md), [device-deployment-api.md](../deployment/device-deployment-api.md)

### 6. Runtime & Package System

- **Device Runtimes**: MicroPython implementations with platform-specific libraries
- **Node Packages**: Reusable node type definitions (global and runtime-specific)
- **CollectionManager**: Single-source-of-truth for runtime-aware data access
- **Target Definitions**: Device capability maps for validation

**See:** [device-folder-structure.md](../device-communication/device-folder-structure.md)

## Key Design Patterns

### Event-Driven Updates

Changes in data backbone emit events that views subscribe to, ensuring UI reflects data state without manual synchronization.

### Polymorphic Controls

Control types implement a common interface (getValue, setValue, renderCanvas, hitTest), eliminating type-switching logic and simplifying extension.

### Dependency Injection

ViewFactory provides context objects during view creation, enabling testability and decoupling.

### Single Source of Truth

- **NodeData.controlValues**: Authoritative source for control state
- **CollectionManager**: Central access point for collections and runtimes
- **Workspace.config**: Global application configuration

### Progressive Enhancement

- **Feature Detection**: Browser capability checks before initialization
- **Progress Events**: Standardized progress tracking for async operations
- **Lazy Loading**: Runtime packages loaded on demand

## Data Flow

### Top-Down (User Actions → Data)

```
User clicks canvas
  ↓
GraphPanelView handles event
  ↓
NodeUi detects control hit
  ↓
Control._notifyChange() updates NodeData.controlValues
  ↓
NodeData emits 'control-changed'
  ↓
NodeGraph propagates to Collection
  ↓
Workspace triggers auto-save (debounced)
```

### Bottom-Up (Data Changes → UI)

```
NodeData.controlValues updated
  ↓
NodeData emits 'node-changed'
  ↓
GraphPanelView receives event
  ↓
NodeUi.renderCanvas() reads current value
  ↓
Canvas shows updated control display
```

## Key Technologies

- **TypeScript + ES Modules**: Module-oriented app source architecture (no bundler in development)
- **IndexedDB**: Client-side persistent storage
- **Canvas 2D**: Node graph rendering
- **ResizeObserver**: Automatic size detection for responsive layouts
- **EventTarget**: Native event system for pub/sub patterns
- **Web Serial API**: Direct ESP32 communication from browser
- **Vite**: Production bundler with tree-shaking and minification

## Directory Structure

```
src/micro_otter/nodes/
├── html/               # Web application
│   ├── js/
│   │   ├── app/       # Application entry point
│   │   ├── core/      # Core utilities (events, logging, clipboard)
│   │   ├── data/      # Data backbone classes
│   │   ├── views/     # View system components
│   │   ├── nodes/     # Node UI rendering
│   │   ├── i18n/      # Translation system
│   │   ├── proc/      # Code generation (transpiler)
│   │   └── serial/    # Web Serial communication
│   ├── styles/        # CSS themes (standard, sandbox)
│   ├── locales/       # Translation files (en.json, de.json)
│   └── icons/         # UI icons (SVG)
├── device/            # Device runtime files
│   ├── node_pkgs/     # Global node packages
│   ├── targets/       # Device capability maps
│   └── runtime/       # Runtime-specific implementations
└── index.html         # Application entry point
```

## Development Workflow

### Local Development

```bash
uv run micro-otter  # Start Python dev server on :8000
```

- No build step required
- Native ES modules load directly
- Hot reload via browser refresh

### Production Build

```bash
npm run build  # Creates _dist/webapp/
```

- Vite bundles and minifies app scripts/CSS
- Static assets copied (device files, locales, icons)
- Output deployable to any web server

## Testing Strategy

- **Unit Tests**: Pure functions (helpers, hit-testing, rendering)
- **Integration Tests**: View lifecycle, data synchronization
- **Manual Tests**: Web Serial communication (requires hardware)

## Related Documentation

For detailed information on specific subsystems, see the [Documentation Index](../README.md).

## Future Enhancements

- WebGL rendering for large graphs
- Undo/redo system with command pattern
- Offline PWA support with service workers
- Touch gesture support for tablets
- Accessibility features (keyboard navigation, screen readers)

See ldev/todos/future-ideas.md for complete roadmap.
