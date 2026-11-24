import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const iconsDir = path.resolve('src/micro_otter/nodes/device/node_pkgs/core/icons');
const nodeDefinitionsPath = path.resolve(
    'src/micro_otter/nodes/device/node_pkgs/core/node_definitions.json'
);

// Analog waveform shared by the PWM/DAC/ADC icons.
const WAVEFORM_PATH =
    'M326-171q-15-11-22-28l-92-241H40v-80h228l92 244 184-485q7-17 22-28t34-11q19 0 34 11t22 28l92 241h172v80H692l-92-244-184 485q-7 17-22 28t-34 11q-19 0-34-11Z';
const ARROW_UP_PATH = 'M740 0h48v-640h100L764-960 616-640h124Z';
const ARROW_DOWN_PATH = 'M740-960h48v640h100L764 0 616-320h124Z';

function readIcon(name) {
    return readFileSync(path.join(iconsDir, name), 'utf8');
}

describe('core pin node icons', () => {
    const expected = [
        'pwm_input_24dp.svg',
        'pwm_output_24dp.svg',
        'digital_input_24dp.svg',
        'digital_output_24dp.svg',
        'division_24dp.svg',
    ];

    for (const name of expected) {
        it(`${name} exists with expected svg attributes`, () => {
            const svg = readIcon(name);
            assert.match(svg, /viewBox=["']0 -960 960 960["']/);
            assert.match(svg, /fill=["']#e3e3e3["']/);
        });
    }

    it('division icon contains one bar path and two dots', () => {
        const svg = readIcon('division_24dp.svg');
        assert.match(svg, /<path/);
        assert.ok((svg.match(/<circle/g) || []).length >= 2, 'expected two dot circles');
    });

    it('adc-input icon mirrors dac-output with a downward arrow', () => {
        const adc = readIcon('pwm_input_24dp.svg');
        const dac = readIcon('pwm_output_24dp.svg');

        assert.ok(adc.includes(WAVEFORM_PATH), 'ADC icon should reuse the DAC waveform');
        assert.ok(dac.includes(WAVEFORM_PATH), 'DAC icon should contain the waveform');
        assert.ok(dac.includes(ARROW_UP_PATH), 'DAC icon should keep the upward arrow');
        assert.ok(adc.includes(ARROW_DOWN_PATH), 'ADC icon should point the arrow down');
        assert.ok(!adc.includes(ARROW_UP_PATH), 'ADC icon must not keep the upward arrow');
    });

    it('adc-input and dac-output reference their mirrored icons', () => {
        const defs = JSON.parse(readFileSync(nodeDefinitionsPath, 'utf8')).nodeTypes;
        assert.equal(defs['adc-input'].icon, 'icons/pwm_input_24dp.svg');
        assert.equal(defs['adc-array'].icon, 'icons/pwm_input_24dp.svg');
        assert.equal(defs['dac-output'].icon, 'icons/pwm_output_24dp.svg');
    });
});
