import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function loadDefinitions(pkg) {
    return JSON.parse(
        readFileSync(
            path.resolve(`src/micro_otter/nodes/device/node_pkgs/${pkg}/node_definitions.json`),
            'utf8'
        )
    ).nodeTypes;
}

const core = loadDefinitions('core');
const audio = loadDefinitions('audio');
const power = loadDefinitions('power');
const irq = loadDefinitions('irq');

function controlOf(nodeType, id) {
    return nodeType.controls.find((control) => control.id === id);
}

describe('dynamic control consumers (definitions)', () => {
    it('core pin controls are capability-filtered dropdowns', () => {
        const cases = [
            ['adc-input', 'adc.wifiSafe'],
            ['adc-array', 'adc.wifiSafe'],
            ['dac-output', 'dac'],
            ['digital-input', 'digital.input'],
            ['digital-output', 'digital.output'],
        ];
        for (const [nodeId, capabilityKey] of cases) {
            const control = controlOf(core[nodeId], 'pin');
            assert.equal(control.type, 'dropdown', `${nodeId}.pin`);
            assert.equal(
                control.dynamicOptions.source,
                'targetPinsForCapability',
                `${nodeId}.pin source`
            );
            assert.equal(control.dynamicOptions.capabilityKey, capabilityKey, `${nodeId}.pin key`);

            const resource = core[nodeId].resourceUsage.find((entry) => entry.controlId === 'pin');
            assert.equal(resource.capability, capabilityKey, `${nodeId}.resourceUsage`);
        }
    });

    it('battery-monitor.adcPin is a capability-filtered dropdown', () => {
        const control = controlOf(power['battery-monitor'], 'adcPin');
        assert.equal(control.type, 'dropdown');
        assert.equal(control.dynamicOptions.source, 'targetPinsForCapability');
        assert.equal(control.dynamicOptions.capabilityKey, 'adc.wifiSafe');

        const resource = power['battery-monitor'].resourceUsage.find(
            (entry) => entry.controlId === 'adcPin'
        );
        assert.equal(resource.capability, 'adc.wifiSafe');
    });

    it('i2s pin controls are capability-filtered dropdowns', () => {
        const mic = audio['i2s-input'];
        const speaker = audio['i2s-output'];

        assert.equal(controlOf(mic, 'bclkPin').dynamicOptions.capabilityKey, 'i2s.bclk');
        assert.equal(controlOf(mic, 'wsPin').dynamicOptions.capabilityKey, 'i2s.ws');
        assert.equal(controlOf(mic, 'dataPin').dynamicOptions.capabilityKey, 'i2s.din');
        assert.equal(controlOf(speaker, 'bclkPin').dynamicOptions.capabilityKey, 'i2s.bclk');
        assert.equal(controlOf(speaker, 'wsPin').dynamicOptions.capabilityKey, 'i2s.ws');
        assert.equal(controlOf(speaker, 'dataPin').dynamicOptions.capabilityKey, 'i2s.dout');

        for (const id of ['bclkPin', 'wsPin', 'dataPin']) {
            assert.equal(controlOf(mic, id).type, 'dropdown', `mic ${id}`);
            assert.equal(controlOf(speaker, id).type, 'dropdown', `speaker ${id}`);
        }

        assert.equal(
            mic.resourceUsage.find((entry) => entry.controlId === 'bclkPin').capability,
            'i2s.bclk'
        );
        assert.equal(
            mic.resourceUsage.find((entry) => entry.controlId === 'wsPin').capability,
            'i2s.ws'
        );
        assert.equal(
            mic.resourceUsage.find((entry) => entry.controlId === 'dataPin').capability,
            'i2s.din'
        );
        assert.equal(
            speaker.resourceUsage.find((entry) => entry.controlId === 'dataPin').capability,
            'i2s.dout'
        );
    });

    it('i2s controller controls are resource-count dropdowns', () => {
        for (const nodeId of ['i2s-input', 'i2s-output']) {
            const control = controlOf(audio[nodeId], 'i2sId');
            assert.equal(control.type, 'dropdown', nodeId);
            assert.deepEqual(control.dynamicOptions, {
                source: 'targetResourceValues',
                resourceGroup: 'i2s',
                resourceKey: 'controllers',
            });

            const bus = audio[nodeId].resourceUsage.find((entry) => entry.controlId === 'i2sId');
            assert.equal(bus.kind, 'bus');
            assert.equal(bus.type, 'i2s');
        }
    });

    it('blockSamples controls are power-of-2 dropdowns', () => {
        for (const nodeId of ['i2s-input', 'i2s-output']) {
            const control = controlOf(audio[nodeId], 'blockSamples');
            assert.equal(control.type, 'dropdown', nodeId);
            assert.deepEqual(
                control.options.map((option) => option.value),
                [64, 128, 256, 512, 1024],
                nodeId
            );
            assert.equal(control.default, 256, nodeId);
        }
    });

    it('irq pin and trigger-name controls declare their dynamic sources', () => {
        const input = irq['interrupt-input'];
        const pin = controlOf(input, 'pin');
        assert.equal(pin.type, 'dropdown');
        assert.equal(pin.dynamicOptions.source, 'targetPinsForCapability');
        assert.equal(pin.dynamicOptions.capabilityKey, 'irq');
        assert.equal(
            input.resourceUsage.find((entry) => entry.controlId === 'pin').capability,
            'irq'
        );
        // The declaring side is free text; only the enable node picks a declared name.
        assert.equal(controlOf(input, 'triggerName').type, 'text');
        assert.equal(controlOf(input, 'triggerName').dynamicOptions, undefined);

        const enableName = controlOf(irq['interrupt-enable'], 'triggerName');
        assert.equal(enableName.type, 'dropdown');
        assert.deepEqual(enableName.dynamicOptions, { source: 'irqTriggerNames' });
    });
});
