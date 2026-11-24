import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    declaredSignalEntries,
    danglingSignalReferences,
    signalReferencePatchesForChange,
    SignalReferenceReconciler,
} from '../../src/micro_otter/nodes/html/js/nodes/signal-consistency.js';

function signalNode(id, name) {
    return { id, type: 'signal-post', controlValues: { signal: name } };
}

describe('signal consistency', () => {
    it('renames the watched name in every referencing graph', () => {
        const change = {
            previous: signalNode('n1', 'old'),
            current: signalNode('n1', 'new'),
        };
        const patches = signalReferencePatchesForChange(
            change,
            declaredSignalEntries([change.current]),
            [{ graphId: 'g1', signalNames: ['old', 'other'] }]
        );
        assert.deepEqual(patches, [{ graphId: 'g1', signalNames: ['new', 'other'] }]);
    });

    it('drops the name from every referencing graph on removal', () => {
        const change = {
            previous: signalNode('n1', 'old'),
            current: null,
        };
        const patches = signalReferencePatchesForChange(
            change,
            [],
            [{ graphId: 'g1', signalNames: ['old', 'keep'] }]
        );
        assert.deepEqual(patches, [{ graphId: 'g1', signalNames: ['keep'] }]);
    });

    it('leaves a rename onto an existing declaration alone', () => {
        const change = {
            previous: signalNode('n1', 'old'),
            current: signalNode('n1', 'existing'),
        };
        const declared = declaredSignalEntries([signalNode('n2', 'existing')]);
        const patches = signalReferencePatchesForChange(
            change,
            declared,
            [{ graphId: 'g1', signalNames: ['old'] }]
        );
        assert.deepEqual(patches, []);
    });

    it('does not merge duplicate declarations', () => {
        const entries = declaredSignalEntries([signalNode('n1', 'x'), signalNode('n2', 'x')]);
        assert.equal(entries.length, 2);
    });

    it('ignores non-signal-post nodes', () => {
        const entries = declaredSignalEntries([
            { id: 'n1', type: 'var-write', controlValues: { signal: 'x' } },
        ]);
        assert.deepEqual(entries, []);
    });

    it('reports watched names with no declaration', () => {
        assert.deepEqual(danglingSignalReferences(['a', 'b'], ['a']), ['b']);
        assert.deepEqual(danglingSignalReferences(['a'], ['a', 'b']), []);
    });
});

describe('SignalReferenceReconciler', () => {
    function graph(id, nodes = [], signalNames = []) {
        const state = { signalNames };
        const writes = [];
        return {
            getId: () => id,
            getNodes: () => nodes,
            getSignalNames: () => state.signalNames,
            setSignalNames(names) {
                writes.push(names);
                state.signalNames = names;
            },
            writes,
        };
    }

    it('rewrites a referencing graph on rename', () => {
        const declaring = graph('g1', [signalNode('n1', 'old')]);
        const watching = graph('g2', [], ['old', 'keep']);
        const reconciler = new SignalReferenceReconciler(() => [declaring, watching]);

        reconciler.reconcile({
            previous: signalNode('n1', 'old'),
            current: signalNode('n1', 'new'),
        });

        assert.deepEqual(watching.writes, [['new', 'keep']]);
    });

    it('drops the name on removal', () => {
        const declaring = graph('g1', []);
        const watching = graph('g2', [], ['old', 'keep']);
        const reconciler = new SignalReferenceReconciler(() => [declaring, watching]);

        reconciler.reconcile({
            previous: signalNode('n1', 'old'),
            current: null,
        });

        assert.deepEqual(watching.writes, [['keep']]);
    });

    it('leaves a graph with no reference untouched', () => {
        const declaring = graph('g1', [signalNode('n1', 'old')]);
        const watching = graph('g2', [], ['other']);
        const reconciler = new SignalReferenceReconciler(() => [declaring, watching]);

        reconciler.reconcile({
            previous: signalNode('n1', 'old'),
            current: signalNode('n1', 'new'),
        });

        assert.deepEqual(watching.writes, []);
    });

    it('does not merge duplicate declarations', () => {
        const declaring = graph('g1', [signalNode('n1', 'x'), signalNode('n2', 'y')]);
        const watching = graph('g2', [], ['x']);
        const reconciler = new SignalReferenceReconciler(() => [declaring, watching]);

        // Renaming n1 onto 'y' (already declared by n2) is left alone.
        reconciler.reconcile({
            previous: signalNode('n1', 'x'),
            current: signalNode('n1', 'y'),
        });

        assert.deepEqual(watching.writes, []);
    });
});

