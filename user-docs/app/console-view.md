# Console and output

Three places in the app show output.

| Output | Where | Shows |
|---|---|---|
| Device Log | Device tab | connection state, transfer progress, runtime output, warnings and errors |
| Generated code | Transpiler tab | the MicroPython the active collection transpiles to |
| Build and deploy logs | Firmware tab | compile and flash output ([Firmware view](firmware-view.md)) |

## Device Log

The log sits below the runtime controls in the Device tab and grows downwards: the newest message is at
the bottom. It keeps the last 1000 messages and drops the oldest first.

| Toolbar control | What it does |
|---|---|
| Filter by type | multi-select list of message types, each with its icon and a live message count |
| Select all / Select none | tick or untick every type in the filter |
| Auto-scroll | keeps the newest message in view; highlighted while on |
| Copy | copies the log as plain text and confirms with *Copied!* |
| Clear | empties the log |

| Type | Usually carries |
|---|---|
| System | connection changes and transfer progress |
| Otter | runtime framework messages |
| User | output produced by your own graphs |
| Info | informational status lines |
| Warning | problems that did not stop the run |
| Error | failed operations |
| Success | completed operations |
| Data | payloads received from the device |
| Raw | device lines the log could not classify |

- Filtering only changes what is displayed. **Copy** always copies every message, filtered or not, one
  per line.
- Auto-scroll pauses as soon as you scroll up to read something and resumes when you return to the
  bottom, or when you toggle it off and on again.
- A filter that matches nothing reports what is available instead of showing an empty pane, for example
  `No messages match the current filter. Available: System: 3, User: 1`.

## Transpiler tab

The Transpiler tab holds the code pane and a toolbar of four buttons.

| Button | What it does |
|---|---|
| Transpile | transpiles the active collection into one MicroPython program |
| Copy | copies the generated code to the clipboard |
| Clear | empties the code pane and drops the transpiler cache, so the next transpile rebuilds everything |
| Dump Generated | writes the generated code and artifacts to the local server as a debug dump |

- The Transpile button is highlighted while the collection has changed since the last transpile, so a
  stale pane is visible at a glance.
- Transpiling disables the toolbar buttons and runs a progress bar until the code pane is updated.
- A failed transpile opens a **Transpilation Error** dialog with the reason and details. The messages
  name the graph with the cycle, the node type without a node definition or without a Python
  implementation, or the invalid connection.
- The pane always shows Python; there is no language switch.
- **Dump Generated** appears only when the transpile debug channel is on — in a development build, with
  `?debugTranspileDump` in the URL, or with `microOtter.debug.transpileDump = '1'` in local storage. It
  is enabled only after a successful transpile and needs the local server, because the dump is posted to
  `/__debug/transpile-dump`.

## Related

- [Device view](device-view.md) — where the Device Log lives, and the runtime controls above it.
- [Deploy view](deploy-view.md) — deploy progress is reported in the Device Log.
- [Firmware view](firmware-view.md) — build and deploy logs of the firmware tools.
