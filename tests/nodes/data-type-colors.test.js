import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
    getDataTypeColor,
    getInputConnectorType,
    setDataTypeColorRegistryResolver,
} from '../../src/micro_otter/nodes/html/js/nodes/data-type-colors.js';

afterEach(() => {
    setDataTypeColorRegistryResolver(null);
});

describe('data-type-colors helpers', () => {
    it('maps known primitive types to distinct colors', () => {
        assert.equal(getDataTypeColor('int'), '#e7c66b');
        assert.equal(getDataTypeColor('float'), '#d8bf52');
        assert.equal(getDataTypeColor('double'), '#c4a63f');
        assert.equal(getDataTypeColor('bool'), '#7ba3d6');
        assert.equal(getDataTypeColor('string'), '#6fbf73');
        assert.equal(getDataTypeColor('any'), '#e3e3e3');
    });

    it('rejects non-canonical type aliases', () => {
        assert.throws(() => getDataTypeColor('integer'), /invalid/i);
        assert.throws(() => getDataTypeColor('boolean'), /invalid/i);
        assert.throws(() => getDataTypeColor('number'), /invalid/i);
        assert.throws(() => getDataTypeColor('object:web.element'), /invalid/i);
    });

    it('uses first allowed input type for connector color selection', () => {
        assert.equal(getInputConnectorType(['double', 'string']), 'double');
        assert.equal(getInputConnectorType(['string', 'bool']), 'string');
        assert.equal(getInputConnectorType(['int', 'float']), 'int');
        assert.equal(getInputConnectorType(['float', 'int']), 'float');
    });

    it('uses first allowed type even when any appears later in the list', () => {
        assert.equal(getInputConnectorType(['int', 'any']), 'int');
    });

    it('resolves custom type color from registry when available', () => {
        setDataTypeColorRegistryResolver(() => ({
            get: (typeId) =>
                typeId === 'web.element'
                    ? {
                          color: '#ff00ff',
                      }
                    : null,
        }));

        assert.equal(getDataTypeColor('web.element'), '#ff00ff');
    });

    it('keeps custom connector type as primary when any appears later', () => {
        setDataTypeColorRegistryResolver(() => ({
            get: (typeId) =>
                typeId === 'web.element'
                    ? {
                          color: '#ff00ff',
                      }
                    : null,
        }));

        assert.equal(getInputConnectorType(['web.element', 'any']), 'web.element');
        assert.equal(getDataTypeColor(getInputConnectorType(['web.element', 'any'])), '#ff00ff');
    });

    it('keeps built-in type colors when registry does not override them', () => {
        setDataTypeColorRegistryResolver(() => ({
            get: () => null,
        }));

        assert.equal(getDataTypeColor('bool'), '#7ba3d6');
    });
});
