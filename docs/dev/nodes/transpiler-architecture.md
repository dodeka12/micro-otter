# Transpiler Architecture

## Overview

The Transpiler is the core code generation engine that converts node graphs into executable Python code for MicroPython devices. It handles dependency resolution, topological sorting, code generation, and output formatting.

**Location**: `src/micro_otter/nodes/html/js/proc/transpiler.ts`

**Key Responsibilities**:
- Convert node graphs to Python code
- Resolve node type implementations via CollectionManager
- Handle imports and library dependencies
- Generate executable main loop code
- Emit progress events during transpilation

---

## Architecture

### Core Components

```
Transpiler
  ├── transpiler-helpers.ts (pure utility functions)
  ├── Collection (data source)
  ├── CollectionManager (node type resolution)
  └── ProgressEventBus (progress tracking)
```

### Dependencies

**Required**:
- `collection`: Collection instance containing node graphs to transpile
- `collectionManager`: CollectionManager for runtime-aware node type lookups
- `deviceRuntime`: Device runtime for target-specific information

**Optional**:
- `logger`: Logging instance (default: console)

---

## Data Flow

```
Collection (node graphs)
  ↓
Transpiler.transpile(collection, { deviceRuntime, collectionManager })
  ↓
1. Validate collection and graphs
2. Build imports and context
3. For each graph:
   a. Topological sort nodes
   b. Generate per-node code
   c. Resolve implementations via CollectionManager
4. Assemble output
  ↓
{ code: string, assets: object }
```

---

## Key Methods

### `transpile(collection, options)`

Main entry point for code generation.

**Parameters**:
```ts
{
  collection: Collection,        // Collection to transpile
  deviceRuntime: object,          // Device runtime instance
  collectionManager: CollectionManager,  // For node type resolution
  language: string = 'python'     // Target language (only 'python' supported)
}
```

**Returns**:
```ts
{
  code: string,      // Generated Python code
  assets: {
    imports: Set,    // Required import statements
    libraries: Set,  // Required library files
    // ... other metadata
  }
}
```

**Progress Events**:
- `START`: Transpilation begins
- `UPDATE`: Per-graph progress (emitted for each graph processed)
- `COMPLETE`: Transpilation succeeded
- `ERROR`: Transpilation failed with error details

**Example**:
```ts
const transpiler = new Transpiler({ logger: console });

try {
    const { code, assets } = await transpiler.transpile(collection, {
        deviceRuntime: activeRuntime,
        collectionManager: workspace.collectionManager
    });
    
    console.log('Generated code:', code);
    console.log('Required imports:', Array.from(assets.imports));
} catch (error) {
    console.error('Transpilation failed:', error);
}
```

---

## Node Implementation Resolution

The Transpiler uses **CollectionManager** to resolve node type implementations in a runtime-aware manner:

```ts
// Old approach (pre-CollectionManager)
const nodeType = nodePackageRegistry.getType(nodeData.type);

// New approach (with CollectionManager)
const nodeType = collectionManager.getNodeType(nodeData.type);
```

**Benefits**:
- Runtime-specific node packages are prioritized
- Global node packages serve as fallbacks
- Clear separation of concerns (CollectionManager owns resolution logic)
- Consistent lookup pattern across all views and tools

---

## Code Generation Pipeline

### 1. Validation Phase

```ts
// Check collection exists
if (!collection) {
    throw new Error('No collection provided');
}

// Check graphs exist
const allGraphs = Object.values(collection.getGraphs() || {});
if (!allGraphs || allGraphs.length === 0) {
    throw new Error('Collection has no graphs to transpile');
}

// Drop disabled graphs before anything else runs
const graphs = allGraphs.filter((graph) => isGraphEnabled(graph));
if (graphs.length === 0) {
    throw new Error('Collection has no enabled graphs to transpile');
}
```

Disabled graphs are removed **before** validation and before any code generation, so a disabled
graph contributes nothing to the firmware: no graph function, no `run()` await (startup awaits or
`asyncio.create_task()` entries), no imports, no shared-init contributions and no helper artifacts.
Its structural problems (dangling connections, missing node definitions) therefore cannot fail the
run either.

`#isGraphEnabled(graph)` reads the optional `getEnabled()` accessor of the structural
`NodeGraphLike` type and treats a graph **without** that accessor as enabled, so test doubles and
third-party graph-shaped objects keep working.

### 2. Context Building

```ts
const context = {
    imports: new Set(),           // Python import statements
    libraries: new Set(),         // Required library files
    functionRegistry: new Map(),  // Node implementation functions
    globalFunctions: new Map(),   // Global utility functions
    deviceRuntime: deviceRuntime,
    collectionManager: collectionManager,
    logger: this.#logger
};
```

### 3. Graph Processing

For each graph:

#### a. Topological Sort

Nodes are sorted based on connection dependencies:

```ts
const sortedNodeIds = getTopologicallySortedNodeIds(graph);
```

**Algorithm**:
- Build dependency graph from connections
- Perform depth-first traversal
- Detect cycles (error if found)
- Return nodes in execution order

#### b. Node Code Generation

For each node (in sorted order):

```ts
const nodeData = graph.getNode(nodeId);
const nodeType = collectionManager.getNodeType(nodeData.type);

// Get implementation (regex, function, or code-generator)
const impl = nodeType.implementations['python'];

// Generate code based on implementation type
let nodeCode;
if (impl.type === 'regex') {
    nodeCode = renderTemplate(impl.value, nodeData, context);
} else if (impl.type === 'function') {
    nodeCode = generateFunctionCall(impl, nodeData, context);
} else if (impl.type === 'code-generator') {
    const generator = resolveGlobalFunction(impl.value);
    const result = generator(nodeData, context);
    nodeCode = result.statement || result.expression;
}
```

Every generator context carries `graph: { id, name, scope }`. `scope` is the graph's generated Python
function name: `#transpileGraph()` allocates it **once** with `sanitizeGraphFunctionName()` right after
the empty-graph early return, stores it as the active graph scope, hands it to every generator, and
reuses the same value as `GraphBlock.name`. The emitted `async def <name>()` and any generator-owned
module-level name therefore derive from one value and cannot drift apart (see
[4. Output Assembly](#4-output-assembly) for the naming rule).

#### c. Variable Assignment

```ts
// Output variable naming
const outputVar = createOutputVariableName(nodeData, outputIndex);

// Build assignment
if (impl.type === 'code-generator' && result.statement) {
    // Generator handles assignment
    graphCode.push(nodeCode);
} else {
    // Transpiler assigns expression to output
    graphCode.push(`${outputVar} = ${nodeCode}`);
}
```

#### d. Shared Init Contributions

Nodes whose definition declares `initFunction: "<name>"` do not emit code into the graph loop for
their setup. Their init generator returns

```ts
{ init: { block: string, priority?: number, execute?: string } }
```

and the transpiler groups every contribution with the same `initFunction` into one
`async def <name>():` that runs once from `run()` before any graph starts. Assembly rules:

- Every `block` is emitted first, sorted by `priority` then by contribution order.
- Every `execute` statement is emitted after the blocks, sorted by contribution order.
- Byte-identical `block`s and byte-identical `execute` statements are emitted **once**
  (first occurrence wins).

Equal priorities fall back to contribution (graph iteration) order. A package must therefore never
rely on a tie between two blocks whose order matters — the `hass` package assigns `priority: 1` to
`_hass.configure(...)` and `priority: 5` to every `_hass.register_entity(...)` exactly so that graph
iteration order cannot put `configure()` after `register_entity()`.

The two-stage split is what makes ordering safety explicit: a domain can register everything it
needs in blocks and perform the single "go live" action as its execute statement. The MQTT package
uses exactly this shape — each `mqtt-read`/`mqtt-write` node contributes
`_mqtt.register_subscription(...)` / `_mqtt.register_publish(...)` as a block and `_mqtt.start()` as
its execute statement, so all registrations across all graphs precede the single `_mqtt.start()`
no matter how many nodes contribute it.

### Empty bodies (`pass`)

Node generators may legitimately produce comments only: the `hass` bridge is configured in
`init_mqtt()` and the MQTT will is published by the runtime, so their loop implementation is a
comment. The transpiler also prefixes every node with a `# <title> [<type>]` comment, so a graph
built from such nodes has a body made of comments alone.

Emitting that body unchanged produces an indented block without a statement, which `mpy-cross`
rejects with `SyntaxError: invalid syntax` — the whole generated `main_loop.py` then fails to load,
the app never runs, and nothing is ever registered with Home Assistant (the runtime reports
`controller-main-loop-load-failed`). Every emitter therefore checks for an executable statement
(`hasExecutableStatement()`: at least one line that is neither blank nor a `#` comment) and writes
`pass` when there is none. This applies to startup graph functions and shared `initFunction`
bodies; a continuous graph is safe anyway because its `while True:` body always ends in the cadence
block, which awaits at least once per iteration (a bare `await asyncio.sleep_ms(0)` when the interval
is `0`).

When it still happens, the controller now says so in one plain line, so a boot in which the app
did not run cannot be mistaken for a clean one (the JSON event with the collapsed traceback
follows):

```
[error] controller: main loop load failed; the app did not start - check that app/main_loop.py is valid (SyntaxError: invalid syntax)
```

If this line is absent and the app still does nothing, the module loaded fine and the problem is
inside the generated code or the node runtime.

### Graph cadence and interval

The graph interval is a **cadence**: the period between the *starts* of consecutive loop iterations,
not a delay appended to the body. A body that takes 5 ms with an interval of 100 ms waits 95 ms, so
the loop period stays 100 ms. `#getGraphIntervalMs()` delegates to `clampSleepDuration()`
(`js/data/graph-execution-settings.ts`), so the generated period always matches the value the two
settings surfaces show: floored, clamped into `0 … 60000`, and `500` (`DEFAULT_SLEEP_MS`) when the
graph exposes no usable value.

For `intervalMs > 0` the continuous emitter writes one deadline before `while True:` and advances it
by exactly one interval per iteration:

```python
async def graph_main():
    _next_run_ms = _utime.ticks_ms()
    while True:
        <body / pass>
        _next_run_ms = _utime.ticks_add(_next_run_ms, 500)
        _wait_ms = _utime.ticks_diff(_next_run_ms, _utime.ticks_ms())
        if _wait_ms > 0:
            await asyncio.sleep_ms(_wait_ms)
        else:
            _next_run_ms = _utime.ticks_ms()
            await asyncio.sleep_ms(0)
```

`utime.ticks_add()` / `utime.ticks_diff()` are wrap-safe here: the largest interval (60000 ms) is far
below half the 2^30 tick period, so the signed difference never wraps into a false negative wait.

Overrun policy: when the body consumed a full interval, `_wait_ms` is `<= 0`, the missed slots are
dropped (no catch-up burst), the deadline restarts from *now*, and the loop still awaits once with
`sleep_ms(0)` so the cooperative scheduler is never starved.

An interval of `0` (and any negative value, which clamps to `0`) is a **yield-only** cadence: the
loop emits no deadline and no `utime` arithmetic, just a bare yield as its last statement:

```python
        await asyncio.sleep_ms(0)
```

`import utime as _utime` is registered only when at least one `continuous` graph has `intervalMs > 0`.
Startup graphs never cadence, so a collection made of interval-0 or startup-only graphs keeps its
previous import header.

### Interrupt (`irq`) graphs

An `irq` graph waits on a named interrupt channel instead of a cadence. `#assemblePythonProgram`
dispatches it next to the `startup` branch, before the cadence code, and emits no `_utime`, no
`_next_run_ms` and no `asyncio.sleep_ms` cadence line:

```python
async def on_button():
    <init / pre-loop statements>

    # Wait for interrupt
    while True:
        await _otter_irq.wait('button')
        <body>
```

`import otter_irq.interrupts as _otter_irq` is registered when any graph block carries a non-null
`irqTriggerName`. The single `await <runtime>.wait(...)` line is formatted by the shared private
helper `#emitWaitStatement(indent, waitLine)`; the `irq` branch (and phase 7's `event` branch) are its
only callers, and each branch owns its own loop scaffolding (comment, prologue, trailing sleep). The
channel name is emitted through `formatLiteral()`, so quotes and backslashes are escaped.

Cross-graph interrupt binding is validated in one entry point,
`#validateTriggerBindings(graphs, deviceRuntime)`, called from `transpile()` after the per-graph
`#validateGraph` loop and before code generation. It is interrupt-only: blank `interrupt-input` /
`interrupt-enable` names, duplicate declarations, dangling enable references, an `irq` graph with no
name or a declaration in a different graph, two `irq` graphs bound to the same name, and two
`interrupt-input` nodes claiming the same effective GPIO are all hard errors. The duplicate-GPIO check
runs after the duplicate-name check and reports every claim (`Graph "<name>" node "<id>"`). The
effective GPIO comes from the private `#irqPinKey()` / `#irqPinLabel()` pair, which mirrors
`irq/node_capabilities.js#pinKey()` — `undefined`, `null`, and blank mean `0`, a finite
`Number(value)` compares by its numeric string, anything else only collides with identical text.
Signal validation is not added here — phase 7 puts the per-graph watch-list check in
`#validateGraph`, because signal names have no cross-graph hard error.

### Event (`event`) graphs

An `event` graph waits on its watched pulse signals instead of a cadence. `#assemblePythonProgram`
dispatches it next to the `irq` branch and emits no `_utime` / `_next_run_ms` cadence code:

```python
async def radar():
    <init / pre-loop statements>

    _signals.define('graph-2', ('radar-run',), 'any')
    _first_run = True
    while True:
        if not _first_run:
            await _signals.wait('graph-2')
        _first_run = False
        <body>
        await asyncio.sleep_ms(0)
```

`import otter_vars.signals as _signals` is registered when any block has `executionType === 'event'`.
The `define` tuple keeps a trailing comma for a single watched name, and the wait line reuses
`#emitWaitStatement`. With `runOnStart: false` the `_first_run` prologue is omitted and the wait is
the first loop statement. The trailing `await asyncio.sleep_ms(0)` is mandatory because `wait()` can
return without suspending. The empty-watch-list hard error lives in `#validateGraph` (per graph), not
in `#validateTriggerBindings`.

### 4. Output Assembly

```ts
const output = [];

// 1. Generated code header
output.push('# Generated by Micro Otter Transpiler');
output.push(`# Source: ${collection.name}`);
output.push(`# Date: ${new Date().toISOString()}`);
output.push('');

// 2. Imports
const sortedImports = Array.from(context.imports).sort();
output.push(...sortedImports);
output.push('');

// 3. Global functions and classes
for (const [name, code] of context.globalFunctions) {
    output.push(code);
    output.push('');
}

// 4. Graph functions
for (const graphFunc of graphFunctions) {
    output.push(graphFunc);
    output.push('');
}

// 5. Main entry point (called by runtime framework)
output.push('# Main entry point - called by runtime framework');
output.push('async def run():');
for (const graphName of graphNames) {
    output.push(`    await ${graphName}()`);
}
output.push('');

const code = output.join('\n');
```

Shared-init contributions from **every** graph are collected per `initFunction` name and emitted as
one collection-wide `async def <initFunction>()` (see
[3.d Shared Init Contributions](#d-shared-init-contributions)): byte-identical `initBlock` /
`executeBlock` texts are deduplicated, and contributions are ordered by `initPriority` then insertion
order. Node ids restart in each graph, so a generator that owns a module-level variable must include
`context.graph.scope` in the name — `_sensor_${context.graph.scope}_${context.node.id}` — and keep the
unscoped fallback for contexts without a scope. Otherwise two graphs whose node ids coincide write the
same variable and read each other's state. `irq` and `audio` are the two packages that follow this rule
today; see [addons/generators.md](addons/generators.md) and `irq/node_generators.js#varName()`.

---

## Implementation Types

### 1. Regex (Template)

Simple string substitution with `{{placeholder}}` tokens.

**Example**:
```ts
// Node definition
{
    "implementations": {
        "python": {
            "type": "regex",
            "value": "print('{{message}}')"
        }
    }
}

// Generated code
print('Hello, World!')
```

**Use when**: Simple expression replacement with no complex logic.

---

### 2. Function (Class Constructor)

Treated as a callable class instantiated before the main loop.

**Example**:
```ts
// Node definition
{
    "implementations": {
        "python": {
            "type": "function",
            "value": "NodeFunctions.scale"
        }
    }
}

// TypeScript class
window.NodeFunctions = window.NodeFunctions || {};
window.NodeFunctions.scale = class {
    constructor({ inputs_meta, outputs_meta, controls }) {
        this.factor = Number(controls.factor ?? 1);
    }
    
    __call__(value) {
        return value * this.factor;
    }
};

// Generated code
scale_instance = NodeFunctions.scale(inputs_meta, outputs_meta, controls)
result = scale_instance(input_value)
```

**Use when**: Reusable logic that needs metadata access.

---

### 3. Code Generator

Full control over code generation including self-managed assignments.

**Example**:
```ts
// Node definition
{
    "implementations": {
        "python": {
            "type": "code-generator",
            "value": "NodeCodeGenerators.constNode"
        }
    }
}

// TypeScript generator
window.NodeCodeGenerators = window.NodeCodeGenerators || {};
NodeCodeGenerators.constNode = function(node, context) {
    const value = node.controls.inputValue ?? 0;
    
    // Option 1: Self-managed assignment
    return {
        statement: `${node.outputs[0].var_name} = ${value}`
    };
    
    // Option 2: Transpiler assigns expression
    return {
        expression: `${value}`
    };
};
```

**Use when**: Complex code generation, custom imports, or advanced control flow.

---

### 4. Structural (Function Nodes)

Variable mappings without code. `outputs[index]` maps a connector onto an expression and `statement`
is emitted verbatim after the body; returning nothing is legal.

**Example**:

```ts
// Generated from the graph signature by buildStructuralNodeDefinition()
{
    "implementations": {
        "python": {
            "type": "structural",
            "outputs": ["_in0_channel"]        // input node: connectors are the parameters
        }
    }
}
{
    "implementations": {
        "python": {
            "type": "structural",
            "statement": "return {{out_0}}"    // output node: the function's return
        }
    }
}
```

**Use when**: A node only renames variables or ends the body — the two `graph.function.*` structural
nodes. Structural nodes never register device imports.

---

## Function Graphs

A `function` graph is emitted as an ordinary coroutine and is never scheduled; see
[function-graphs.md](function-graphs.md) for the model and the editor.

- **Definition seam.** `#resolveNodeDefinition(typeId)` is used by `#validateGraph`, `#transpileGraph`
  and `#transpileNode`: `graph.function.*` → structural definition from the current signature,
  `function_graph.*` → generated definition from the callee graph, everything else →
  `runtime.getNodeType()`. A runtime package can never shadow a call node.
- **Names.** A pre-pass assigns `_fn_<sanitized graph name>` (and `_init_<functionName>`) for every
  enabled function graph before any body is emitted, so call sites and definitions agree and two
  similarly named graphs cannot collide.
- **Emission.** `async def _fn_<name>(<parameters>):` with no `while True`, no cadence sleep and no
  startup/signal scaffolding; the output node's statement becomes the trailing `return`. Function
  blocks are excluded from the startup and looping lists and from `asyncio.gather`.
- **Init hoisting.** `initStatements` plus per-node `preLoopStatements` become `async def _init_<name>()`,
  awaited by `run()` before any graph task starts — and only for function graphs reachable from a
  scheduled graph.
- **Validation.** `GraphValidationError` carries a stable `messageId` (`function-graph-self-call`,
  `function-graph-cycle`, `function-graph-callee-disabled`, `function-graph-callee-unknown`,
  `function-graph-port-count-mismatch`, `function-graph-missing-output-node`,
  `function-graph-structural-in-non-function-graph`) plus graph/node details. Call validation runs
  before the per-graph definition check so these messages win over the generic "missing node
  definition" error.
- **Regression guard.** A collection without function graphs transpiles byte-identically to before.

---

## Error Handling

### Validation Errors

```ts
// Missing collection
throw new Error('No collection provided');

// Empty collection
throw new Error('Collection has no graphs to transpile');

// Every graph is disabled
throw new Error('Collection has no enabled graphs to transpile');

// Invalid graph
throw new Error(`Graph ${graphId} is missing id or name`);
```

### What a disabled graph does *not* affect

The deployment path is deliberately untouched: `collection-deployment.ts` keeps scanning
`collection.getGraphArray()` for package dependencies and capabilities and keeps copying **every**
graph into the serialised `metadata.graphs` payload. A disabled graph is therefore still installed on
the device — it is simply never executed, because no `async def` for it exists.

> **Deferred follow-up:** excluding disabled graphs from the deployment dependency/capability scan
> would shrink device images and packaged assets. That is out of scope; the flag currently only
> affects transpilation.

### Resolution Errors

```ts
// Node type not found
throw new Error(`Node type '${nodeType}' not found in runtime packages`);

// Missing implementation
throw new Error(`Node type '${nodeType}' has no Python implementation`);
```

### Generation Errors

```ts
// Circular dependency
throw new Error(`Circular dependency detected in graph '${graphName}'`);

// Invalid implementation
throw new Error(`Unknown implementation type: ${impl.type}`);
```

**Error Structure**:
```ts
{
    message: string,           // Human-readable error
    code: string,             // Error code (e.g., 'VALIDATION_ERROR')
    details: {
        graphId?: string,
        nodeId?: string,
        nodeType?: string,
        // ... contextual information
    }
}
```

---

## Progress Tracking

The Transpiler emits progress events via **ProgressEventBus** for UI feedback:

```ts
const tracker = new ProgressTracker('transpiler', totalGraphs);

tracker.start('Starting transpilation...');

for (let i = 0; i < graphs.length; i++) {
    tracker.update(`Transpiling graph ${i+1}/${graphs.length}`, i+1);
    // ... process graph
}

tracker.complete('Transpilation complete');
```

**UI Integration**:
```ts
// Subscribe to transpiler events in TranspilerView
ProgressEventBus.subscribe((event) => {
    if (event.source === 'transpiler') {
        if (event.type === ProgressEventType.UPDATE) {
            this._updateProgressBar(event.progress);
        } else if (event.type === ProgressEventType.ERROR) {
            this._showError(event.detail);
        }
    }
});
```

---

## Integration with TranspilerView

TranspilerView provides the UI wrapper for the Transpiler:

```ts
class TranspilerView extends ViewBase {
    async _handleTranspile() {
        try {
            // Get active collection via CollectionManager
            const collection = this.collectionManager.getActiveCollection();
            const runtime = this.collectionManager.getActiveDeviceRuntime();
            
            // Transpile
            const { code, assets } = await this.transpiler.transpile(collection, {
                deviceRuntime: runtime,
                collectionManager: this.collectionManager
            });
            
            // Display code
            this.codeView.setCode(code, 'python');
            
            // Update toolbar state
            this.toolbar.setButtonDisabled('copy', false);
            this.toolbar.setButtonDisabled('deploy', false);
        } catch (error) {
            this._showError(error);
        }
    }
}
```

---

## Caching and Optimization

The Transpiler tracks transpilation state to avoid redundant regeneration:

```ts
#lastGeneratedCode: string | null
#lastGeneratedAssets: object | null
#lastTranspileDate: number | null
#lastCollectionId: string | null
#lastCollectionVersion: string | null
```

**Cache Invalidation**:
- Collection ID changes (different collection)
- Collection version changes (collection modified)
- Explicit cache clear requested

**Future Enhancement**: Incremental transpilation (only re-generate changed graphs).

---

## Testing Strategy

### Unit Tests

Test individual transpiler components:

```ts
test('transpiler generates code for simple graph', async () => {
    const graph = createMockGraph();
    const collection = createMockCollection([graph]);
    const collectionManager = createMockCollectionManager();
    
    const transpiler = new Transpiler();
    const { code } = await transpiler.transpile(collection, {
        deviceRuntime: mockRuntime,
        collectionManager
    });
    
    expect(code).toContain('async def graph_main():');
    expect(code).toContain('async def run():');
});
```

### Integration Tests

Test full transpilation pipeline:

```ts
test('transpiler resolves node types via CollectionManager', async () => {
    const workspace = await createTestWorkspace();
    const collection = workspace.getActiveCollection();
    
    const transpiler = new Transpiler();
    const { code } = await transpiler.transpile(collection, {
        deviceRuntime: workspace.runtimeCollection.getActiveRuntime(),
        collectionManager: workspace.collectionManager
    });
    
    expect(code).toContain('import machine');
});
```

`tests/proc/graph-cadence-transpiler.test.js` pins the cadence contract: interval resolution through
the shared clamp (including the 500 ms fallback), the ordered `_next_run_ms` / `ticks_add` /
`ticks_diff` markers, the interval-0 yield-only path, the single conditional `utime` import, and the
startup exemption.

### Error Case Tests

```ts
test('transpiler throws on missing collection', async () => {
    const transpiler = new Transpiler();
    
    await expect(
        transpiler.transpile(null, { deviceRuntime: mockRuntime })
    ).rejects.toThrow('No collection provided');
});
```

---

## Related Documentation

- [View System Architecture](view-system-architecture.md) - TranspilerView integration
- [Data Backbone Architecture](data-backbone-architecture.md) - Collection and graph structure
- [Node Definition Reference](node-definition-reference.md) - Implementation types
- [Progress Event System](progress-event-system.md) - Progress tracking

---

## Future Enhancements

### Planned Features

1. **Incremental Transpilation**: Only re-generate changed graphs
2. **Code Optimization**: Dead code elimination, constant folding
3. **Multi-Language Support**: JavaScript, C++ targets
4. **Source Maps**: Map generated code back to node graph
5. **Async Node Support**: Handle async/await patterns
6. **Type Checking**: Validate connection types before generation

### Performance Improvements

- Cache topological sort results
- Parallel graph processing
- Lazy import resolution
- Template compilation

---

## Troubleshooting

### Common Issues

**"Node type 'X' not found"**
- Ensure node package is loaded in runtime collection
- Check CollectionManager has correct runtime configured
- Verify node type ID matches package definition

**"Circular dependency detected"**
- Graph contains a loop in connections
- Use graph visualization to identify cycle
- Disconnect one connection to break cycle

**"Missing Python implementation"**
- Node type definition missing `implementations.python`
- Check node definition JSON
- Ensure correct node package version loaded

**Generated code doesn't run**
- Check MicroPython syntax compatibility
- Verify imports are available on device
- Test node implementations individually
- Enable debug logging in Transpiler

---

## API Reference

### Transpiler Class

```typescript
class Transpiler {
    constructor({ logger?: object }): Transpiler
    
    transpile(
        collection: Collection,
        options: {
            language?: string,
            deviceRuntime: object,
            collectionManager: CollectionManager
        }
    ): Promise<{ code: string, assets: object }>
    
    // Getters (read-only)
    get lastGeneratedCode(): string | null
    get lastGeneratedAssets(): object | null
    get lastTranspileDate(): number | null
}
```

### Helper Functions (transpiler-helpers.ts)

```typescript
// Variable naming
createOutputVariableName(nodeData, outputIndex): string

// Code formatting
formatLiteral(value, type): string
createObjectLiteral(obj): string

// Graph analysis
getTopologicallySortedNodeIds(graph): string[]
buildInputConnectionLookup(graph): Map
buildOutputConnectionLookup(graph): Map

// Template rendering
renderTemplate(template, nodeData, context): string

// Import management
registerImportStatement(context, importStatement): void
registerPythonFunctionImport(context, modulePath, functionName): void
```

---

## Integration with Deployment

The Transpiler is used by DeviceDeployment during collection deployment (Phase 3):

```ts
// In DeviceDeployment (Phase 3)
const result = await this._transpiler.transpile(collection, {
    deviceRuntime: this._getDeviceRuntime(),
    collectionManager: this._collectionManager
});

if (result.success) {
    // Upload generated code
    await this._deviceConnection.sendFile('/main.py', result.code);
    
    // Upload required libraries (filtered by usage)
    await this._uploadNodeLibraries(runtime, collection);
}
```

**See:** [Deployment System Architecture](deployment-system-architecture.md) for complete deployment workflow.
