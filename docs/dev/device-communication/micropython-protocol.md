# MicroPython Protocol Implementation

## Overview

This document describes the MicroPython communication protocol implemented in DeviceConnection for reliable device control, file transfer, and runtime management.

## Protocol Layers

### 1. Transport Layer (Serial Connection)

The transport layer provides raw byte-stream communication via serial connection providers:

- **WebSerial**: Direct USB serial via the Web Serial API (Chromium only)
- **WebSocket**: Serial proxy through `micro-otter serve`; see
  [websocket-serial-bridge.md](websocket-serial-bridge.md) — this is how Firefox reaches a board,
  and the path whose 4096-byte reads expose any parser that depends on read boundaries
- **Bluetooth**: BLE serial communication (future)

**Key Features**:

- Bidirectional byte streams
- Configurable baud rate (default: 115200)
- Error detection and handling
- Connection lifecycle management

### 2. REPL Protocol Layer

MicroPython provides two REPL modes:

#### Normal REPL Mode

- Interactive prompt (`>>>`)
- Human-friendly output
- Echo of input characters
- Line editing support

#### Raw REPL Mode

- Machine-friendly protocol
- No echo, no prompt
- Deterministic execution
- Binary-safe data transfer

**DeviceConnection uses Raw REPL mode** for reliable programmatic control.

## Raw REPL Protocol

The byte sequences below are what the pinned runtime actually emits. They were verified against
`shared/runtime/pyexec.c` at MicroPython v1.29.0 (`pyexec_raw_repl`,
`pyexec_raw_repl_process_char`, and `parse_compile_execute` with `EXEC_FLAG_PRINT_EOF`) and against
`mpremote`'s `transport_serial.py` (`enter_raw_repl`, `exit_raw_repl`, `exec_raw_no_follow`,
`follow`). The executable specification for the browser side is
`tests/serial/device-connection-raw-repl-protocol.test.js`.

### Entering Raw REPL

**Sequence**:

1. Send `\r\x03` (CR + Ctrl+C) — interrupts any running program and leaves a paste session.
2. Wait for the line to go idle (30 ms of silence, capped at 1 s) instead of a fixed delay, so a
   traceback that is still printing is not cut off.
3. Discard everything the interrupt produced.
4. Send `\r\x01` (CR + Ctrl+A) — switches the device to raw REPL.
5. Wait for the complete banner `raw REPL; CTRL-B to exit\r\n>`; the `>` belongs to it, and entry is
   not complete before it arrives.
6. Up to 3 attempts run inside the entry budget. A rejected `send()` aborts immediately instead of
   retrying, because then the port, not the protocol, is at fault.

`DeviceConnection` deliberately does **not** soft reset during entry. `mpremote` sends `\x04` after
entering and waits for `soft reboot`; the app must not restart a runtime it is about to configure, so
the running program is interrupted rather than restarted.

**Implementation**: `_enterRawRepl` → `_performRawReplEntry` → `_attemptRawReplEntry` in
`js/serial/device-connection.ts`. Entry is single-flight: concurrent callers join one
`_rawReplTransitionPromise` and `raw-repl-entered` is emitted once.

### Executing Commands

**Wire format of one command**:

```
Host   → Device: <python_code>\x04
Device → Host: OK                 (exactly two bytes, no CR/LF)
Device → Host: <stdout bytes>
Device → Host: \x04
Device → Host: <stderr bytes>     (traceback text, or nothing)
Device → Host: \x04
Device → Host: >                  (prompt for the next command)
```

**Rules the parser follows** (`RawByteReader`, `_readRawFrame`):

1. Everything is matched on **bytes**, never on decoded text, so a multi-byte UTF-8 sequence or an
   output byte that resembles a marker cannot shift a match.
2. `OK` is exactly `0x4F 0x4B`. There is no newline after it, so a parser that looks for `OK\r\n`
   never matches and silently resolves with an empty result.
3. stdout ends at the **first** `0x04`, stderr runs to the **second**, and the trailing `>` must
   arrive before the command counts as complete. A frame without its prompt times out rather than
   resolving early.
4. No parser may depend on read boundaries. The WebSocket bridge reads `reader.read(4096)`, which
   coalesces ack + output + markers into one message, while Web Serial often delivers the ack alone.
5. An ack other than `OK` raises `DeviceProtocolError` carrying the offending bytes (hex preview)
   instead of being retried or swallowed.

**Error contract**:

| Situation | Channel | Visible as |
|---|---|---|
| Helper failure printed by device code (`ERROR: ...`) | stdout | `executeCode()` returns it; callers test `startsWith('ERROR:')` |
| Uncaught exception | stderr | logged as `raw-command-stderr`; `executeCodeDetailed()` returns it |

`executeCode()` returns stdout only; `executeCodeDetailed()` returns `{ stdout, stderr }` for callers
that must tell an empty success from a swallowed failure.

### Leaving Raw REPL

`exitRawRepl()` sends `\x02` (Ctrl+B) and waits for `>>>`. `disconnect()` performs the same
best-effort write before the port closes, so a board is never left interrupted in raw mode; a failing
write is logged and teardown continues. `hardReset()` skips the Ctrl+B because `machine.reset()`
already ended the session.

## File Transfer Protocol

### Sending Files to Device

**Protocol**: Use raw REPL with chunked base64 writes for reliability

**Command Structure**:

```python
import ubinascii
_data = ubinascii.a2b_base64("<base64-chunk>")
with open('/path/to/file.py', 'ab') as f:
    f.write(_data)
```

**Steps**:

1. Convert content to bytes (TextEncoder for strings)
2. Base64-encode the bytes
3. Chunk the base64 data (4096 chars per chunk)
4. For each chunk, decode with `ubinascii.a2b_base64()` and append to the file

**Limitations**:

- Large files must be chunked to avoid command length limits
- File path must be valid on target filesystem
- Base64 adds overhead (about 33 percent), but is stable for transport

**Implementation**:

```ts
async sendFile(path, content) {
    const data = typeof content === 'string'
        ? new TextEncoder().encode(content)
        : content;

    const base64 = this._arrayToBase64(data);
    const chunkSize = 4096;

    for (let offset = 0; offset < base64.length; offset += chunkSize) {
        const chunk = base64.slice(offset, offset + chunkSize);
        const command = `
import ubinascii
_data = ubinascii.a2b_base64("${chunk}")
with open('${path}', 'ab') as f:
    f.write(_data)
`;
        await this._executeRawCommand(command);
    }
}
```

### Receiving Files from Device

**Protocol**: Use raw REPL to read files via Python code

**Command Structure**:

```python
with open('/path/to/file.py', 'rb') as f:
    print(f.read())
```

**Steps**:

1. Build Python command to read file
2. Execute via raw REPL
3. Capture output (file contents)
4. Parse binary data from output

**Limitations**:

- Large files may exceed output buffer
- Binary data must be safely transmitted
- File path must exist on device

**Implementation**:

```ts
async receiveFile(path) {
    const command = `
with open('${path}', 'rb') as f:
    print(f.read())
`;

    const result = await this._executeRawCommand(command);
    return result;
}
```

## Message Parsing

### Message Markers

Device code can emit structured messages using markers:

**Format**: `[type] message content`

**Supported Types**:

- `[user]` - User code output
- `[system]` - System messages
- `[error]` - Error messages
- `[warning]` - Warning messages
- `[info]` - Informational messages
- `[debug]` - Debug messages
- `[otter]` - Structured runtime JSON logs (startup, WiFi, fatal diagnostics, etc.)

**Example Device Code**:

```python
print('[user] Hello from device')
print('[system] Initialization complete')
print('[error] Sensor not found')
```

### Parser Implementation

**Regex Pattern**:

```ts
const messageRegex =
    /\[(user|system|error|warning|info|debug|otter)\]\s*(.+?)(?=(?:\r?\n)|(?:\[(?:user|system|error|warning|info|debug|otter)\])|$)/gs;
```

**Parsing Logic**:

1. Accumulate incoming data in buffer
2. Search for message markers using regex
3. Extract type and message content
4. Emit parsed messages via EventTarget
5. Keep unparsed data in buffer for next iteration

**Buffering Strategy**:

- Keep unparsed data in buffer between receives
- Emit as raw if buffer exceeds 1000 bytes without markers
- Clear processed data from buffer

**Raw Command Output Routing**:

During raw REPL command execution (capability checks, file reads, etc.), DeviceConnection uses a temporary command-specific data handler. At command completion, captured output is parsed through the normal message parser so tagged lines (including `[otter]`) still reach the Console Log view.

**Implementation**:

```ts
_parseMessages(text) {
    this._receiveBuffer += text;

    const messageRegex = /\[(user|system|error|warning|info|debug|otter)\]\s*(.+?)(?=(?:\r?\n)|(?:\[(?:user|system|error|warning|info|debug|otter)\])|$)/gs;
    let match;
    let lastIndex = 0;

    while ((match = messageRegex.exec(this._receiveBuffer)) !== null) {
        const type = match[1];
        const message = match[2].trim();
        this._emitMessage(type, message);
        lastIndex = match.index + match[0].length;
    }

    if (lastIndex > 0) {
        this._receiveBuffer = this._receiveBuffer.slice(lastIndex);
    }

    if (this._receiveBuffer.length > 1000 && lastIndex === 0) {
        this._emitMessage(MessageType.RAW, this._receiveBuffer);
        this._receiveBuffer = '';
    }
}
```

## Device Control Commands

### Soft Reset (Ctrl+D)

**Purpose**: Restart device Python runtime without hardware reset

**Command**: `\x04` (Ctrl+D)

**Behavior**:

- Executes pending code in paste mode
- Reloads all modules
- Clears REPL state
- Faster than hard reset

### Hard Reset (machine.reset)

**Purpose**: Full runtime restart from device side.

**Command**: `import machine; machine.reset()`

**Behavior**:

- Sent directly without waiting for raw-command completion markers
- Host disconnects immediately after issuing reset
- UI transitions to disconnected state; user reconnect is expected

### Start Execution (`startMain`)

**Purpose**: Start the runtime main loop from the UI Play action.

**Behavior**:

- Uses soft reset startup path (`Ctrl+D` in friendly REPL) to ensure a single clean runtime instance
- Avoids command-timeout failures caused by long-running main loops
- Prevents duplicate loop instances from repeated starts
- Does not execute `import main` as a long-running raw command

**Use Cases**:

- Apply code changes
- Reset runtime state
- Recover from errors

**Implementation**:

```ts
async softReset() {
    await this._activeConnection.send('\x04');
    this._emitMessage(MessageType.SYSTEM, 'Device soft reset');
}
```

### Hard Reset (machine.reset())

**Purpose**: Full hardware reset of device

**Command**: Execute Python code `import machine; machine.reset()`

**Behavior**:

- Full MCU reset
- All peripherals reinitialized
- Filesystem preserved
- Connection may drop

**Use Cases**:

- Reset hardware peripherals
- Clear all state completely
- Recover from crashes

**Implementation**:

```ts
async hardReset() {
    await this.executeCode('import machine; machine.reset()');
    this._emitMessage(MessageType.SYSTEM, 'Device hard reset');
}
```

### Interrupt / Stop (Ctrl+C)

**Purpose**: Stop currently running code

**Command**: `\x03` (Ctrl+C)

**Behavior**:

- Raises KeyboardInterrupt
- Returns host control to REPL (raw REPL re-acquired after interrupt)
- Safe to use anytime

**Use Cases**:

- Stop infinite loops
- Cancel long operations
- Return to interactive control

## Progress Reporting

File transfer operations emit progress events via ProgressEventBus:

**Event Format**:

```ts
{
    source: 'file-send-/main.py',
    type: 'start',
    message: 'Sending /main.py...',
    progress: 0
}
```

**Progress Stages**:

1. **START** - Operation begins
2. **UPDATE** - Progress updates (if applicable)
3. **COMPLETE** - Operation succeeds
4. **ERROR** - Operation fails

**Integration**:

```ts
const tracker = new ProgressTracker(`file-send-${path}`);
tracker.start(`Sending ${path}...`);

try {
    await this._executeRawCommand(command);
    tracker.complete(`Successfully sent ${path}`);
} catch (error) {
    tracker.error(`Failed to send ${path}`, error);
    throw error;
}
```

## Error Handling

### Connection Errors

**Scenarios**:

- Port not available
- Permission denied
- Device disconnected
- Communication timeout

**Handling**:

- Emit error events via EventTarget
- Transition to ERROR state
- Clean up resources
- Allow reconnection

### Protocol Errors

**Scenarios**:

- Invalid command syntax
- Timeout waiting for response
- Unexpected device output
- File operation failures

**Handling**:

- Parse error messages from device
- Emit structured error events
- Preserve connection if possible
- Log detailed error information

### Recovery Strategies

**Soft Errors** (recoverable):

- Retry operation
- Skip problematic data
- Continue with warning

**Hard Errors** (unrecoverable):

- Disconnect connection
- Clean up resources
- Notify user
- Require manual intervention

## Best Practices

### 1. Always Use Raw REPL

- More reliable than normal REPL
- Deterministic execution
- Binary-safe data transfer

### 2. Handle Timeouts

- Set reasonable timeout values
- Distinguish between slow and failed operations
- Allow cancellation

### 3. Validate Device Responses

- Require the two-byte `OK` ack, not a text marker found anywhere in the buffer
- Require both `0x04` markers and the trailing `>` before treating a command as complete
- Keep stdout and stderr apart; a helper's `ERROR: ...` is on stdout, a traceback is on stderr

### 4. Buffer Management

- Handle partial receives
- Implement circular buffering
- Clear buffers on disconnect

### 5. Progress Reporting

- Report progress for long operations
- Provide meaningful status messages
- Enable cancellation

### 6. Error Messages

- Include context (operation, file, command)
- Distinguish error types
- Provide recovery suggestions

## Protocol Extensions

### Future Enhancements

**Chunked File Transfer**:

- Split large files into chunks
- Report progress per chunk
- Resume interrupted transfers

**Binary Protocol**:

- Escape special characters
- Encode/decode binary data
- Verify checksums

**Compression**:

- Compress files before transfer
- Decompress on device
- Reduce transfer time

**Multiplexing**:

- Multiple simultaneous operations
- Command queuing
- Priority handling

## References

- [MicroPython REPL documentation](https://docs.micropython.org/en/latest/reference/repl.html)
- [`shared/runtime/pyexec.c`](https://github.com/micropython/micropython/blob/v1.29.0/shared/runtime/pyexec.c)
  — `pyexec_raw_repl`, `pyexec_raw_repl_process_char`, `parse_compile_execute` (the `OK` ack, the
  `0x04` markers and the trailing `>` all originate here)
- [`mpremote` transport](https://github.com/micropython/micropython/blob/v1.29.0/tools/mpremote/mpremote/transport_serial.py)
  — `enter_raw_repl`, `exec_raw_no_follow`, `follow`
- [Web Serial API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API)

## Related Documentation

- **[websocket-serial-bridge.md](websocket-serial-bridge.md)** — the transport caveats this protocol
  must survive: `read(4096)` coalescing, one client per port, and the open retry window
- **[webserial-architecture.md](webserial-architecture.md)** — Complete WebSerial system architecture and API reference
- [SerialConnectionBase API](../../../src/micro_otter/nodes/html/js/serial/serial-connection-base.ts)
- [WebSerial Implementation](../../../src/micro_otter/nodes/html/js/serial/webserial-connection.ts)
- [DeviceConnection API](../../../src/micro_otter/nodes/html/js/serial/device-connection.ts)
- [Raw-REPL protocol tests](../../../tests/serial/device-connection-raw-repl-protocol.test.js)
- [Progress Event System](../core/progress-event-system.md)
