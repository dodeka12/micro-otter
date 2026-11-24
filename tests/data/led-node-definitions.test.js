import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const defsPath = path.resolve('src/micro_otter/nodes/device/node_pkgs/led/node_definitions.json');

function loadNodeTypes() {
    return JSON.parse(readFileSync(defsPath, 'utf8')).nodeTypes;
}

describe('led node definitions', () => {
    it('defines only the three output nodes', () => {
        const nodeTypes = loadNodeTypes();
        assert.deepEqual(Object.keys(nodeTypes).sort(), [
            'led-neopixel-output',
            'led-pwm-strip-output',
            'led-single-output',
        ]);
        for (const id of ['led-neopixel-output', 'led-pwm-strip-output', 'led-single-output']) {
            assert.equal(nodeTypes[id].implementations.python.type, 'code-generator');
        }
    });

    it('output nodes are both-phase with resource usage', () => {
        const nodeTypes = loadNodeTypes();
        assert.equal(nodeTypes['led-neopixel-output'].executionPhase, 'both');
        assert.deepEqual(nodeTypes['led-neopixel-output'].resourceUsage, [
            { kind: 'pin', controlId: 'pin', capability: 'digital.output' },
        ]);
        assert.equal(nodeTypes['led-single-output'].resourceUsage[0].capability, 'pwm.output');
    });

    it('neopixel node keeps color order and color model controls', () => {
        const nodeTypes = loadNodeTypes();
        const controls = nodeTypes['led-neopixel-output'].controls.map((control) => control.id);
        assert.deepEqual(controls, ['pin', 'count', 'order', 'colorModel']);

        const order = nodeTypes['led-neopixel-output'].controls.find(
            (control) => control.id === 'order'
        );
        assert.deepEqual(
            order.options.map((option) => option.value),
            ['GRB', 'RGB', 'BRG', 'RBG', 'GBR', 'BGR']
        );
        assert.ok(order.options.every((option) => option.value.length === 3));
        assert.equal(order.default, 'GRB');

        const colorModel = nodeTypes['led-neopixel-output'].controls.find(
            (control) => control.id === 'colorModel'
        );
        assert.deepEqual(
            colorModel.options.map((option) => option.value),
            ['single', 'rgb', 'rgbw']
        );
    });

    it('neopixel count control matches the driver contract', () => {
        const nodeTypes = loadNodeTypes();
        const count = nodeTypes['led-neopixel-output'].controls.find(
            (control) => control.id === 'count'
        );
        assert.equal(count.min, 1);
        assert.equal(count.max, 4096);
        assert.equal(count.step, 1);
        assert.match(count.description.en, /physical LED count/);
        assert.match(count.description.de, /tatsächlichen LED-Anzahl/);
    });

    it('appends one bool enabled gate to every LED output', () => {
        const nodeTypes = loadNodeTypes();
        const expected = {
            'led-neopixel-output': ['enabled', 'channel0', 'channel1', 'channel2', 'channel3'],
            'led-pwm-strip-output': ['enabled', 'r', 'g', 'b'],
            'led-single-output': ['enabled', 'value'],
        };

        for (const [id, inputIds] of Object.entries(expected)) {
            const inputs = nodeTypes[id].inputs;
            assert.deepEqual(
                inputs.map((input) => input.id),
                inputIds,
                `${id} inputs`
            );
            const enabled = inputs[0];
            assert.deepEqual(enabled.allowedTypes, ['bool']);
            assert.deepEqual(enabled.initialTypes, ['bool']);
            assert.equal(enabled.defaultControl.type, 'checkbox');
            assert.equal(enabled.defaultControl.default, true);
            assert.ok(enabled.description.en.length > 0);
            assert.ok(enabled.description.de.length > 0);
        }
    });

    it('colorModel documents single/rgb/rgbw and info no longer advertises padding', () => {
        const nodeTypes = loadNodeTypes();
        const node = nodeTypes['led-neopixel-output'];
        const colorModel = node.controls.find((control) => control.id === 'colorModel');
        assert.match(colorModel.description.en, /Channel 0/);
        const infoEn = node.info.en;
        assert.match(infoEn, /match the physical number of LEDs/);
        assert.doesNotMatch(infoEn, /padded with zeros/);
    });
});
