# WebSerial Testing Guide

## Overview

This guide provides comprehensive manual testing procedures for the WebSerialConnection class. Due to browser API dependencies and hardware interaction requirements, automated testing is not feasible for most functionality.

**Target Hardware**: ESP32 development board with MicroPython firmware  
**Supported Browsers**: Chrome 89+, Edge 89+  
**Test Duration**: Approximately 30-45 minutes

---

## Prerequisites

### Hardware Requirements

- ESP32 development board (ESP32-DevKitC or similar)
- USB cable (data-capable, not charge-only)
- Computer with available USB port

### Software Requirements

- MicroPython firmware installed on ESP32
- Chrome or Edge browser (latest version)
- Micro-Otter application running locally

### Setup Steps

1. Flash MicroPython firmware to ESP32 if not already installed
2. Connect ESP32 to computer via USB
3. Start local development server: `uv run micro-otter` or `mo`
4. Open browser to `http://localhost:8000`
5. Open browser DevTools console (F12) for logging

---

## Test Scenarios

### 1. Browser Support Detection

**Purpose**: Verify Web Serial API availability detection

**Steps**:
1. Open application in Chrome/Edge
2. Open DevTools console
3. Execute: `WebSerialConnection.isAvailable()`
4. Verify returns `true`

**Expected Result**: `true` in Chrome/Edge

**Alternative Test**:
1. Open application in Firefox or Safari
2. Execute: `WebSerialConnection.isAvailable()`
3. Verify returns `false`

**Expected Result**: `false` in unsupported browsers

**Status**: ⬜ Pass / ⬜ Fail

---

### 2. Connection Lifecycle - Normal Flow

**Purpose**: Verify complete connection lifecycle

**Steps**:
1. Click "Connect" button (or trigger connection via UI)
2. Browser shows port selection dialog
3. Select ESP32 port from list
4. Wait for connection to establish
5. Verify console shows connection info
6. Verify UI updates to "Connected" state

**Expected Results**:
- Port selection dialog appears
- Dialog lists available USB serial devices
- Connection succeeds after selection
- Console logs: `Connection established { type: 'webserial', ... }`
- UI shows connected state with device info
- Events fire in order: `connecting` → `connected`

**Status**: ⬜ Pass / ⬜ Fail

---

### 3. User Cancels Port Selection

**Purpose**: Verify graceful handling of user cancellation

**Steps**:
1. Click "Connect" button
2. Port selection dialog appears
3. Click "Cancel" or press Escape
4. Verify no error modal shown
5. Verify UI remains in disconnected state

**Expected Results**:
- Cancellation is handled gracefully
- No error dialog shown to user (expected behavior)
- Console logs: `User cancelled port selection`
- UI returns to disconnected state
- No side effects or hung state

**Status**: ⬜ Pass / ⬜ Fail

---

### 4. Data Transmission - Basic Commands

**Purpose**: Verify data can be sent to device

**Steps**:
1. Connect to ESP32
2. Send command: `print("hello")\r\n`
3. Verify output appears in console/output area
4. Send command: `import sys; sys.version\r\n`
5. Verify MicroPython version displayed
6. Send command: `1 + 1\r\n`
7. Verify result `2` displayed

**Expected Results**:
- All commands execute on device
- Output appears in application console
- Console shows: "hello", MicroPython version, "2"
- No errors or timeouts

**Status**: ⬜ Pass / ⬜ Fail

---

### 5. Data Transmission - Binary Data

**Purpose**: Verify Uint8Array transmission

**Steps**:
1. Connect to ESP32
2. Create Uint8Array: `new Uint8Array([0x70, 0x72, 0x69, 0x6E, 0x74])`
3. Send via `connection.send(bytes)`
4. Verify device receives bytes

**Expected Results**:
- Binary data transmitted correctly
- Device responds appropriately
- No encoding errors

**Status**: ⬜ Pass / ⬜ Fail

---

### 6. Data Reception - Single Messages

**Purpose**: Verify data received from device

**Steps**:
1. Connect to ESP32
2. Send: `print("test message")\r\n`
3. Verify "test message" appears in console
4. Verify 'data' event fires
5. Check event.detail.data is Uint8Array

**Expected Results**:
- Output appears in console
- Data event contains Uint8Array payload
- Text decoded correctly for display

**Status**: ⬜ Pass / ⬜ Fail

---

### 7. Data Reception - High Frequency

**Purpose**: Verify handling of rapid message stream

**Steps**:
1. Connect to ESP32
2. Send command: `for i in range(100): print(i)\r\n`
3. Observe console output
4. Verify all numbers 0-99 appear
5. Check for lag or missed messages
6. Verify no browser performance issues

**Expected Results**:
- All messages received
- Console scrolls smoothly
- No lag or freezing
- Application remains responsive

**Status**: ⬜ Pass / ⬜ Fail

---

### 8. Data Reception - Large Chunks

**Purpose**: Verify handling of large data payloads

**Steps**:
1. Connect to ESP32
2. Send: `print("x" * 2048)\r\n` (2KB string)
3. Verify entire output received
4. Check console displays complete data
5. Repeat with 4KB: `print("x" * 4096)\r\n`

**Expected Results**:
- Large data chunks received completely
- No truncation or corruption
- Application handles large payloads gracefully

**Status**: ⬜ Pass / ⬜ Fail

---

### 9. Graceful Disconnection

**Purpose**: Verify clean disconnect process

**Steps**:
1. Connect to ESP32
2. Send test command to verify connection
3. Click "Disconnect" button
4. Verify console logs disconnection
5. Verify UI updates to disconnected state
6. Check DevTools memory (no leaks)

**Expected Results**:
- Events fire in order: `disconnecting` → `disconnected`
- Console logs: "Disconnected"
- UI shows disconnected state
- Read loop stops
- Resources released (reader, writer, port)
- No memory leaks visible in DevTools heap snapshot

**Status**: ⬜ Pass / ⬜ Fail

---

### 10. Physical Device Disconnect

**Purpose**: Verify detection of unexpected disconnection

**Steps**:
1. Connect to ESP32
2. Physically unplug USB cable
3. Verify UI updates to disconnected state
4. Verify error/warning message shown
5. Verify 'disconnected' event fires with reason: 'device-disconnect'
6. Reconnect USB cable
7. Click "Connect" again
8. Verify reconnection succeeds

**Expected Results**:
- Disconnect detected automatically
- UI updates immediately
- User-friendly message shown
- Event detail includes `reason: 'device-disconnect'`
- Reconnection works after re-plugging

**Status**: ⬜ Pass / ⬜ Fail

---

### 11. Error Handling - Send When Disconnected

**Purpose**: Verify error handling for invalid operations

**Steps**:
1. Ensure device is disconnected
2. Attempt to send data
3. Verify error thrown
4. Verify error message: "Cannot send: not connected"
5. Verify error logged to console

**Expected Results**:
- Operation fails with clear error
- Error message is user-friendly
- Application remains stable

**Status**: ⬜ Pass / ⬜ Fail

---

### 12. Error Handling - Invalid Data Type

**Purpose**: Verify type validation on send

**Steps**:
1. Connect to ESP32
2. Attempt to send invalid data: `connection.send(123)`
3. Verify TypeError thrown
4. Verify error message: "Data must be string or Uint8Array"

**Expected Results**:
- Operation fails with TypeError
- Clear error message
- Application remains stable

**Status**: ⬜ Pass / ⬜ Fail

---

### 13. Multiple Connect/Disconnect Cycles

**Purpose**: Verify resource cleanup and stability

**Steps**:
1. Connect to ESP32
2. Send test command
3. Disconnect
4. Repeat steps 1-3 ten times (10 cycles)
5. Open DevTools → Memory tab
6. Take heap snapshot before test
7. Take heap snapshot after 10 cycles
8. Compare for memory leaks

**Expected Results**:
- All 10 cycles complete successfully
- Each connection works identically
- No memory leaks detected
- No degraded performance
- No hanging connections

**Status**: ⬜ Pass / ⬜ Fail

---

### 14. Connection State Management

**Purpose**: Verify state transitions are correct

**Steps**:
1. Check initial state: `connection.getState()` → 'disconnected'
2. Start connection
3. During connection: state → 'connecting'
4. After connection: state → 'connected'
5. Start disconnect
6. During disconnect: state → 'disconnecting'
7. After disconnect: state → 'disconnected'

**Expected Results**:
- All state transitions occur correctly
- State matches UI representation
- 'statechange' events fire for each transition

**Status**: ⬜ Pass / ⬜ Fail

---

### 15. Connection Info Accuracy

**Purpose**: Verify connection metadata is correct

**Steps**:
1. Connect to ESP32
2. Retrieve connection info via event or method
3. Verify contains:
   - `type: 'webserial'`
   - `usbVendorId` (numeric)
   - `usbProductId` (numeric)
   - `baudRate: 115200`
   - Configuration parameters

**Expected Results**:
- All fields present and correct
- Vendor/Product IDs match device
- Configuration matches requested settings

**Status**: ⬜ Pass / ⬜ Fail

---

### 16. Already Connected State

**Purpose**: Verify handling of duplicate connection attempts

**Steps**:
1. Connect to ESP32
2. Attempt to connect again (while connected)
3. Verify operation is ignored
4. Verify console logs: "Already connected, ignoring connect request"
5. Verify no side effects

**Expected Results**:
- Duplicate connection ignored gracefully
- No errors thrown
- Existing connection unaffected
- Console logs informative message

**Status**: ⬜ Pass / ⬜ Fail

---

### 17. Disconnect When Not Connected

**Purpose**: Verify harmless disconnect on disconnected state

**Steps**:
1. Ensure device is disconnected
2. Call disconnect()
3. Verify operation completes silently
4. Verify console logs: "Not connected, ignoring disconnect request"
5. Verify no errors thrown

**Expected Results**:
- Operation is no-op
- No errors or warnings
- Application remains stable

**Status**: ⬜ Pass / ⬜ Fail

---

### 18. Custom Baud Rate

**Purpose**: Verify configuration parameter handling

**Steps**:
1. Connect with custom baud rate: `connect({ baudRate: 9600 })`
2. Verify connection succeeds
3. Check connection info includes `baudRate: 9600`
4. Disconnect
5. Connect with different rate: `connect({ baudRate: 57600 })`
6. Verify new rate applied

**Expected Results**:
- Custom baud rates applied correctly
- Connection info reflects actual settings
- Device communication works at specified rate

**Status**: ⬜ Pass / ⬜ Fail

---

### 19. Custom USB Filters

**Purpose**: Verify port filtering works

**Steps**:
1. Connect with custom filters: 
    ```ts
   connect({ 
     filters: [{ usbVendorId: 0x10c4 }] // Silicon Labs only
   })
   ```
2. Verify port dialog only shows matching devices
3. Verify connection succeeds with filtered device

**Expected Results**:
- Port dialog filters devices correctly
- Only matching vendor IDs shown
- Connection works with custom filters

**Status**: ⬜ Pass / ⬜ Fail

---

### 20. Long-Running Session

**Purpose**: Verify stability over extended usage

**Steps**:
1. Connect to ESP32
2. Send periodic commands every 10 seconds
3. Let run for 10 minutes (60 commands total)
4. Verify all commands succeed
5. Verify no memory growth in DevTools
6. Verify no performance degradation
7. Disconnect cleanly

**Expected Results**:
- Session remains stable for 10+ minutes
- All commands execute successfully
- No memory leaks
- Performance consistent throughout
- Clean disconnect at end

**Status**: ⬜ Pass / ⬜ Fail

---

## Cross-Browser Testing

### Chrome

**Version**: _____________  
**Operating System**: _____________

**Tests**:
- [ ] All scenarios 1-20 pass
- [ ] Performance is acceptable
- [ ] No browser-specific issues

---

### Edge

**Version**: _____________  
**Operating System**: _____________

**Tests**:
- [ ] All scenarios 1-20 pass
- [ ] Performance is acceptable
- [ ] No browser-specific issues

---

### Firefox (Negative Test)

**Version**: _____________

**Tests**:
- [ ] `isAvailable()` returns false
- [ ] Clear error message shown: "Web Serial API not supported"
- [ ] UI gracefully handles unavailability

---

### Safari (Negative Test)

**Version**: _____________

**Tests**:
- [ ] `isAvailable()` returns false
- [ ] Clear error message shown: "Web Serial API not supported"
- [ ] UI gracefully handles unavailability

---

## Performance Benchmarks

### Data Throughput

**Test**: Send 1000 short commands rapidly

**Measured Metrics**:
- Total time: _____________ ms
- Throughput: _____________ commands/sec
- Memory used: _____________ MB
- CPU usage: _____________ %

**Expected**: < 10 seconds, < 50 MB memory, < 30% CPU

---

### Large Data Transfer

**Test**: Send 10MB of data in 1MB chunks

**Measured Metrics**:
- Total time: _____________ seconds
- Transfer rate: _____________ KB/s
- Memory peak: _____________ MB

**Expected**: < 30 seconds, > 300 KB/s, < 100 MB memory

---

## Issue Tracking

### Known Issues

| Issue | Severity | Status | Notes |
|-------|----------|--------|-------|
| (none yet) | - | - | - |

### Discovered Issues During Testing

| Issue | Scenario | Severity | Details |
|-------|----------|----------|---------|
| | | | |

---

## Sign-Off

### Tester Information

**Name**: _____________________  
**Date**: _____________________  
**Browser**: _____________________  
**OS**: _____________________

### Test Summary

**Total Tests**: 20  
**Passed**: _____  
**Failed**: _____  
**Blocked**: _____

### Overall Assessment

⬜ All critical tests pass - approved for merge  
⬜ Minor issues found - approved with notes  
⬜ Major issues found - requires fixes before merge

**Notes**:
_____________________________________________
_____________________________________________
_____________________________________________

---

## Appendix: Quick Reference

### Common ESP32 Commands

```python
# Check MicroPython version
import sys; sys.version

# Test print
print("hello")

# List files
import os; os.listdir()

# Test loop (high frequency)
for i in range(100): print(i)

# Large output
print("x" * 2048)

# Get system info
import esp; esp.flash_size()
```

### DevTools Memory Profiling

1. Open DevTools (F12)
2. Go to Memory tab
3. Click "Take snapshot"
4. Perform test operations
5. Click "Take snapshot" again
6. Compare snapshots for leaks

### Common Error Names

- `NotFoundError` - User cancelled port selection
- `NetworkError` - Device disconnected or communication error
- `InvalidStateError` - Port already open/closed
- `TypeError` - Invalid data type

---

## Related Documentation

- Phase 2 Implementation Plan
- [Web Serial API Specification](https://wicg.github.io/serial/)
- [Coding Style Guide](../guides/coding-style-guide.md)
