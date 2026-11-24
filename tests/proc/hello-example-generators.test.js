import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const helloGeneratorsPath = path.resolve(
    'examples/addons/node_pkgs/hello/node_generators.js'
);

describe('hello example node generator', () => {
    let originalSelf;
    let originalWindow;
    let originalNodeCodeGenerators;

    before(async () => {
        originalSelf = globalThis.self;
        originalWindow = globalThis.window;
        originalNodeCodeGenerators = globalThis.NodeCodeGenerators;

        globalThis.self = globalThis;
        delete globalThis.window;
        globalThis.NodeCodeGenerators = {};

        await import(`${pathToFileURL(helloGeneratorsPath).href}?test=hello-generators`);
    });

    after(() => {
        if (originalSelf === undefined) delete globalThis.self;
        else globalThis.self = originalSelf;
        if (originalWindow === undefined) delete globalThis.window;
        else globalThis.window = originalWindow;
        if (originalNodeCodeGenerators === undefined) delete globalThis.NodeCodeGenerators;
        else globalThis.NodeCodeGenerators = originalNodeCodeGenerators;
    });

    function createContext() {
        const imports = new Set();
        return {
            node: { id: '1', controlValues: {} },
            inputs: [],
            outputs: ['out0'],
            helpers: {
                registerImport(statement) {
                    imports.add(statement);
                },
            },
            _imports: imports,
        };
    }

    it('emits the greeting call and registers the module import', () => {
        const context = createContext();
        const result = globalThis.NodeCodeGenerators.moaHelloGreet(context);
        assert.equal(result.expression, 'moa_hello.greeting()');
        assert.ok(context._imports.has('import moa_hello'));
    });
});
