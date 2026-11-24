import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    resolveActiveInputIds,
    resolveDeclaredInputSources,
    resolveTypeCompatibility,
    resolveUnionOutputType,
} from '../../src/micro_otter/nodes/html/js/data/type-conversions.js';

function resolveKind(typeId) {
    if (typeId === 'web.element') {
        return 'structure';
    }

    return 'value';
}

describe('Type conversions wildcard compatibility by data kind', () => {
    it('keeps explicit structure type matches compatible', () => {
        const compatibility = resolveTypeCompatibility('web.element', ['web.element'], {
            resolveTypeKind: resolveKind,
        });

        assert.equal(compatibility.compatible, true);
        assert.equal(compatibility.requiresImplicitConversion, false);
    });

    it('rejects wildcard any input for structure output types', () => {
        const compatibility = resolveTypeCompatibility('web.element', ['any'], {
            resolveTypeKind: resolveKind,
        });

        assert.equal(compatibility.compatible, false);
    });

    it('rejects wildcard any output for structure-only input types', () => {
        const compatibility = resolveTypeCompatibility('any', ['web.element'], {
            resolveTypeKind: resolveKind,
        });

        assert.equal(compatibility.compatible, false);
    });

    it('accepts wildcard any input for value output types', () => {
        const compatibility = resolveTypeCompatibility('float', ['any'], {
            resolveTypeKind: resolveKind,
        });

        assert.equal(compatibility.compatible, true);
        assert.equal(compatibility.targetType, 'any');
    });

    it('accepts wildcard any output for value input types', () => {
        const compatibility = resolveTypeCompatibility('any', ['float'], {
            resolveTypeKind: resolveKind,
        });

        assert.equal(compatibility.compatible, true);
        assert.equal(compatibility.targetType, 'float');
    });
});

describe('resolveUnionOutputType', () => {
    it('reports any for missing or empty candidates', () => {
        assert.equal(resolveUnionOutputType(undefined), 'any');
        assert.equal(resolveUnionOutputType([]), 'any');
        assert.equal(resolveUnionOutputType(['unknown']), 'any');
    });

    it('returns a single candidate unchanged', () => {
        assert.equal(resolveUnionOutputType(['string']), 'string');
        assert.equal(resolveUnionOutputType(['bool', 'bool']), 'bool');
    });

    it('keeps the first candidate when non-numeric types are mixed', () => {
        assert.equal(resolveUnionOutputType(['int', 'string']), 'int');
    });

    it('widens within the numeric types, independent of order', () => {
        assert.equal(resolveUnionOutputType(['bool', 'int']), 'int');
        assert.equal(resolveUnionOutputType(['float', 'int']), 'float');
        assert.equal(resolveUnionOutputType(['int', 'float', 'double']), 'double');
    });

    it('prefers any over every other candidate', () => {
        assert.equal(resolveUnionOutputType(['string', 'any']), 'any');
    });

    it('collapses a namespaced candidate in a mixed union to any', () => {
        assert.equal(resolveUnionOutputType(['core.tuple']), 'core.tuple');
        assert.equal(resolveUnionOutputType(['core.tuple', 'core.tuple']), 'core.tuple');
        assert.equal(resolveUnionOutputType(['core.tuple', 'float']), 'any');
        assert.equal(resolveUnionOutputType(['core.tuple', 'string']), 'any');
        assert.equal(resolveUnionOutputType(['web.element', 'audio.block']), 'any');
        assert.equal(resolveUnionOutputType(['bool', 'int']), 'int');
    });

    it('ignores whitespace, empty and non-string entries', () => {
        assert.equal(resolveUnionOutputType(['  ', 42, null, ' bool ', 'int']), 'int');
        assert.equal(resolveUnionOutputType('bool'), 'any');
    });
});

describe('resolveDeclaredInputSources', () => {
    it('accepts the camelCase spelling and trims the ids', () => {
        assert.deepEqual(resolveDeclaredInputSources({ typeInputSources: [' a ', 'b'] }), [
            'a',
            'b',
        ]);
    });

    it('ignores retired singular and snake_case spellings', () => {
        assert.deepEqual(resolveDeclaredInputSources({ type_input_sources: ['x'] }), []);
        assert.deepEqual(resolveDeclaredInputSources({ typeInputSource: 'value' }), []);
        assert.deepEqual(resolveDeclaredInputSources({ type_input_source: 'value' }), []);
    });

    it('drops empties and non-strings', () => {
        assert.deepEqual(resolveDeclaredInputSources({ typeInputSources: ['', '  ', 1, 'y'] }), [
            'y',
        ]);
    });

    it('returns an empty list for non-object inputs', () => {
        assert.deepEqual(resolveDeclaredInputSources(null), []);
        assert.deepEqual(resolveDeclaredInputSources({}), []);
        assert.deepEqual(resolveDeclaredInputSources('x'), []);
    });
});

describe('resolveActiveInputIds', () => {
    /**
     * Build one `affectsInputs` dropdown control.
     * @param options - Dropdown options.
     * @param extra - Additional control fields.
     * @returns Dropdown control object.
     */
    function dropdown(options, extra = {}) {
        return { id: 'count', type: 'dropdown', affectsInputs: true, options, ...extra };
    }

    it('returns null when no control affects the connector list', () => {
        assert.equal(resolveActiveInputIds({ inputs: [], controls: [] }), null);
        assert.equal(
            resolveActiveInputIds({
                controls: [{ id: 'count', type: 'dropdown', options: [{ value: 2 }] }],
            }),
            null
        );
        assert.equal(
            resolveActiveInputIds({
                controls: [dropdown([{ value: 2, activeInputs: ['a'] }], { affectsInputs: false })],
                controlValues: { count: 2 },
            }),
            null
        );
    });

    it('ignores an option that declares no active inputs', () => {
        assert.equal(
            resolveActiveInputIds({
                controls: [dropdown([{ value: 2 }, { value: 3, activeInputs: ['a'] }])],
                controlValues: { count: 2 },
            }),
            null
        );
    });

    it('matches the selected option without coercing its value', () => {
        const numeric = {
            controls: [dropdown([{ value: 2, activeInputs: ['two'] }, { value: 3 }])],
            controlValues: { count: '2' },
        };
        assert.equal(resolveActiveInputIds(numeric), null);

        const string = {
            controls: [dropdown([{ value: 'x', activeInputs: ['letter'] }, { value: 'y' }])],
            controlValues: { count: 'x' },
        };
        assert.deepEqual(Array.from(resolveActiveInputIds(string)), ['letter']);
    });

    it('falls back to the control default when controlValues is missing', () => {
        const nodeData = {
            controls: [
                dropdown([{ value: 2, activeInputs: ['a', 'b'] }, { value: 3 }], {
                    default: 2,
                }),
            ],
        };

        assert.deepEqual(Array.from(resolveActiveInputIds(nodeData)), ['a', 'b']);
        assert.deepEqual(Array.from(resolveActiveInputIds({ ...nodeData, controlValues: {} })), [
            'a',
            'b',
        ]);
    });

    it('unions the active ids of several affecting dropdowns', () => {
        const nodeData = {
            controls: [
                dropdown([{ value: 2, activeInputs: ['a'] }]),
                {
                    id: 'mode',
                    type: 'dropdown',
                    affectsInputs: true,
                    options: [{ value: 'x', activeInputs: ['b'] }],
                },
            ],
            controlValues: { count: 2, mode: 'x' },
        };

        assert.deepEqual(Array.from(resolveActiveInputIds(nodeData)).sort(), ['a', 'b']);
    });

    it('ignores non-string and blank active input ids', () => {
        const nodeData = {
            controls: [dropdown([{ value: 2, activeInputs: [' a ', '', '  ', 7, null, 'b'] }])],
            controlValues: { count: 2 },
        };

        assert.deepEqual(Array.from(resolveActiveInputIds(nodeData)), ['a', 'b']);
    });

    it('is idempotent across repeated calls', () => {
        const nodeData = {
            controls: [dropdown([{ value: 2, activeInputs: ['a', 'b'] }])],
            controlValues: { count: 2 },
        };

        const first = resolveActiveInputIds(nodeData);
        const second = resolveActiveInputIds(nodeData);
        assert.deepEqual(Array.from(first), Array.from(second));
        assert.deepEqual(Array.from(second), ['a', 'b']);
    });

    it('returns null for non-object node data', () => {
        assert.equal(resolveActiveInputIds(null), null);
        assert.equal(resolveActiveInputIds({}), null);
        assert.equal(resolveActiveInputIds('x'), null);
    });
});
