# WebSerial Manual Testing Guide

## Overview

This guide provides comprehensive manual testing procedures for the Phase 6 integration of WebSerial components. These tests cover scenarios that require DOM interaction, real devices, or browser-specific features that cannot be easily automated.

**Target Components:**
- ConsoleLogView (view rendering and interactions)
- DeviceConnectionView (composite view with toolbar and console)
- DeviceConnection (MicroPython protocol communication)
- WebSerialConnection (browser Web Serial API)

**Prerequisites:**
- Chrome or Edge browser (Web Serial API support required)
- ESP32 device with MicroPython firmware
- USB cable for serial connection
- Running dev server: `uv run micro-otter` or `mo`

---

## Test Environment Setup

### 1. Start Development Server

```powershell
# In project root
uv run micro-otter
# or
mo

# Server should start at http://localhost:8000/
```

### 2. Open Browser DevTools

- Open Chrome DevTools (F12)
- Switch to Console tab for debug output
- Enable "Preserve log" to track messages across navigation

### 3. Prepare Test Device

- Connect ESP32 to computer via USB
- Verify device appears in Device Manager (Windows) or `ls /dev/tty*` (Linux/Mac)
- Note: MicroPython firmware should be installed (but device reset is acceptable for testing)

---

## Test Scenarios

### Scenario 1: ViewFactory Registration

**Objective:** Verify ConsoleLogView and DeviceConnectionView are registered and can be deserialized.

**Steps:**

1. Open browser console
2. Navigate to http://localhost:8000/
3. Wait for app to load completely
4. In console, type:
   ```ts
   const factory = window.workspace.viewManager.viewFactory;
   console.log('ConsoleLogView registered:', factory._registry.has('ConsoleLogView'));
   console.log('DeviceConnectionView registered:', factory._registry.has('DeviceConnectionView'));
   ```

**Expected Results:**
- Both should log `true`
- No registration errors in console

---

### Scenario 2: Workspace Integration

**Objective:** Verify DeviceConnection instance is created and available.

**Steps:**

1. Open browser console
2. Navigate to http://localhost:8000/
3. Wait for app to load completely
4. In console, type:
   ```ts
   const workspace = window.workspace;
   console.log('DeviceConnection exists:', workspace.deviceConnection !== undefined);
   console.log('Providers:', workspace.deviceConnection.getProviders());
   ```

**Expected Results:**
- `DeviceConnection exists: true`
- `Providers: { webserial: { name: 'Web Serial', description: '...', instance: WebSerialConnection } }`
- No errors about missing deviceConnection

---

### Scenario 3: DeviceConnectionView Layout Integration

**Objective:** Verify DeviceConnectionView can be added to the main layout.

**Steps:**

1. Open browser console
2. Navigate to http://localhost:8000/
3. Wait for app to load
4. In console, create and attach a DeviceConnectionView:
   ```ts
   const { DeviceConnectionView } = await import('./js/views/device-connection-view.js');
   const view = new DeviceConnectionView({
       deviceConnection: workspace.deviceConnection,
       i18nService: workspace.i18nService,
       logger: console
   });
   
   // Create container and attach
   const container = document.createElement('div');
   container.style.cssText = 'position: fixed; top: 50px; left: 50px; width: 600px; height: 400px; z-index: 9999; background: var(--mo-surface-1);';
   document.body.appendChild(container);
   view.attachTo(container);
   ```

**Expected Results:**
- View renders with toolbar at top and console below
- Toolbar shows "Provider" dropdown and "Connect" button
- Console shows "No messages yet" placeholder
- No errors in console

---

### Scenario 4: Connection Lifecycle - Connect

**Objective:** Test connection establishment and state updates.

**Steps:**

1. Follow Scenario 3 to create DeviceConnectionView
2. Click "Connect" button in toolbar
3. Browser should prompt for serial port selection
4. Select ESP32 device from list
5. Click "Connect" in browser prompt

**Expected Results:**
- Button changes to "Disconnect" with updated icon
- Provider dropdown becomes disabled
- Console shows connection messages:
  - `[system] Provider changed to webserial`
  - `[system] Connected via Web Serial`
- No errors in console

**Cleanup:**
- Click "Disconnect" before next test

---

### Scenario 5: Connection Lifecycle - Disconnect

**Objective:** Test graceful disconnection.

**Steps:**

1. Follow Scenario 4 to establish connection
2. Click "Disconnect" button
3. Wait for disconnect to complete

**Expected Results:**
- Button changes back to "Connect"
- Provider dropdown becomes enabled
- Console shows: `[system] Disconnected from device`
- No errors about port closure

---

### Scenario 6: Message Display - MicroPython REPL

**Objective:** Verify device messages are parsed and displayed correctly.

**Steps:**

1. Connect to device (Scenario 4)
2. Device should emit MicroPython REPL prompt or boot messages
3. Observe console view

**Expected Results:**
- Messages appear with timestamps
- Message types indicated by icons (system, device, etc.)
- Messages are readable and properly formatted
- No duplicate messages
- Auto-scroll to bottom as new messages arrive

---

### Scenario 7: Console Log Clearing

**Objective:** Test clear functionality.

**Steps:**

1. With messages in console (from Scenario 6)
2. Click "Clear" button in toolbar (trash icon)
3. Observe console

**Expected Results:**
- All messages cleared
- "No messages yet" placeholder appears
- No errors in console

---

### Scenario 7b: Console Log Cleared When Connecting

**Objective:** Verify every new device session starts with an empty console log.

**Steps:**

1. Fill the console with messages (Scenario 6)
2. Disconnect, then connect again — either with the toolbar Connect button or with
   Connect in the Deployment view

**Expected Results:**
- The console is cleared when the connection attempt starts
- "Connecting..." is the first message of the new session
- No messages from the previous session remain
- Messages that arrive after the attempt started (boot output, transfer progress) are kept

---

### Scenario 8: i18n Language Switching

**Objective:** Verify translations update correctly.

**Steps:**

1. Create DeviceConnectionView (Scenario 3)
2. Open browser console
3. Switch language:
   ```ts
   await workspace.i18nService.setLocale('de');
   ```
4. Observe UI

**Expected Results:**
- Toolbar button labels change to German:
  - "Connect" → "Verbinden"
  - "Disconnect" → "Trennen"
  - "Clear" → "Löschen"
- Provider label changes to "Anbieter"
- Console placeholder changes to "Noch keine Nachrichten"

**Cleanup:**
```ts
await workspace.i18nService.setLocale('en');
```

---

### Scenario 9: View Serialization

**Objective:** Test view state persistence through serialization/deserialization.

**Steps:**

1. Create DeviceConnectionView (Scenario 3)
2. Connect to device (Scenario 4)
3. In console:
   ```ts
   // Serialize view
   const serialized = view.serialize();
   console.log('Serialized:', serialized);
   
   // Create new container
   const container2 = document.createElement('div');
   container2.style.cssText = 'position: fixed; top: 50px; right: 50px; width: 600px; height: 400px; z-index: 9999; background: var(--mo-surface-1);';
   document.body.appendChild(container2);
   
   // Deserialize
   const context = {
       deviceConnection: workspace.deviceConnection,
       i18nService: workspace.i18nService,
       logger: console
   };
   const view2 = DeviceConnectionView.deserialize(
       serialized,
       (type, data, ctx) => workspace.viewManager.viewFactory.create(type, data, ctx),
       context
   );
   view2.attachTo(container2);
   ```

**Expected Results:**
- Deserialized view renders correctly
- Connection state is NOT restored (deviceConnection is shared)
- No errors during serialization/deserialization

---

### Scenario 10: Error Handling - No Port Selected

**Objective:** Test user cancels port selection.

**Steps:**

1. Create DeviceConnectionView (Scenario 3)
2. Click "Connect"
3. In browser port picker, click "Cancel"

**Expected Results:**
- Console shows error message: `[error] Connection error: User cancelled port selection` (or similar)
- Button remains in "Connect" state
- No uncaught exceptions

---

### Scenario 11: Error Handling - Device Disconnect

**Objective:** Test unexpected device disconnection.

**Steps:**

1. Connect to device (Scenario 4)
2. Physically unplug USB cable from device
3. Observe console

**Expected Results:**
- Console shows error: `[error] Connection error: Port disconnected` (or similar)
- Button automatically returns to "Connect" state
- Provider dropdown re-enabled
- No uncaught exceptions

---

### Scenario 12: Performance - High Message Rate

**Objective:** Test console view performance with rapid messages.

**Steps:**

1. Connect to device (Scenario 4)
2. In console, simulate high message rate:
   ```ts
   // Simulate 100 rapid messages
   for (let i = 0; i < 100; i++) {
       view._consoleView.addMessage('device', `Test message ${i}`);
   }
   ```
3. Observe console rendering

**Expected Results:**
- All 100 messages appear in console
- Rendering remains smooth (no freezing)
- Auto-scroll to bottom works correctly
- Console maintains circular buffer (old messages dropped if limit exceeded)

---

### Scenario 13: Clipboard Copy

**Objective:** Test copy-to-clipboard functionality.

**Steps:**

1. Add some messages to console (Scenario 12)
2. Click "Copy" button in toolbar
3. Open a text editor and paste (Ctrl+V)

**Expected Results:**
- Clipboard contains all console messages
- Messages formatted as plain text with timestamps
- No HTML markup in pasted content
- Toast notification: "Log copied to clipboard" (if implemented)

**Note:** May require HTTPS or localhost for clipboard access in some browsers.

---

### Scenario 14: ResizeObserver - Dynamic Resizing

**Objective:** Test view responds to container size changes.

**Steps:**

1. Create DeviceConnectionView (Scenario 3)
2. In DevTools Elements panel, select the container div
3. In Styles panel, modify container height:
   ```css
   height: 200px;
   ```
4. Then change to:
   ```css
   height: 600px;
   ```

**Expected Results:**
- View resizes smoothly
- Toolbar remains at top
- Console fills remaining space
- No visual glitches or overflow

---

### Scenario 15: Memory Leak - Attach/Detach Cycles

**Objective:** Verify no memory leaks on repeated attach/detach.

**Steps:**

1. Open DevTools Memory tab
2. Take heap snapshot (baseline)
3. In console:
   ```ts
   // Attach/detach 50 times
   const { DeviceConnectionView } = await import('./js/views/device-connection-view.js');
   for (let i = 0; i < 50; i++) {
       const container = document.createElement('div');
       document.body.appendChild(container);
       
       const view = new DeviceConnectionView({
           deviceConnection: workspace.deviceConnection,
           i18nService: workspace.i18nService,
           logger: console
       });
       view.attachTo(container);
       view.beforeDetach();
       container.remove();
   }
   ```
4. Force garbage collection (DevTools → Performance Monitor → Collect garbage)
5. Take another heap snapshot

**Expected Results:**
- Heap size returns to near baseline (±5 MB tolerance)
- No retained DeviceConnectionView instances in snapshot
- No event listeners left attached to document/window

---

### Scenario 16: Cross-Browser - Edge

**Objective:** Verify functionality in Microsoft Edge.

**Steps:**

1. Open Edge browser
2. Navigate to http://localhost:8000/
3. Repeat Scenarios 1-8

**Expected Results:**
- All scenarios behave identically to Chrome
- Web Serial API available and functional
- No browser-specific errors

---

### Scenario 17: Cross-Browser - Firefox (Negative Test)

**Objective:** Verify graceful degradation when Web Serial API unavailable.

**Steps:**

1. Open Firefox browser
2. Navigate to http://localhost:8000/
3. Attempt to create DeviceConnectionView (Scenario 3)
4. Click "Connect"

**Expected Results:**
- DeviceConnectionView renders normally
- On connect click, error message appears:
  - "Web Serial API not available in this browser"
- Console logs warning about missing API
- App does not crash

---

## Test Results Template

Use this template to record test results:

```
Test Date: YYYY-MM-DD
Tester: [Your Name]
Browser: Chrome/Edge [Version]
Device: ESP32 [Model]
Server: http://localhost:8000/

| Scenario | Status | Notes |
|----------|--------|-------|
| 1. ViewFactory Registration | ✅ PASS | |
| 2. Workspace Integration | ✅ PASS | |
| 3. Layout Integration | ✅ PASS | |
| 4. Connect | ✅ PASS | |
| 5. Disconnect | ✅ PASS | |
| 6. Message Display | ✅ PASS | |
| 7. Clear Console | ✅ PASS | |
| 8. i18n Switching | ✅ PASS | |
| 9. Serialization | ✅ PASS | |
| 10. No Port Selected | ✅ PASS | |
| 11. Device Disconnect | ✅ PASS | |
| 12. High Message Rate | ✅ PASS | |
| 13. Clipboard Copy | ✅ PASS | |
| 14. Dynamic Resize | ✅ PASS | |
| 15. Memory Leak Check | ✅ PASS | |
| 16. Edge Browser | ✅ PASS | |
| 17. Firefox (Negative) | ✅ PASS | |

Issues Found:
[List any bugs or issues discovered]

Performance Notes:
[Record any performance observations]
```

---

## Debugging Tips

### Enable DeviceConnection Logging

```ts
// In browser console
window.workspace.deviceConnection._logger = console;
```

### Enable ConsoleLogView Logging

```ts
// In browser console
const view = /* get your view instance */;
view._logger = console;
```

### Monitor ProgressEventBus

```ts
import { ProgressEventBus } from './js/core/progress-events.ts';
ProgressEventBus.subscribe((event) => {
    console.log('[Progress]', event.type, event.source, event.message);
});
```

### Inspect View State

```ts
// Get view from viewManager
const rootView = workspace.viewManager.rootView;
console.log('Root view:', rootView);
console.log('Serialized:', rootView.serialize());
```

---

## Known Limitations

1. **Web Serial API**: Only available in Chromium-based browsers (Chrome, Edge, Opera)
2. **Clipboard API**: Requires HTTPS or localhost for security
3. **Real Device Required**: Some tests require actual ESP32 hardware
4. **Platform-Specific**: Serial port names differ between Windows/Mac/Linux

---

## Reporting Issues

When reporting bugs found during manual testing:

1. **Scenario Number**: Which test scenario failed
2. **Browser/Version**: Chrome 120, Edge 119, etc.
3. **Device**: ESP32 model if applicable
4. **Steps to Reproduce**: Exact steps that caused the issue
5. **Expected vs Actual**: What should happen vs what happened
6. **Console Errors**: Copy/paste any error messages
7. **Screenshots**: If visual issue, include screenshot

---

## Related Documentation

- [WebSerial Testing Guide](webserial-testing.md) - Device-specific testing procedures
- [View System Architecture](view-system-architecture.md) - ViewBase lifecycle details
- [Progress Event System](progress-event-system.md) - Event tracking architecture
- [MicroPython Protocol](micropython-protocol.md) - Device communication protocol

---

## Automation Opportunities (Future Work)

While these tests are manual for now, some could be automated in the future:

- **Puppeteer/Playwright**: Automate browser interactions
- **Web Serial API Mocking**: Mock API for automated connection tests
- **Visual Regression Testing**: Percy or Chromatic for UI consistency
- **Performance Benchmarking**: Automated lighthouse tests

