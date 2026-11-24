import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    collectSignalNames,
    isSignalPostType,
    signalNameOf,
    SIGNAL_NAME_SOURCE,
} from '../../src/micro_otter/nodes/html/js/nodes/signal-names.js';

function graph(nodes) {
    return { getNodes: () => nodes };
}

function collection(graphs) {
    return { getGraphArray: () => graphs };
}

describe('signal name collection', () => {
    it('exposes the signalNames dynamic source', () => {
        assert.equal(SIGNAL_NAME_SOURCE, 'signalNames');
    });

    it('recognises bare and package-prefixed signal-post types', () => {
        assert.equal(isSignalPostType('signal-post'), true);
        assert.equal(isSignalPostType('vars.signal-post'), true);
        assert.equal(isSignalPostType('var-write'), false);
    });

    it('collects names across two graphs and deduplicates', () => {
        const g1 = graph([{ type: 'signal-post', controlValues: { signal: 'radar' } }]);
        const g2 = graph([{ type: 'signal-post', controlValues: { signal: 'radar' } }, { type: 'signal-post', controlValues: { signal: 'motion' } }]);
        assert.deepEqual(collectSignalNames(collection([g1, g2])), ['motion', 'radar']);
    });

    it('ignores blank names', () => {
        const g = graph([{ type: 'signal-post', controlValues: { signal: '' } }, { type: 'signal-post', controlValues: { signal: 'ok' } }]);
        assert.deepEqual(collectSignalNames(collection([g])), ['ok']);
    });

    it('resolves the sentinel through customSignal', () => {
        const g = graph([{ type: 'signal-post', controlValues: { signal: '__new__', customSignal: 'fresh' } }]);
        assert.deepEqual(collectSignalNames(collection([g])), ['fresh']);
    });

    it('falls back to the graph when the collection is null', () => {
        const g = graph([{ type: 'signal-post', controlValues: { signal: 'solo' } }]);
        assert.deepEqual(collectSignalNames(null, g), ['solo']);
    });

    it('sorts the output', () => {
        const g = graph([
            { type: 'signal-post', controlValues: { signal: 'zeta' } },
            { type: 'signal-post', controlValues: { signal: 'alpha' } },
        ]);
        assert.deepEqual(collectSignalNames(collection([g])), ['alpha', 'zeta']);
    });

    it('returns an empty name for a non-signal-post node', () => {
        assert.equal(signalNameOf({ type: 'var-write', controlValues: { signal: 'x' } }), '');
    });
});
