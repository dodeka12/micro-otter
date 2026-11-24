# Generators

A generator turns a node instance into MicroPython source. The manifest's `generators` list names the
`.js` files to load (`"generators": ["node_generators.js"]`); each file registers functions on the
global `NodeCodeGenerators` (loop body) and `NodeInitGenerators` (init) namespaces.

## Registration

```js
(function () {
    const globalScope = typeof window !== 'undefined' ? window : self;
    if (!globalScope.NodeCodeGenerators) globalScope.NodeCodeGenerators = {};
    if (!globalScope.NodeInitGenerators) globalScope.NodeInitGenerators = {};

    globalScope.NodeInitGenerators.greet = function (context) {
        const helpers = context?.helpers || {};
        if (helpers.registerImport) helpers.registerImport(context, 'import moa_hello');
    };

    globalScope.NodeCodeGenerators.greet = function (context) {
        return 'moa_hello.greeting()';
    };
})();
```

## Wiring to a node definition

The node definition references the generator by name:

```json
{
    "implementations": {
        "python": { "type": "code-generator", "value": "NodeCodeGenerators.greet" }
    },
    "initImplementations": {
        "python": { "type": "code-generator", "value": "NodeInitGenerators.greet" }
    }
}
```

- **Init generators** register imports (and one-time setup) via `context.helpers.registerImport`.
- **Code generators** return the loop-body expression or statement for the node.

## Conventions

- The generator function receives a single `context` (`context.node`, `context.controlValues`,
  `context.helpers`, …). Read control values through `context.node.controlValues` rather than
  reaching into the node object.
- `context.graph` is `{ id, name, scope }`; `scope` is the graph's generated Python function name
  (the emitted `async def <name>()`). The transpiler always sets it when it runs a generator — it is
  `null` only for a hand-built context, such as a generator unit test.
- A shared-init generator (`initImplementations` with an `initFunction`) merges into one
  collection-wide function with the contributions of **every** graph, while node ids restart in each
  graph. A module-level name built from `context.node.id` must therefore include the scope and must
  degrade to the unscoped name when the scope is missing:

  ```js
  const scope = context?.graph?.scope;
  const name = scope ? `_sensor_${scope}_${context.node.id}` : `_sensor_${context.node.id}`;
  ```

  Keeping the fallback is what lets generator unit tests construct a context without a graph.
  `irq/node_generators.js` and `audio/node_generators.js` are the reference implementations.
- Use the helpers (`registerImport`, `formatLiteral`, …) instead of emitting raw literals, so the
  generator matches built-in output formatting.
- Generators are plain JavaScript loaded into the browser editor; keep them side-effect free apart
  from registration. The device module they reference lives under the add-on's `moa_` namespace
  ([module-namespace.md](module-namespace.md)).
- `node_generators.js` is not shipped to the device — only the generated MicroPython is.
