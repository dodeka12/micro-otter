# Changes since version 1.25.0

## New Features
- **Ctrl+drag copies nodes** — holding Ctrl/⌘ while dragging a node now duplicates it (or the whole
  selection) and drags the copy, leaving the originals in place. The copies start exactly underneath
  the originals so the pointer keeps its grab offset, and the copies become the new selection
  (`Ctrl+Drag copy nodes` is its own undo group, the follow-up move a second one).
- **Graph panel toolbar** — the graph view now has a toolbar above the canvas with the execution
  type (`Startup` / `Loop`) and the sleep duration between loop iterations, separated from the align
  button by a divider. Both controls edit the same `NodeGraph` settings as the collection settings
  view, so a change in either surface shows up immediately in the other, and the values are
  persisted by the usual workspace autosave. The compact row keeps the dropdown untitled and sizes
  the sleep field so that all five digits of the maximum interval stay visible.
- **Align nodes to grid** — a toolbar button snaps every node onto the grid. All nodes move in a
  single undo step, and the action is a silent no-op when everything is already aligned.
- **Sleep control hidden for run-once graphs** — with execution type `startup` the toolbar hides the
  sleep duration, matching the behaviour of the graph settings view (the loop interval is unused
  there).
- **Print node can be switched off** — the `print` node has a new `enabled` input (default `true`),
  so a graph can silence its console output without rewiring the value; connect a boolean to the
  input to control printing at runtime.
- **`mqtt-read` has a `Default` fallback** — the node gained a `Default` connector input with an
  inline numeric default control (`0` when unconfigured) and a `Default when disconnected` checkbox.
  It now emits the last usable value, the configured default, or the type default — never `None` —
  so a topic that has not delivered a message yet still produces a typed value.
- **New `mqtt-status` node** — exposes the broker connection state as a `connected` bool output, so a
  graph can react to a dropped link without polling the read nodes.
- **One JSON parse per payload and type** — coerced payloads are cached per
  `(topic, value_type, json_key)` and invalidated by the message sequence number, so several read
  nodes sharing a topic no longer each decode the same payload on every tick.

- **MQTT telemetry on the device console** — the MQTT runtime and its service adapter now narrate
  every step as `[info] mqtt:` / `[error] mqtt:` lines that the web console renders as info/error
  entries: which settings file was read, the broker URL, client id and keepalive being attempted,
  the connect result with elapsed milliseconds and a readable MQTT reason code
  (`not-authorized`, `bad-username-or-password`, …), every subscribed topic, pump start/stop,
  connection loss, the first payload per topic, and the first skipped/failed publish per topic.
  Payloads are truncated to 32 characters and never repeat per message, so the 50 ms pump stays
  quiet.
- **Service controller explains skipped services** — `sync()` now logs why a service was not
  started (`disabled`, `transport not ready (sta_connected=False ap_active=True)`) and why it was
  stopped, but only when the reason changes, so the 30 s resync tick does not repeat itself.

## Bug Fixes
- **Alt+drag detaches a pass-through node** — the bypass gesture moved from Ctrl/⌘ to Alt so it no
  longer competes with the new copy drag: holding Alt while dragging a pass-through node out of a
  connection wires its upstream directly to its downstream (using the original downstream input
  index) and leaves the node free. The rewire is deferred until the pointer moves more than 4 px so
  Alt+Click still toggles selection, and Alt+drag on a node without connections keeps panning the
  canvas.
- **Capability tooltips survive a tab switch** — the tooltip element is re-attached to the canvas
  host when the graph view is re-mounted, so capability warnings keep appearing after switching
  tabs instead of silently disappearing.
- **Input connectors keep their space** — a default control on a row shared with an output used to
  stop at a fixed 84-px lane reserved for the output label, leaving as little as 18 px. The row now
  reserves only the *measured* width of the output label plus a 6-px gap, and nodes widen
  automatically (and refuse to shrink) until the control keeps a usable minimum width. The auto-grow
  runs once per node on first render, so existing graphs settle after a single save; widths never
  shrink back, and connect/disconnect no longer changes a node's width.
- **Pickier node layout** — a node now grows to fit its panel controls (number 80 px,
  dropdown/text 96 px, slider 120 px value floors) instead of squeezing a dropdown into 40 px. All
  inline controls share one label and one value column, aligned with the connector rows, and labels
  are ellipsised only when a node is forced narrower than its content.
- **Title and spacing fixes** — long node titles are ellipsised between the type icon and the
  collapse chevron instead of running underneath them, control and connector rows no longer touch
  (21 px connector pitch, 12 px section gap), and a hairline separator divides the controls section
  from the connector rows.
- **Connected nodes glow blue** — one-hop neighbours of a selection now draw a blue ring, outline and
  halo instead of the selection-yellow used by the selected node, so the actual selection is
  unambiguous at a glance.
- **Connected nodes brighten** — one-hop neighbours of a selection now blend their own body fill
  toward white, so the neighbour highlight reads on the node surface and not only on the ring; the
  selected node keeps its normal fill and yellow ring.
- **Readable connector highlight labels** — dragging a connection no longer recolours an allowed
  connector's label with its data-type colour, which made light types such as `any` invisible on
  light nodes. The label keeps the node text colour on a dark pill with a data-type-coloured border,
  and allowed inputs now use the same highlight treatment as allowed outputs.
- **Input controls highlight like their labels** — dragging a connection (or hovering) now draws the
  same dark, data-type-bordered pill behind an allowed input's default control label, so allowed
  targets look identical whether the input shows a plain label or a widget.
- **Cut removes the nodes immediately** — choosing *Cut* from the node context menu (or pressing
  Ctrl/⌘+X) now copies the selection and removes it from the graph in one undoable history group,
  as expected. Previously the nodes were only copied and stayed in place, so a cut looked like a
  plain copy until the next paste. Pasting after the cut creates new nodes from the copied payload;
  undo restores the original nodes together with their previous selection.
- **ADC Input points the right way** — the `adc-input` node now uses the DAC Output icon with the
  arrow pointing down (analog in) instead of the unrelated blood-pressure glyph, so the analog pair
  reads as an up/down arrow couple in the palette and on the canvas.
- **Web Value Store Load fires on startup** — the `web-store-load` node's `Load` input now
  defaults to `true`, so a Load node placed in an *Init* graph restores the persisted `_webcontrol`
  values on the first tick without an extra click.
- **MQTT read nodes no longer crash without a message** — the loop generator emitted
  `_mqtt.take_latest(topic)` and coerced the result, so a topic with no new message produced
  `float(None)` and stopped the whole graph. The node now reads a sticky, typed value that never
  returns `None`.
- **MQTT read nodes no longer steal each other's messages** — freshness is tracked per node
  (`key='_mqtt_read_<nodeId>'`) instead of per topic, so two read nodes on one topic both report
  every message instead of starving one another.
- **MQTT subscriptions registered after the link is up are now sent** — `register_subscription()`
  subscribes immediately when the runtime is already connected. Previously the boot-time connect
  meant graph-init registrations only appended to the list and no topic was ever subscribed.
- **A quiet MQTT link is no longer dropped by the broker** — the message pump never sent `PINGREQ`,
  so with the default `keepalive=60` the broker closed the connection after ~90 s of silence, the
  pump silently marked the link down, and the controller only reconnected on the next 30 s resync:
  a permanent flap that lost every message in the gaps. The pump now pings once half the keepalive
  window passed without an outbound packet (a publish counts as activity), the `PINGRESP` is
  consumed transparently by `check_msg()`, and a failing ping tears the link down immediately so the
  reconnect happens on the next tick. The `mqtt` package ships through the `general` firmware, which
  was rebuilt as `0.30.1` with `mqtt 0.15.2` and `runtime 1.48.1`.
- **MQTT username without a password no longer raises** — the runtime passed `password=None`, and
  `umqtt.simple` evaluates `len(password)` while building the CONNECT packet, which failed with
  `TypeError` before a single byte reached the broker. A configured username now always carries a
  password, defaulting to the empty string, and a password without a username is ignored with an
  explanatory log line.
- **`ServiceController.sync()` keeps its no-raise contract** — `enabled()`, `running()` and
  `transport_ready()` were called outside the per-service guard, so one broken adapter aborted the
  reconciliation of every later service (for example the web server and MQTT never starting again).
  A raising state check is now logged once per service as
  `[error] service-controller: <name> state check failed (<exc>)` and skipped.
- **A failed MQTT connect no longer leaks a socket** — the half-open client stayed assigned to the
  runtime, so every retry created another client and left the previous socket open. It is now closed
  and cleared before `start()` returns, and a failed connect reports the broker URL, the elapsed
  time and the MQTT reason code instead of a bare exception.

## Refactor
- **`init_mqtt` emits `_mqtt.start()` once** — the transpiler now drops byte-identical shared-init
  execute blocks, so any number of MQTT nodes contributes exactly one `start()` call after every
  `register_subscription()` / `register_publish()` block.
