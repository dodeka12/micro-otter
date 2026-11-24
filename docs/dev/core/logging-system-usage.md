# Logging System Usage Guide

The Micro-Otter logging system uses a simple singleton pattern for efficient, configurable logging across the codebase.

## Log Output Essentials

To see any log output, all of these must be true:

1. **Initialize first**: Import `log.ts` before modules/classes that call `_log()`.
2. **Enable master switch**: Call `logger.setEnabled(true)`.
3. **Register class**: Call `logger.register('ClassName')` for the emitting class.
4. **Match reason filter**: If class registration uses specific reasons, the emitted reason must be registered.
5. **Meet level threshold**: The emitted log level must pass global and class minimum levels.

If one is missing, log calls are silently dropped by design.

For this web app, the master switch is set in [src/micro_otter/nodes/html/js/app/main.ts](src/micro_otter/nodes/html/js/app/main.ts) in the startup logging block:

```ts
if (globalThis.__microOtterLog) {
    const { logger } = globalThis.__microOtterLog;
    logger.setEnabled(/* master switch */);
    logger.register('GraphPanelView', ['node-title-i18n-snapshot'], 'warn');
}
```

If logs are missing in this app, check this `logger.setEnabled(...)` line first.

## Quick Start

```ts
import { logger, createLogger } from '../core/log.ts';

// Enable logging globally (disabled by default)
logger.setEnabled(true);

// Register classes you want to log
logger.register('SplitView');
logger.register('TabbedView', ['attach', 'detach']); // Only specific reasons
logger.register('GraphPanelView', null, 'warn'); // Minimum warn level

// In your class constructor
class SplitView extends ViewBase {
    constructor(options) {
        super(options);
        this._log = createLogger('SplitView', () => this.id);
    }

    someMethod() {
        this._log('method-called', 'debug', { data: 'example' });
    }
}
```

## Initialization Requirements

**CRITICAL**: The logging system must be initialized before any classes that use `_log()` are imported.

### In Application Entry Points

For main application entry points (e.g., `main.ts`, test files, standalone HTML pages):

```ts
// 1. Import log.ts FIRST - this sets up globalThis.__microOtterLog
import '/html/js/core/log.ts';

// 2. Then import classes that use logging
import { DeviceDeployment } from '/html/js/deployment/device-deployment.js';
import { Workspace } from '/html/js/core/workspace.ts';
// ... other imports
```

**Why this matters:**

- `log.ts` exports setup code that runs immediately: `globalThis.__microOtterLog = { ... }`
- Classes call `globalThis.__microOtterLog.log()` in their `_log()` methods
- If log.ts isn't imported first, `globalThis.__microOtterLog` is `undefined` and logging silently fails

### Activation (Required for ALL Applications)

**IMPORTANT:** Simply importing `log.ts` is not enough - logging is **disabled by default** for performance. Every application (main app, test files, standalone demos) must explicitly activate logging:

#### Step-by-Step Activation

After importing `log.ts`, add activation code in your application's entry point:

```ts
// After imports, in your entry point or initialization function
if (globalThis.__microOtterLog) {
    const { logger } = globalThis.__microOtterLog;

    // 1. Enable the master switch
    logger.setEnabled(true);

    // 2. Register specific classes you want to log
    logger.register('DeviceDeployment');
    logger.register('RuntimeDeployment');
    logger.register('CollectionDeployment');
    logger.register('Workspace');
    // ... register other classes as needed

    logger.warn('Logging enabled');
}
```

#### Example: Main Application (main.ts)

```ts
// Import logging FIRST
import '../core/log.ts';

// Enable and register classes
if (globalThis.__microOtterLog) {
    const { logger } = globalThis.__microOtterLog;
    logger.setEnabled(true);
    logger.register('TranspilerView');
    logger.register('DeviceDeployment');
    logger.register('Workspace');
}

// Then import application modules
import { Workspace } from '../core/workspace.ts';
// ... rest of application code
```

#### Example: HTML Test File

```html
<script type="module">
    // Import logging system FIRST
    import '/html/js/core/log.ts';

    // Then import application modules
    import { DeviceDeployment } from '/html/js/deployment/device-deployment.js';
    // ... rest of imports

    // Activate logging in initialization code
    async function initApp() {
        // Enable logging system
        if (globalThis.__microOtterLog) {
            const { logger } = globalThis.__microOtterLog;
            logger.setEnabled(true);

            // Register classes you want to debug
            logger.register('DeviceDeployment');
            logger.register('RuntimeDeployment');
            logger.register('CollectionDeployment');

            logger.warn('[Test] Logging enabled');
        }

        // ... rest of initialization
    }

    initApp();
</script>
```

**Key Points:**

- **Two required steps**: 1) Enable with `logger.setEnabled(true)`, 2) Register classes with `logger.register('ClassName')`
- **Per-application**: Each application/test must activate logging independently
- **Selective registration**: Only register classes you're actively debugging to reduce noise
- **No logs without both steps**: Even if classes call `_log()`, nothing appears without activation

### Debugging Missing Logs

If logs aren't appearing:

1. **Check if log.ts is imported**: Look for `import '/html/js/core/log.ts'` at the top of your entry point
2. **Verify global object exists**: In browser console, evaluate `globalThis.__microOtterLog`
3. **Enable logging**: `globalThis.__microOtterLog.logger.setEnabled(true)`
4. **Register classes**: `globalThis.__microOtterLog.logger.register('ClassName')`

### Convenience Functions

**log(className, reason, level, ...data)**  
Convenience wrapper around logger.log().

**logEnabled(className, reason, level?)**  
Convenience wrapper around logger.isEnabled().

**createLogger(className, instanceId?)**  
Create a bound logging function for a class.

- `className` (string): Class name
- `instanceId` (string | function): Optional instance ID or function that returns it

Returns: `function(reason, level, ...data)`

### Log Levels

Priority (lowest to highest):

- `'debug'` - Detailed information
- `'info'` - General information
- `'warn'` - Warning messages
- `'error'` - Error messages

## Fast Paths

The logging system includes optimizations for zero overhead when disabled:

1. **Master switch off**: Immediate return if `logger.enabled === false`
2. **Empty registrations**: Immediate return if `logger.classes.size === 0`
3. **O(1) lookups**: Set/Map data structures for fast checks

## Runtime Debugging

The logging API is exposed on `globalThis.__microOtterLog`:

```ts
// In browser console
__microOtterLog.logger.setEnabled(true);
__microOtterLog.logger.register('SplitView');
__microOtterLog.log('SplitView', 'test', 'info', { msg: 'hello' });
```

## Example Configurations

### Enable all lifecycle events for views

```ts
logger.setEnabled(true);
logger.register('SplitView', ['attach', 'detach', 'render']);
logger.register('TabbedView', ['attach', 'detach', 'render']);
logger.register('GraphPanelView', ['attach', 'detach', 'render']);
```

### Enable warnings and errors only

```ts
logger.setEnabled(true);
logger.register('SplitView', null, 'warn');
logger.register('TabbedView', null, 'warn');
logger.register('GraphPanelView', null, 'warn');
```

### Enable everything for debugging

```ts
logger.setEnabled(true);
logger.register('SplitView');
logger.register('TabbedView');
logger.register('GraphPanelView');
logger.register('NodeGraph');
logger.register('Collection');
logger.register('Workspace');
```

### Disable all logging

```ts
logger.setEnabled(false);
// or
logger.clear();
```

## Integration with ViewBase

ViewBase includes a `_log()` method that integrates with the logging system:

```ts
// In ViewBase._log() method
_log(reason, level = 'debug', ...data) {
    if (typeof globalThis !== 'undefined' && globalThis.__microOtterLog) {
        const className = this.constructor.name;
        globalThis.__microOtterLog.log(className, reason, level, ...data);
    } else if (this._logger) {
        // Fallback to old logger if available
        this._logger.log('debug', `[${this.constructor.name}] ${reason}`, ...data);
    }
}
```

Usage in views:

```ts
class MyView extends ViewBase {
    afterAttach() {
        this._log('after-attach', 'info', { container: this._container });
    }

    onResized(size) {
        this._log('resized', 'debug', size);
    }
}
```

ViewBase also provides `_logEnabled()` to check if logging is active:

```ts
class MyView extends ViewBase {
    updateState() {
        // Guard expensive operations
        if (this._logEnabled('state-dump', 'debug')) {
            const fullState = this.captureCompleteState(); // Only computed if logging enabled
            this._log('state-dump', 'debug', fullState);
        }
    }
}
```

## Lazy Evaluation and Performance

**IMPORTANT:** Use lazy evaluation to avoid creating log data when logging is disabled.

### When to Use Lazy Evaluation

The logging system supports lazy evaluation by wrapping data in functions. Use this for expensive operations:

**Use lazy evaluation for:**
- Object literals with computed properties
- Array transformations (map, filter, reduce)
- Method calls that perform calculations
- Nested object serialization
- String concatenation/formatting with many inputs

**Direct values are fine for:**
- Simple variables (strings, numbers, booleans)
- Already-existing object references
- Single property accesses (no computation)

### Lazy Evaluation Examples

#### Simple Values (No Lazy Evaluation Needed)

```ts
// ✅ Direct values - zero overhead
this._log('button-clicked', 'info', buttonId);
this._log('error-occurred', 'error', errorMessage);
this._log('state-changed', 'debug', this._currentState);
```

#### Object Literals with Properties

```ts
// ❌ BAD: Object always created, even when logging disabled
this._log('graph-updated', 'debug', { 
    nodeCount: this._nodes.size,
    edgeCount: this._edges.size 
});

// ✅ GOOD: Lazy - properties only read when logging enabled
this._log('graph-updated', 'debug', () => ({ 
    nodeCount: this._nodes.size,
    edgeCount: this._edges.size 
}));
```

#### Array Transformations

```ts
// ❌ BAD: Map always executes
this._log('items-processed', 'debug', items.map(i => i.serialize()));

// ✅ GOOD: Lazy - map only runs when logging enabled
this._log('items-processed', 'debug', () => items.map(i => i.serialize()));
```

#### Expensive Computations with Guard

```ts
// ❌ BAD: Computation always runs
this._log('bounds-calculated', 'debug', this.computeBounds());

// ✅ GOOD Option 1: Guard with _logEnabled()
if (this._logEnabled('bounds-calculated', 'debug')) {
    this._log('bounds-calculated', 'debug', this.computeBounds());
}

// ✅ GOOD Option 2: Lazy function
this._log('bounds-calculated', 'debug', () => this.computeBounds());
```

### Hybrid Approach (Recommended)

Combine both patterns for optimal performance:

```ts
// Simple value + lazy complex object
this._log('operation-complete', 'info', 'user_action', () => ({
    duration: Date.now() - startTime,
    results: items.filter(i => i.success).map(i => i.id)
}));

// Multiple lazy functions
this._log('analysis', 'debug', 
    () => ({ nodes: this.getNodeStats() }),
    () => ({ connections: this.getConnectionStats() })
);
```

### Guard Pattern for Very Expensive Operations

For operations that are expensive even to set up:

```ts
if (this._logEnabled('full-state-dump', 'debug')) {
    // Entire block skipped if logging disabled
    const snapshot = this.captureFullState();
    const analysis = this.analyzeState(snapshot);
    this._log('full-state-dump', 'debug', { snapshot, analysis });
}
```

## Standard Logging Pattern for All Classes

**All classes should use the same standardized `_log()` method pattern:**

```ts
/**
 * Log a message with consistent formatting.
 * Uses the global logging system (globalThis.__microOtterLog).
 * @private
 * @param {string} reason - Reason/event identifier (e.g., 'method-called', 'state-changed')
 * @param {string} [level='debug'] - Log level: 'debug' | 'info' | 'warn' | 'error'
 * @param {...any} data - Optional data to log
 */
_log(reason, level = 'debug', ...data) {
    if (typeof globalThis !== 'undefined' && globalThis.__microOtterLog) {
        globalThis.__microOtterLog.log('YourClassName', reason, level, ...data);
    }
}
```

**Key principles:**

1. **No logger parameter in constructor** - Classes don't need a logger parameter anymore
2. **Single logging interface** - Only use `globalThis.__microOtterLog.log()`
3. **No interface testing** - No need to check if logger is a function or has methods
4. **Consistent signature** - `_log(reason, level = 'debug', ...data)` everywhere
5. **No fallback complexity** - If logging system is available, use it; otherwise silent

**Example usage:**

```ts
class MyDataModel {
    constructor(options) {
        // No logger parameter needed!
        this.data = options.data;
    }

    /**
     * Standard _log() method - copy this pattern to all classes
     */
    _log(reason, level = 'debug', ...data) {
        if (typeof globalThis !== 'undefined' && globalThis.__microOtterLog) {
            globalThis.__microOtterLog.log('MyDataModel', reason, level, ...data);
        }
    }

    updateData(newData) {
        this._log('update-data', 'debug', { oldCount: this.data.length, newCount: newData.length });
        this.data = newData;
        this._log('data-updated', 'info', { count: this.data.length });
    }

    handleError(error) {
        this._log('error-occurred', 'error', { message: error.message, stack: error.stack });
    }
}
```

**Do NOT use these patterns (deprecated):**

```ts
// ❌ DON'T: Accept logger in constructor
constructor({ logger }) {
    this._logger = logger;
}

// ❌ DON'T: Test logger interface types
if (typeof this._logger === 'function') { ... }
if (this._logger && typeof this._logger.debug === 'function') { ... }

// ❌ DON'T: Call logger methods directly
this._logger.error('message');
this._logger?.debug('message');

// ❌ DON'T: Use complex fallback chains
if (logger) { ... } else if (console) { ... } else { ... }
```

**Migration checklist for existing classes:**

1. Remove `logger` parameter from constructor
2. Remove `this._logger = logger;` assignment
3. Replace existing `_log()` method with standard pattern above
4. Update all `_log()` call sites to use new signature: `_log(reason, level, ...data)`
5. Remove any direct `this._logger.error()` calls
6. Update JSDoc to match new signature

## Performance

- **Fast paths**: Disabled logging has near-zero overhead
- **O(1) lookups**: Set/Map data structures for class/reason checks
- **No string formatting**: Only logs when enabled
- **Minimal memory**: Only stores registered classes, not all logs

## Migration from debug.js

The old `debug.js` system has been disabled in Phase 1:

```ts
// OLD (debug.js)
if (DEBUG_FLAGS.workspace) {
    logger.warn('[workspace]', 'message', data);
}

// NEW (log.ts source, .js import specifier)
import { logger } from './log.js';
logger.setEnabled(true);
logger.register('Workspace');
this._log('message', 'debug', data);
```

## See Also

- [ldev/todos/v2/node-ui-plan/09-viewbase-logging-system.md](../../ldev/todos/v2/node-ui-plan/09-viewbase-logging-system.md) - Full implementation plan
- [src/micro_otter/nodes/html/js/core/log.ts](../../src/micro_otter/nodes/html/js/core/log.ts) - Implementation
- [tests/core/log.test.js](../../tests/core/log.test.js) - Unit tests
- [../device-communication/log-prefix-conventions.md](../device-communication/log-prefix-conventions.md) - The **device** log prefix taxonomy (`[info]`, `[error]`, `[data]`, ...). This page is about the browser-side `logger`; device lines are tagged by the runtime before they ever reach the browser, and that taxonomy is what the device console filters on.
