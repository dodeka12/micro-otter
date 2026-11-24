import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const PACKAGE_ROOT = 'src/micro_otter/nodes/device/node_pkgs';

const IN_SCOPE = {
    core: {
        print: 0,
        'dac-output': 0,
        'digital-output': 0,
    },
    hass: {
        'hass-sensor': 0,
        'hass-binary-sensor': 0,
        'hass-availability': 0,
        'hass-number': 0,
        'hass-switch': 0,
        'hass-select': 0,
        'hass-text': 0,
    },
    mqtt: {
        'mqtt-write': 0,
        'mqtt-announce': 0,
    },
    vars: {
        'random-seed': 0,
        'signal-post': 0,
        'var-write': 0,
        'var-store-save': 0,
    },
    webview: {
        'web-store-write': 0,
        'web-store-save': 0,
    },
    led: {
        'led-neopixel-output': 0,
        'led-pwm-strip-output': 0,
        'led-single-output': 0,
    },
    stdmo: {
        servo: 0,
    },
};

const EXCLUSIONS = [
    ['hass', 'hass-bridge'],
    ['hass', 'hass-button'],
    ['mqtt', 'mqtt-will'],
    ['mqtt', 'mqtt-read'],
    ['mqtt', 'mqtt-status'],
    ['vars', 'var-read'],
    ['vars', 'var-store-load'],
    ['vars', 'array-modify'],
    ['webview', 'web-store-read'],
    ['webview', 'web-store-load'],
    ['webview', 'web-view-slider'],
];

function loadNodeTypes(packageId) {
    const file = path.resolve(PACKAGE_ROOT, packageId, 'node_definitions.json');
    return JSON.parse(readFileSync(file, 'utf8')).nodeTypes;
}

function assertLocalized(value, trail) {
    assert.equal(typeof value?.en, 'string', `${trail} misses en`);
    assert.equal(typeof value?.de, 'string', `${trail} misses de`);
    assert.ok(value.en.length > 0, `${trail} en is empty`);
    assert.ok(value.de.length > 0, `${trail} de is empty`);
}

describe('enabled gates for side-effect nodes', () => {
    Object.entries(IN_SCOPE).forEach(([packageId, nodes]) => {
        it(`leads with enabled on the ${packageId} side-effect nodes`, () => {
            const nodeTypes = loadNodeTypes(packageId);

            Object.entries(nodes).forEach(([nodeId, expectedIndex]) => {
                const inputs = nodeTypes[nodeId].inputs;
                const enabled = inputs[expectedIndex];
                assert.equal(enabled.id, 'enabled', `${packageId}.${nodeId} must start with enabled`);
                assert.equal(
                    expectedIndex,
                    0,
                    `${packageId}.${nodeId} enabled must be the first input`
                );
                assert.equal(
                    inputs.findIndex((input) => input.id === 'enabled'),
                    0,
                    `${packageId}.${nodeId} enabled must be first`
                );
                assert.deepEqual(enabled.allowedTypes, ['bool']);
                assert.deepEqual(enabled.initialTypes, ['bool']);
                assert.equal(enabled.defaultControl.type, 'checkbox');
                assert.equal(enabled.defaultControl.default, true);
                assertLocalized(enabled.name, `${packageId}.${nodeId} enabled name`);
                assertLocalized(
                    enabled.defaultControl.label,
                    `${packageId}.${nodeId} enabled label`
                );
                assertLocalized(enabled.description, `${packageId}.${nodeId} enabled description`);
            });

            const gatedIds = Object.entries(nodeTypes)
                .filter(([, definition]) =>
                    (definition.inputs || []).some((input) => input.id === 'enabled')
                )
                .map(([nodeId]) => nodeId)
                .sort();
            assert.deepEqual(gatedIds, Object.keys(nodes).sort(), `${packageId} gate set`);
        });
    });

    it('never gates an excluded node', () => {
        EXCLUSIONS.forEach(([packageId, nodeId]) => {
            const inputs = loadNodeTypes(packageId)[nodeId]?.inputs || [];
            assert.ok(
                !inputs.some((input) => input.id === 'enabled'),
                `${packageId}.${nodeId} must stay ungated`
            );
        });
    });
});
