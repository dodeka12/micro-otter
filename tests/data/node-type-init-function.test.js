import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { NodeType } from '../../src/micro_otter/nodes/html/js/data/node-type.js';

describe('NodeType init function metadata', () => {
    it('preserves top-level initFunction from definition', () => {
        const nodeType = new NodeType({
            type: 'webview.web-root',
            title: { en: 'Web Root' },
            implementations: {
                python: { type: 'code-generator', value: 'NodeCodeGenerators.webviewRoot' },
            },
            initImplementations: {
                python: { type: 'code-generator', value: 'NodeInitGenerators.webviewRoot' },
            },
            initFunction: 'init_webview',
        });

        assert.equal(nodeType.initFunction, 'init_webview');
        assert.equal(nodeType.toDefinition().initFunction, 'init_webview');
    });

    it('preserves implementation-level initFunction metadata', () => {
        const nodeType = new NodeType({
            type: 'custom.shared-init',
            title: { en: 'Shared Init' },
            implementations: {
                python: {
                    type: 'regex',
                    value: 'value',
                    imports: ['from libs.shared import value'],
                },
            },
            initImplementations: {
                python: {
                    type: 'regex',
                    value: 'SHARED_STATE = 0',
                    initFunction: 'init_shared_state',
                },
            },
        });

        const serialized = nodeType.toDefinition();
        assert.equal(serialized.initImplementations?.python?.initFunction, 'init_shared_state');
        assert.deepEqual(serialized.implementations?.python?.imports, ['from libs.shared import value']);
    });

    it('preserves helperImplementations including helperGroup', () => {
        const nodeType = new NodeType({
            type: 'webview.web-root',
            title: { en: 'Web Root' },
            helperImplementations: {
                python: {
                    type: 'helper-generator',
                    value: 'NodeHelperGenerators.webviewRoot',
                    helperGroup: 'web-runtime',
                },
            },
        });

        const serialized = nodeType.toDefinition();
        assert.equal(nodeType.helperImplementations?.python?.type, 'helper-generator');
        assert.equal(nodeType.helperImplementations?.python?.helperGroup, 'web-runtime');
        assert.equal(serialized.helperImplementations?.python?.type, 'helper-generator');
        assert.equal(serialized.helperImplementations?.python?.helperGroup, 'web-runtime');
    });
});
