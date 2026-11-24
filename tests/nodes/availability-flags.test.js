import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    availabilityFlagIdOf,
    availabilityFlagOptions,
    collectAvailabilityFlagIds,
    collectCollectionNodes,
    DEVICE_AVAILABILITY_ENTRY,
    DEVICE_AVAILABILITY_LABEL,
    isAvailabilityFlagNode,
    sanitizeAvailabilityId,
} from '../../src/micro_otter/nodes/html/js/nodes/availability-flags.js';
import { resolveDynamicControl } from '../../src/micro_otter/nodes/html/js/nodes/node-control-dynamic-resolver.js';

function flagNode(id, flagId) {
    return {
        id,
        type: 'hass.hass-availability',
        controls: [{ id: 'id', type: 'text' }],
        controlValues: { id: flagId },
    };
}

function entityNode(id, flags) {
    return {
        id,
        type: 'hass.hass-sensor',
        controls: [{ id: 'availabilityFlags', type: 'multi-dropdown' }],
        controlValues: { availabilityFlags: flags },
    };
}

function graphOf(...nodes) {
    return { getNodes: () => nodes };
}

function collectionOf(...nodes) {
    return { getGraphArray: () => [graphOf(...nodes)] };
}

function resolveFlagControl(nodeData, { collection = null, graph = null } = {}) {
    return resolveDynamicControl({
        control: {
            id: 'availabilityFlags',
            type: 'multi-dropdown',
            dynamicOptions: { source: 'availabilityRefs' },
        },
        nodeData: { controlValues: nodeData },
        deviceTarget: null,
        graph,
        collection,
    });
}

describe('availability flag collector', () => {
    it('sanitises exactly like the hass runtime', () => {
        assert.equal(sanitizeAvailabilityId('heating'), 'heating');
        assert.equal(sanitizeAvailabilityId('Heating Pwr!'), 'Heating_Pwr');
        assert.equal(sanitizeAvailabilityId('  __pump__  '), 'pump');
        assert.equal(sanitizeAvailabilityId('a/b'), 'a_b');
        assert.equal(sanitizeAvailabilityId('   '), '');
        assert.equal(sanitizeAvailabilityId(undefined), '');
    });

    it('recognises flag nodes with and without a package prefix', () => {
        assert.equal(isAvailabilityFlagNode(flagNode('a', 'heating')), true);
        assert.equal(
            isAvailabilityFlagNode({ id: 'b', type: 'hass-availability', controlValues: {} }),
            true
        );
        assert.equal(isAvailabilityFlagNode(entityNode('c', [])), false);
        assert.equal(isAvailabilityFlagNode(null), false);
    });

    it('reads the raw id of a flag node', () => {
        assert.equal(availabilityFlagIdOf(flagNode('a', '  heating ')), 'heating');
        assert.equal(availabilityFlagIdOf(flagNode('a', '')), '');
        assert.equal(availabilityFlagIdOf({ id: 'a', type: 'hass-availability' }), '');
    });

    it('de-duplicates by sanitised id and sorts', () => {
        const ids = collectAvailabilityFlagIds([
            flagNode('n1', 'heating'),
            flagNode('n2', 'a-pump'),
            flagNode('n3', 'heating!'),
            flagNode('n4', ''),
            entityNode('n5', ['ignored']),
        ]);

        assert.deepEqual(ids, ['a-pump', 'heating']);
    });

    it('keeps ids that differ only in case apart', () => {
        // MQTT topics are case sensitive, so `Heating` and `heating` are different flags.
        assert.deepEqual(
            collectAvailabilityFlagIds([flagNode('n1', 'heating'), flagNode('n2', 'Heating')]),
            ['heating', 'Heating']
        );
    });

    it('always offers the device availability entry first', () => {
        assert.equal(DEVICE_AVAILABILITY_ENTRY, '__device__');
        assert.equal(DEVICE_AVAILABILITY_LABEL, 'Device');
        assert.deepEqual(availabilityFlagOptions([]), [
            { value: DEVICE_AVAILABILITY_ENTRY, label: DEVICE_AVAILABILITY_LABEL },
        ]);
    });

    it('labels a flag with its topic segment when sanitising changes it', () => {
        const options = availabilityFlagOptions([
            flagNode('n1', 'Heating Pwr!'),
            flagNode('n2', 'pump'),
        ]);

        assert.deepEqual(options, [
            { value: DEVICE_AVAILABILITY_ENTRY, label: DEVICE_AVAILABILITY_LABEL },
            { value: 'Heating Pwr!', label: 'Heating Pwr! \u2192 Heating_Pwr' },
            { value: 'pump', label: 'pump' },
        ]);
    });

    it('reserves the device entry so a flag node cannot duplicate it', () => {
        assert.deepEqual(
            collectAvailabilityFlagIds([
                flagNode('n1', '__device__'),
                flagNode('n2', '  __device__ '),
                flagNode('n3', 'heating'),
            ]),
            ['heating']
        );
        assert.equal(
            availabilityFlagOptions([flagNode('n1', '__device__')]).filter(
                (option) => option.value === DEVICE_AVAILABILITY_ENTRY
            ).length,
            1
        );
    });

    it('collects the nodes of every graph of the collection', () => {
        const graphs = {
            getGraphArray: () => [
                graphOf(flagNode('a', 'heating')),
                graphOf(flagNode('b', 'pump')),
            ],
        };
        const graph = graphOf(flagNode('c', 'fallback'));

        assert.deepEqual(
            collectCollectionNodes(graphs, graph).map((node) => node.id),
            ['a', 'b']
        );
        assert.deepEqual(
            collectCollectionNodes(null, graph).map((node) => node.id),
            ['c']
        );
        assert.deepEqual(collectCollectionNodes(null, null), []);
    });
});

describe('availabilityRefs dynamic control', () => {
    it('lists the flags of the collection', () => {
        const result = resolveFlagControl(
            { availabilityFlags: [] },
            { collection: collectionOf(flagNode('n1', 'pump'), flagNode('n2', 'heating')) }
        );

        assert.deepEqual(
            result.options.map((option) => option.value),
            [DEVICE_AVAILABILITY_ENTRY, 'heating', 'pump']
        );
        assert.equal(result.disabled, false);
        assert.deepEqual(result.value, []);
    });

    it('keeps a stored selection that no flag node defines any more', () => {
        const result = resolveFlagControl(
            { availabilityFlags: ['heating', 'ghost'] },
            { collection: collectionOf(flagNode('n1', 'heating')) }
        );

        assert.deepEqual(
            result.options.map((option) => option.value),
            [DEVICE_AVAILABILITY_ENTRY, 'heating', 'ghost']
        );
        assert.equal(result.options[2].label, 'ghost (missing)');
        assert.deepEqual(result.value, ['heating', 'ghost']);
    });

    it('does not mark the stored device entry as missing', () => {
        const result = resolveFlagControl(
            { availabilityFlags: [DEVICE_AVAILABILITY_ENTRY, 'ghost'] },
            { collection: collectionOf() }
        );

        assert.deepEqual(result.value, [DEVICE_AVAILABILITY_ENTRY, 'ghost']);
        assert.equal(
            result.options.find((option) => option.value === DEVICE_AVAILABILITY_ENTRY).label,
            DEVICE_AVAILABILITY_LABEL
        );
        assert.equal(result.options.at(-1).label, 'ghost (missing)');
    });

    it('normalises a stored value to a list of ids', () => {
        const fromString = resolveFlagControl(
            { availabilityFlags: 'heating' },
            { collection: collectionOf(flagNode('n1', 'heating')) }
        );
        assert.deepEqual(fromString.value, ['heating']);

        const withHoles = resolveFlagControl(
            { availabilityFlags: [' heating ', '', null, 'heating'] },
            { collection: collectionOf(flagNode('n1', 'heating')) }
        );
        assert.deepEqual(withHoles.value, ['heating']);
    });

    it('keeps the device option enabled when the collection has no named flags', () => {
        const result = resolveFlagControl(
            { availabilityFlags: [] },
            { collection: collectionOf() }
        );

        assert.deepEqual(result.options, [
            { value: DEVICE_AVAILABILITY_ENTRY, label: DEVICE_AVAILABILITY_LABEL },
        ]);
        assert.equal(result.disabled, false);
        assert.deepEqual(result.value, []);
    });

    it('falls back to the current graph without a collection', () => {
        const result = resolveFlagControl(
            { availabilityFlags: [] },
            { graph: graphOf(flagNode('n1', 'heating'), entityNode('n2', [])) }
        );

        assert.deepEqual(
            result.options.map((option) => option.value),
            [DEVICE_AVAILABILITY_ENTRY, 'heating']
        );
    });

    it('is registered under the source the definitions use', () => {
        const result = resolveDynamicControl({
            control: {
                id: 'availabilityFlags',
                type: 'multi-dropdown',
                dynamicOptions: { source: 'availabilityRefs' },
            },
            nodeData: { controlValues: {} },
            deviceTarget: null,
            collection: collectionOf(flagNode('n1', 'heating')),
        });

        assert.deepEqual(
            result.options.map((option) => option.value),
            [DEVICE_AVAILABILITY_ENTRY, 'heating']
        );
    });
});
