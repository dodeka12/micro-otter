# WebSerial Architecture

## Overview

The WebSerial system provides modular, extensible serial communication between the Micro-Otter web application and ESP32/MicroPython devices. Built on abstract interfaces and concrete implementations, the architecture supports multiple connection types while maintaining a consistent API for device communication.

**Design Goals:**

- **Separation of Concerns**: Connection management separate from UI and protocol logic
- **Extensibility**: Support for WebSerial, WebSocket, and future connection types
- **ViewBase Integration**: UI components follow established v2 architecture patterns
- **Protocol Implementation**: MicroPython REPL protocol for file transfer and runtime control
- **Progress Reporting**: Integration with ProgressEventBus for long-running operations

---

## Architecture Layers

```
┌─────────────────────────────────────────────────────────────┐
│ UI Layer (ViewBase Components)                              │
│  ├─ DeviceConnectionView (composite view)                   │
│  │   ├─ ToolbarView (connection controls)                   │
│  │   └─ ConsoleLogView (message display)                    │
│  └─ Integration with ViewManager, i18n, theming             │
└─────────────────────────┬───────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────┐
│ Management Layer                                             │
│  └─ DeviceConnection (connection & protocol manager)        │
│      ├─ Provider management (WebSerial, WebSocket, etc.)    │
│      ├─ MicroPython protocol implementation                 │
│      ├─ Message parsing and routing                         │
│      └─ Progress reporting integration                      │
└─────────────────────────┬───────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────┐
│ Connection Layer (Abstract Interface)                       │
│  └─ SerialConnectionBase (abstract base class)              │
│      ├─ Connection lifecycle (connect, disconnect)          │
│      ├─ Data transmission (send, receive)                   │
│      ├─ State management and events                         │
│      └─ Error handling                                      │
└─────────────────────────┬───────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────┐
│ Implementation Layer                                         │
│  ├─ WebSerialConnection (Web Serial API)                    │
│  ├─ WebSocketConnection (bridge)                            │
│  └─ BluetoothConnection (future)                            │
└─────────────────────────────────────────────────────────────┘
```

---

## Class Reference

### SerialConnectionBase (Abstract)

**Location**: `src/micro_otter/nodes/html/js/serial/serial-connection-base.ts`

Abstract base class defining the standard interface for all serial connections.

#### Purpose

- Provide consistent API across connection types
- Define connection lifecycle contract
- Establish event system for state changes and data
- Enable polymorphic provider management

#### Key Features

- **Abstract Methods**: `connect()`, `disconnect()`, `send()` must be implemented
- **State Management**: Tracks connection state (disconnected, connecting, connected, disconnecting, error)
- **Event System**: EventTarget-based for state changes and data reception
- **Connection Info**: Metadata about active connections

#### Events

- **`connecting`**: Connection attempt started
- **`connected`**: Connection established
- **`disconnecting`**: Disconnect initiated
- **`disconnected`**: Connection closed
- **`statechange`**: State transition occurred
- **`data`**: Data received from connection
- **`error`**: Error occurred

#### API

```ts
// State queries
isConnected(): boolean
getState(): string
getConnectionInfo(): object|null

// Abstract methods (must implement)
async connect(options): Promise<void>
async disconnect(): Promise<void>
async send(data): Promise<void>

// Protected helpers
_setState(newState): void
_log(message, data): void
_emitData(data): void
_emitError(error, context): void
```

#### Usage Example

```ts
// Subclass implementation
class MyConnection extends SerialConnectionBase {
    async connect(options) {
        this._setState('connecting');
        try {
            // ... connection logic ...
            this._connectionInfo = { port: 'COM3', baudRate: 115200 };
            this._setState('connected');
        } catch (error) {
            this._emitError(error, 'connect');
            this._setState('error');
            throw error;
        }
    }

    async disconnect() {
        this._setState('disconnecting');
        // ... disconnect logic ...
        this._setState('disconnected');
    }

    async send(data) {
        if (!this.isConnected()) {
            throw new Error('Not connected');
        }
        // ... send logic ...
    }
}
```

---

### WebSerialConnection

**Location**: `src/micro_otter/nodes/html/js/serial/webserial-connection.ts`

Concrete implementation of SerialConnectionBase using the browser's Web Serial API for USB serial communication.

#### Purpose

- Provide USB serial connectivity to ESP32 devices
- Handle port selection via browser dialog
- Manage data streams (read/write)
- Implement graceful cleanup

#### Browser Support

- ✅ Chrome/Chromium 89+
- ✅ Edge 89+
- ❌ Firefox
- ❌ Safari

#### Key Features

- **Static Availability Check**: `WebSerialConnection.isAvailable()`
- **User Port Selection**: Browser native port picker dialog
- **USB Vendor Filters**: Pre-configured for common USB-to-serial chips
- **Stream Management**: Efficient ReadableStream/WritableStream handling
- **Graceful Cleanup**: Proper resource cleanup on disconnect

#### Configuration Options

```ts
{
    baudRate: 115200,          // Baud rate (default: 115200)
    dataBits: 8,               // Data bits: 7 or 8
    stopBits: 1,               // Stop bits: 1 or 2
    parity: 'none',            // Parity: 'none', 'even', 'odd'
    flowControl: 'none',       // Flow control: 'none', 'hardware'
    bufferSize: 4096,          // Buffer size in bytes
    filters: [...]             // USB vendor ID filters (optional)
}
```

#### Default USB Filters

```ts
[
    { usbVendorId: 0x10c4 }, // Silicon Labs CP210x
    { usbVendorId: 0x1a86 }, // QinHeng CH340
    { usbVendorId: 0x0403 }, // FTDI
    { usbVendorId: 0x067b }, // Prolific PL2303
    { usbVendorId: 0x2341 }, // Arduino
];
```

#### API

```ts
// Static methods
static isAvailable(): boolean

// Instance methods (inherited + implemented)
async connect(options): Promise<void>
async disconnect(): Promise<void>
async send(data): Promise<void>
```

#### Usage Example

```ts
// Check browser support
if (!WebSerialConnection.isAvailable()) {
    alert('Web Serial API not supported. Use Chrome or Edge.');
    return;
}

// Create connection
const connection = new WebSerialConnection({
    logger: console.log,
    filters: [{ usbVendorId: 0x10c4 }], // Override default filters
});

// Subscribe to events
connection.addEventListener('connected', (event) => {
    console.log('Connected:', event.detail.connectionInfo);
});

connection.addEventListener('data', (event) => {
    const decoder = new TextDecoder();
    const text = decoder.decode(event.detail.data);
    console.log('Received:', text);
});

connection.addEventListener('error', (event) => {
    console.error('Error:', event.detail.error);
});

// Connect (shows port picker)
await connection.connect({ baudRate: 115200 });

// Send data
const encoder = new TextEncoder();
await connection.send(encoder.encode('print("hello")\r\n'));

// Disconnect
await connection.disconnect();
```

#### Error Handling

```ts
try {
    await connection.connect();
} catch (error) {
    if (error.name === 'NotFoundError') {
        console.log('User cancelled port selection');
    } else if (error.name === 'NetworkError') {
        console.error('Failed to connect to device');
    } else {
        console.error('Connection error:', error);
    }
}
```

---

### DeviceConnection

**Location**: `src/micro_otter/nodes/html/js/serial/device-connection.ts`

High-level manager that coordinates serial connections and implements MicroPython communication protocols.

#### Purpose

- Manage multiple connection providers (WebSerial, WebSocket, etc.)
- Implement MicroPython REPL protocol
- Parse incoming data for message type markers
- Route messages to appropriate handlers
- Report progress for file transfers and operations

#### Key Features

- **Provider Management**: Support multiple connection types
- **MicroPython Protocol**: REPL commands, file transfer, reset controls
- **Message Parsing**: Automatic parsing of `[type]` markers in device output
- **Progress Integration**: ProgressEventBus integration for long operations
- **Command Queue**: Sequential command execution with timeout handling
- **Raw REPL Transition Guard**: Concurrent raw REPL entry requests are coalesced to one transition

#### Message Types

```ts
export const MessageType = Object.freeze({
    USER: 'user', // User code output
    SYSTEM: 'system', // System messages
    ERROR: 'error', // Error messages
    WARNING: 'warning', // Warning messages
    INFO: 'info', // Informational messages
    DEBUG: 'debug', // Debug messages
    OTTER: 'otter', // Structured runtime logs from [otter]
    RAW: 'raw', // Unparsed raw output
});
```

#### Connection States

```ts
export const ConnectionState = Object.freeze({
    DISCONNECTED: 'disconnected',
    CONNECTING: 'connecting',
    CONNECTED: 'connected',
    ERROR: 'error',
});
```

#### Events

- **`message`**: Parsed message from device (detail: `{ type, message, timestamp }`)
- **`statechange`**: Connection state changed (detail: `{ state, previousState }`)
- **`error`**: Error occurred (detail: `{ error, context }`)
- **`raw`**: Raw data received (detail: `{ data }`) - for debugging

#### Configuration

```ts
{
    providers: {
        webserial: {
            name: 'Web Serial',
            description: 'Direct USB serial connection',
            instance: new WebSerialConnection()
        },
        websocket: {
            name: 'WebSocket',
            description: 'Network connection via WebSocket',
            instance: new WebSocketConnection()
        }
    },
    defaultProvider: 'webserial',
    logger: console,
    receiveTimeout: 5000,    // Timeout for receive operations (ms)
    commandTimeout: 10000    // Timeout for command operations (ms)
}
```

#### API

```ts
// Provider management
getProviders(): object
getActiveProviderKey(): string|null
setActiveProvider(providerKey): void

// Connection lifecycle
async connect(providerKey?, options?): Promise<void>
async disconnect(): Promise<void>
isConnected(): boolean
getState(): string

// MicroPython protocol
async enterRawREPL(): Promise<void>
async exitRawREPL(): Promise<void>
async executeCode(code): Promise<string>
async sendFile(remotePath, content): Promise<void>
async softReset(): Promise<void>
async hardReset(): Promise<void>

// File operations
async readTextFile(path): Promise<string>
async writeTextFile(path, content): Promise<void>
async receiveFile(path): Promise<Uint8Array>
async deleteFile(path): Promise<void>
async deleteFolderRecursive(path): Promise<void>
async removeFolder(path, options?): Promise<number>
async deleteFileSystem(): Promise<string>
async ensureDirectory(dirPath): Promise<void>
async listFiles(path?): Promise<FileEntry[]>
async listFilesRecursive(startPath?): Promise<string>
async calculateHash(path): Promise<string>
async getDeviceInfo(): Promise<object>

// Data transmission
async send(data): Promise<void>
async sendLine(line): Promise<void>
async waitForPrompt(timeout?): Promise<void>

// Message handling
_parseMessage(text): { type, message }
```

#### Usage Example

```ts
// Create manager with WebSerial provider
const webserial = new WebSerialConnection();
const deviceConnection = new DeviceConnection({
    providers: {
        webserial: {
            name: 'Web Serial',
            description: 'Direct USB serial connection',
            instance: webserial,
        },
    },
    defaultProvider: 'webserial',
});

// Subscribe to parsed messages
deviceConnection.addEventListener('message', (event) => {
    const { type, message } = event.detail;
    console.log(`[${type}] ${message}`);
});

// Subscribe to state changes
deviceConnection.addEventListener('statechange', (event) => {
    console.log('State:', event.detail.state);
});

// Connect
await deviceConnection.connect('webserial', { baudRate: 115200 });

// Execute Python code
const result = await deviceConnection.executeCode('print(1 + 1)');
console.log('Result:', result); // "2"

// Transfer file
await deviceConnection.sendFile('/main.py', pythonCode);

// Soft reset device
await deviceConnection.softReset();

// Disconnect
await deviceConnection.disconnect();
```

#### Removing Folders

`deleteFolderRecursive(path)` removes a tree and reports nothing back, so a caller cannot tell
"the folder was there and is now gone" from "there was nothing to remove". `removeFolder(path,
{ recursive })` performs the same removal but **returns the number of removed entries including the
folder itself** (`0` when the folder did not exist, could not be removed because it is not empty, or
`recursive: false` was used on a non-empty folder). Deployment uses that count to decide whether the
removal counts as a device change and therefore needs a soft reset:

| Call | Effect |
|------|--------|
| `removeFolder('otter_vars')` | Recursive tree removal; returns `entries + 1`, or `0` if absent |
| `removeFolder('otter_vars', { recursive: false })` | `os.rmdir` only — folder must be empty; returns `1`, or `0` if absent/not empty |

Both forms print `REMOVED: <n>` from the device and reject when the device reports `ERROR:`.

#### MicroPython Protocol Details

**Message Parsing**:

Device output with markers is automatically parsed:

```python
# In MicroPython code
print("[info] System initialized")
print("[error] Sensor not found")
print("User output")  # No marker = 'user' type
```

**File Transfer Protocol**:

1. Enter Raw REPL mode (`Ctrl+A`)
2. Send file content as Python command
3. Execute to write file
4. Exit Raw REPL mode (`Ctrl+B`)

**Soft Reset**: Sends `Ctrl+D` to restart MicroPython runtime without power cycle

**Hard Reset**: Sends `machine.reset()` and then disconnects the host-side connection so UI state is explicitly `disconnected` and reconnect is required.

**Play / Start Execution (`startMain`)**:

- Uses a soft reset startup path for a clean interpreter state
- Avoids raw-command timeout behavior for long-running runtime loops
- Prevents stacked/duplicate `main_loop` instances from repeated start actions
- Uses an explicit start action instead of executing `import main` as raw command text

**Stop / Interrupt (`Ctrl+C`)**:

- Sends `Ctrl+C` to interrupt active runtime code
- Re-establishes REPL control for post-stop device operations

---

### ConsoleLogView

**Location**: `src/micro_otter/nodes/html/js/views/console-log-view.ts`

ViewBase-compatible console log view with timestamped messages, type-based icons, and interactive features.

#### Purpose

- Display messages from device and application
- Provide type-based visual differentiation
- Support copy-to-clipboard functionality
- Implement efficient circular buffer for memory management

#### Key Features

- **Circular Buffer**: Configurable max messages (default: 1000)
- **Type Icons**: Material Icons mapped to message types
- **Timestamps**: Optional HH:MM:SS timestamps
- **Auto-scroll**: Smart auto-scroll with user override detection
- **Copy Support**: Copy all messages or selection to clipboard
- **i18n Integration**: Translatable UI elements
- **ViewBase Lifecycle**: Full attachment/detachment/serialization support

#### Default Message Types

```ts
{
    info: { icon: 'info', className: 'msg-info' },
    error: { icon: 'error', className: 'msg-error' },
    warning: { icon: 'warning', className: 'msg-warning' },
    success: { icon: 'check_circle', className: 'msg-success' },
    user: { icon: 'person', className: 'msg-user' },
    system: { icon: 'settings', className: 'msg-system' },
    data: { icon: 'data_object', className: 'msg-data' }
}
```

#### Configuration

```ts
{
    maxMessages: 1000,         // Circular buffer size
    showTimestamps: true,      // Show timestamps
    showIcons: true,           // Show type icons
    messageTypes: {},          // Custom type configs
    autoScroll: true,          // Auto-scroll to new messages
    i18nService,               // Translation service
    logger                     // Logger instance
}
```

#### API

```ts
// Message management
addMessage(type, message, timestamp?): void
clear(): void
getMessages(): LogMessage[]

// Display configuration
setShowTimestamps(show): void
setShowIcons(show): void
setAutoScroll(enabled): void

// User actions
copyAll(): void
copySelected(): void
scrollToBottom(): void

// ViewBase methods
serialize(): object
static deserialize(data, createChild, context): ConsoleLogView
```

#### Usage Example

```ts
const consoleView = new ConsoleLogView({
    maxMessages: 500,
    showTimestamps: true,
    showIcons: true,
    autoScroll: true,
    i18nService: myI18nService,
});

consoleView.attachTo(containerElement);

// Add messages
consoleView.addMessage('info', 'Application started');
consoleView.addMessage('user', 'Hello from device');
consoleView.addMessage('error', 'Connection timeout');
consoleView.addMessage('system', 'File transfer complete');

// Copy to clipboard
consoleView.copyAll();

// Clear console
consoleView.clear();
```

#### Custom Message Types

```ts
const consoleView = new ConsoleLogView({
    messageTypes: {
        custom: {
            icon: 'star',
            className: 'msg-custom',
            label: 'console.types.custom',
        },
    },
});

consoleView.addMessage('custom', 'Custom message type');
```

#### Styling

CSS classes for customization (see `styles/standard/console-log-view.css`):

```css
.console-log-view {
    /* Container */
}
.console-log-view__header {
    /* Header with controls */
}
.console-log-view__messages {
    /* Scrollable message area */
}
.console-log-view__message {
    /* Individual message */
}
.console-log-view__timestamp {
    /* Timestamp */
}
.console-log-view__icon {
    /* Type icon */
}
.console-log-view__text {
    /* Message text */
}

/* Message type classes */
.msg-info {
    /* Info messages */
}
.msg-error {
    /* Error messages */
}
.msg-warning {
    /* Warning messages */
}
.msg-success {
    /* Success messages */
}
.msg-user {
    /* User output */
}
.msg-system {
    /* System messages */
}
.msg-data {
    /* Data messages */
}
```

---

### DeviceConnectionView

**Location**: `src/micro_otter/nodes/html/js/views/device-connection-view.ts`

Composite ViewBase component that integrates connection controls, device management, and console logging into a unified interface.

#### Purpose

- Provide complete device connection UI
- Coordinate toolbar controls with DeviceConnection manager
- Route device messages to console view
- Handle connection lifecycle events
- Display errors and status updates

#### Architecture

```
DeviceConnectionView (vertical SplitView)
  ├─ CollapsibleView "Connections"
  │   └─ ToolbarView
  │       ├─ Play / Stop
  │       └─ Soft reset / Hard reset
  ├─ CollapsibleView "<device view title>" (only when a custom view is available)
  │   └─ CustomRuntimeView (showHeader: false)
  └─ CollapsibleView "Device Log"
      └─ ConsoleLogView
          └─ Message display
```

#### Key Features

- **Collapsible panes**: the connection toolbar, the device-provided runtime configuration, and the device log each render as a `CollapsibleView` pane of one vertical `SplitView`. The runtime title comes from the definition's `title`, and the hosted `CustomRuntimeView` suppresses its own top-level header to avoid duplication
- **Composite View**: Combines ToolbarView, CustomRuntimeView and ConsoleLogView via SplitView
- **State Management**: Tracks connection state, updates controls dynamically
- **Log Lifecycle**: A transition into `connecting` clears the console log and writes the `Connecting...` notice, so every connect path (the title-bar badge, the deployment view, a custom view action) starts a session with an empty log
- **No connection controls**: the view has no provider dropdown, port chooser or Connect/Disconnect button. The one connection surface is the title-bar cable badge and [`DeviceConnectionDialogView`](../view-system/device-connection-dialog.md); see [the device connection UI](device-connection-ui.md)
- **Event Routing**: DeviceConnection events → Console messages
- **i18n Support**: Translatable labels and messages
- **Serialization**: Persists connection settings and console state

#### Configuration

```ts
{
    (deviceConnection, // Required: DeviceConnection instance
        i18nService, // Optional: Translation service
        logger, // Optional: Logger (default: console)
        title, // Optional: View title (default: 'Device Connection')
        icon); // Optional: Icon (default: 'cable')
}
```

#### API

```ts
// Console management (delegates to ConsoleLogView)
clearLog(): void

// Connection status (read-only: the dialog owns the transition)
getConnectionStatus(): { connected: boolean; provider: string | null }

// ViewBase methods
serialize(): object
static deserialize(data, createChild, context): DeviceConnectionView
```

#### Usage Example

```ts
// Create with DeviceConnection instance
const deviceConnectionView = new DeviceConnectionView({
    deviceConnection: workspace.deviceConnection,
    i18nService: workspace.i18nService,
    title: 'ESP32 Connection',
    icon: 'cable',
});

// Attach to container
deviceConnectionView.attachTo(containerElement);

// Access child views if needed
const consoleView = deviceConnectionView._consoleView;
consoleView.addMessage('system', 'Ready');

// Serialize for persistence
const state = deviceConnectionView.serialize();
// {
//     type: 'DeviceConnectionView',
//     consoleState: { ... }
// }
```

#### Toolbar Actions

| Action ID    | Description                | State Requirements |
| ------------ | -------------------------- | ------------------ |
| `play`       | Start execution on device  | Connected, idle    |
| `stop`       | Stop execution on device   | Connected, running |
| `softReset`  | Soft reset (Ctrl+D)        | Connected          |
| `hardReset`  | Hard reset (`machine.reset()`) | Connected      |

#### Event Flow

```
User clicks the cable badge in the title bar
  ↓
DeviceConnectionDialogView.open() closes the dialog and calls
DeviceConnection.connect()
  ↓
DeviceConnection emits 'statechange' (state: 'connecting')
  ↓
DeviceConnectionView clears the console log and writes the
'Connecting...' notice; the title-bar badge shows 'Connecting…'
  ↓
DeviceConnection emits 'connected'
  ↓
ConsoleLogView.addMessage('system', 'Connected')
  ↓
DeviceConnection emits 'message' events
  ↓
ConsoleLogView displays messages
```

---

## Integration with Workspace

The WebSerial components integrate with the main application via Workspace:

```ts
// src/micro_otter/nodes/html/js/core/workspace.ts

import { DeviceConnection } from '../serial/device-connection.js';
import { WebSerialConnection } from '../serial/webserial-connection.js';

class Workspace {
    constructor() {
        // Create DeviceConnection with WebSerial provider
        this.deviceConnection = new DeviceConnection({
            providers: {
                webserial: {
                    name: 'Web Serial',
                    description: 'Direct USB serial connection',
                    instance: new WebSerialConnection({
                        logger: (msg) => this._log('webserial', msg),
                    }),
                },
            },
            defaultProvider: 'webserial',
            logger: this._logger,
        });

        // Subscribe to connection events
        this.deviceConnection.addEventListener('statechange', (event) => {
            this._log('device-connection-state', event.detail);
        });

        // Pass to ViewManager context for views
        this.viewManager.updateViewContext({
            deviceConnection: this.deviceConnection,
        });
    }
}
```

---

## ViewFactory Registration

WebSerial views are registered in ViewFactory for serialization support:

```ts
// src/micro_otter/nodes/html/js/views/view-factory.ts

import { ConsoleLogView } from './console-log-view.js';
import { DeviceConnectionView } from './device-connection-view.js';

class ViewFactory {
    constructor({ deviceConnection, ...rest }) {
        // Store reference
        this._deviceConnection = deviceConnection;

        // Register views
        this.register('ConsoleLogView', ConsoleLogView);
        this.register('DeviceConnectionView', DeviceConnectionView);
    }

    create(data) {
        const context = {
            deviceConnection: this._deviceConnection,
            // ... other context
        };
        return target.deserialize(data, (child) => this.create(child), context);
    }
}
```

---

## Testing Strategy

### Automated Tests

**Phase 1-2** (SerialConnectionBase, WebSerialConnection):

- Mock Web Serial API for browser-independent testing
- Test abstract interface contracts
- Test connection lifecycle
- Test error handling
- Test stream management

**Test Locations**:

- `tests/webserial/serial-connection-base.test.js`
- `tests/webserial/webserial-connection.test.js`

### Manual Testing

**Phase 3-6** (Views and Integration):

- DOM rendering and interactions
- Real device connection with ESP32
- ViewBase lifecycle (attach/detach/resize)
- Copy-to-clipboard functionality
- Auto-scroll behavior
- i18n language switching
- Serialization/deserialization
- Cross-browser testing (Chrome, Edge)

**Manual Testing Guide**: `docs/dev/webserial-manual-testing.md`

---

## Error Handling Patterns

### Connection Errors

```ts
try {
    await deviceConnection.connect();
} catch (error) {
    if (error.name === 'NotFoundError') {
        // User cancelled port selection
        consoleView.addMessage('warning', 'Port selection cancelled');
    } else if (error.name === 'NetworkError') {
        // Device connection failed
        consoleView.addMessage('error', `Connection failed: ${error.message}`);
    } else {
        // Other errors
        consoleView.addMessage('error', `Error: ${error.message}`);
    }
}
```

### Protocol Errors

```ts
deviceConnection.addEventListener('error', (event) => {
    const { error, context } = event.detail;

    switch (context) {
        case 'send':
            consoleView.addMessage('error', `Send failed: ${error.message}`);
            break;
        case 'protocol':
            consoleView.addMessage('error', `Protocol error: ${error.message}`);
            break;
        default:
            consoleView.addMessage('error', `Error (${context}): ${error.message}`);
    }
});
```

### Timeout Handling

```ts
try {
    await deviceConnection.executeCode('import time; time.sleep(20)');
} catch (error) {
    if (error.message.includes('timeout')) {
        consoleView.addMessage('warning', 'Command timed out');
        // Attempt recovery
        await deviceConnection.softReset();
    }
}
```

---

## Cancellation

Every connection transport, `DeviceConnection` and `DeviceConnectionMonitor` share one
cancellation contract so a user can always abort a `connecting` attempt (the cable badge opens a
cancel-only dialog while one is in flight):

- `ConnectCancelledError` (exported from `serial-connection-base.ts`, alongside
  `isConnectCancelled(error)`) is the error a cancelled `connect()` settles with. `DeviceConnection`
  and the monitor treat it as "settle on `disconnected`", never as a failure, so the badge does not
  latch `Failed` for a user cancel.
- `SerialConnectionBase.cancelConnect()` is a documented no-op; a transport that awaits an unbounded
  operation must override it to release the transport, settle the pending `connect()` with
  `ConnectCancelledError`, never emit an `error` event, and never throw. `WebSocketConnection` and
  `WebSerialConnection` both implement it.
- `connect()` is single-flight at every layer: a second call while one is pending joins the existing
  attempt instead of opening a second socket/port, which is what previously orphaned the first
  attempt's promise and made a wrong-port connect appear to hang forever.
- `WebSerialConnection` additionally bounds `port.open()` with `SERIAL_OPEN_TIMEOUT_MS = 15000`, so a
  driver that never settles rejects instead of leaving the badge spinning; `requestPort()` stays
  unbounded because it is the user's own port picker.

---

## Performance Considerations

### Message Buffer Management

ConsoleLogView uses a circular buffer to prevent memory growth:

```ts
// When maxMessages = 1000
addMessage(type, message) {
    if (this._messages.length >= this._maxMessages) {
        this._messages.shift(); // Remove oldest
    }
    this._messages.push(new LogMessage(type, message));
    this._renderMessages();
}
```

### Auto-scroll Optimization

Smart auto-scroll detects user scroll intent:

```ts
_onScroll() {
    const container = this._messagesContainer;
    const isAtBottom = container.scrollHeight - container.scrollTop <= container.clientHeight + 5;

    if (!isAtBottom && this._autoScroll) {
        this._userScrolledUp = true; // Disable auto-scroll
    }
}
```

### Stream Chunk Processing

WebSerialConnection processes data in chunks to avoid blocking:

```ts
async _readLoop() {
    try {
        while (true) {
            const { value, done } = await this._reader.read();
            if (done) break;

            // Process chunk asynchronously
            this._emitData(value);

            // Yield to event loop
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    } catch (error) {
        this._emitError(error, 'read');
    }
}
```

---

## Future Enhancements

### Out of Scope (Phase 1-6)

- Runtime and collection deployment
- Firmware update (OTA)
- WebSocket connection implementation
- Bluetooth (BLE) serial communication
- Multi-device simultaneous connections
- Command history and recall
- Interactive REPL interface

### Potential Extensions

- **WebSocketConnection**: serial proxy through `micro-otter serve` — implemented, see
  [websocket-serial-bridge.md](websocket-serial-bridge.md)
- **BluetoothConnection**: BLE serial communication
- **DeviceManager**: Multi-device session management
- **REPLView**: Interactive Python REPL with syntax highlighting
- **FileExplorerView**: Browse device filesystem
- **PerformanceMonitor**: Device performance metrics display

---

## Related Documentation

- **[DeviceDeployment API](../deployment/device-deployment-api.md)** - High-level deployment operations API reference
- **[Deployment System Architecture](../deployment/deployment-system-architecture.md)** - DeviceDeployment layer overview
- **[View System Architecture](../view-system/view-system-architecture.md)** - ViewBase lifecycle and patterns
- **[Progress Event System](../core/progress-event-system.md)** - Progress reporting integration
- **[I18n Architecture](../core/i18n-architecture.md)** - Translation system
- **[MicroPython Protocol](micropython-protocol.md)** - Device communication protocol
- **[Manual Testing Guide](webserial-manual-testing.md)** - Manual test procedures
- **[Coding Style Guide](../guides/coding-style-guide.md)** - Code standards and conventions

---

## Summary

The WebSerial architecture provides a clean, extensible foundation for device communication:

**Key Takeaways:**

- ✅ Abstract interface enables multiple connection types
- ✅ DeviceConnection manages protocol and providers
- ✅ ViewBase integration follows established patterns
- ✅ Message parsing provides structured device output
- ✅ Progress reporting integrates with ProgressEventBus
- ✅ Comprehensive error handling at all layers
- ✅ Manual testing covers DOM and hardware scenarios

**Design Principles:**

- Separation of concerns (connection, protocol, UI)
- Polymorphic provider management
- Event-driven architecture
- Progressive enhancement (browser support detection)
- Resource cleanup and memory management

The architecture is ready for extension with additional connection types (WebSocket, Bluetooth) and enhanced features (deployment, REPL, file explorer) in future development phases.
