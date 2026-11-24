import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { validateNodeCapabilities } from '../../src/micro_otter/nodes/html/js/core/node-capability-validator.js';
import '../../src/micro_otter/nodes/device/node_pkgs/core/node_capabilities.js';

const coreDefsPath = path.resolve(
    'src/micro_otter/nodes/device/node_pkgs/core/node_definitions.json'
);
const audioDefsPath = path.resolve(
    'src/micro_otter/nodes/device/node_pkgs/audio/node_definitions.json'
);
const ledDefsPath = path.resolve(
    'src/micro_otter/nodes/device/node_pkgs/led/node_definitions.json'
);
const s3Path = path.resolve('src/micro_otter/nodes/device/targets/esp32_s3.json');
const s2Path = path.resolve('src/micro_otter/nodes/device/targets/esp32_s2.json');
const s3MiniPath = path.resolve('src/micro_otter/nodes/device/targets/esp32_s3_mini.json');
const wroomPath = path.resolve('src/micro_otter/nodes/device/targets/esp32_wroom.json');
const genericPath = path.resolve('src/micro_otter/nodes/device/targets/generic_micropython.json');

function loadJson(filePath) {
    return JSON.parse(readFileSync(filePath, 'utf8'));
}

const coreDefs = loadJson(coreDefsPath).nodeTypes;
const audioDefs = loadJson(audioDefsPath).nodeTypes;
const ledDefs = loadJson(ledDefsPath).nodeTypes;
const s3 = loadJson(s3Path);
const s2 = loadJson(s2Path);
const s3Mini = loadJson(s3MiniPath);
const wroom = loadJson(wroomPath);
const generic = loadJson(genericPath);

function issuesFor(node, nodeType, capabilities) {
    return validateNodeCapabilities({
        node,
        nodeType,
        capabilities,
        targetId: capabilities.targetId,
    }).issues;
}

function membershipIssues(issues) {
    return issues.filter((issue) => /does not support/.test(issue.message));
}

describe('core pin node capability validation', () => {
    it('adc-input validates against esp32_s3_mini', () => {
        const ok = issuesFor({ id: 'adc', controlValues: { pin: 1 } }, coreDefs['adc-input'], s3);
        assert.equal(membershipIssues(ok).length, 0);

        const bad = issuesFor({ id: 'adc', controlValues: { pin: 11 } }, coreDefs['adc-input'], s3);
        assert.ok(membershipIssues(bad).some((issue) => /adc\.wifiSafe/.test(issue.message)));
    });

    it('adc-array validates against esp32_s3', () => {
        const ok = issuesFor(
            { id: 'adcBlock', controlValues: { pin: 1 } },
            coreDefs['adc-array'],
            s3
        );
        assert.equal(membershipIssues(ok).length, 0);

        const bad = issuesFor(
            { id: 'adcBlock', controlValues: { pin: 11 } },
            coreDefs['adc-array'],
            s3
        );
        assert.ok(membershipIssues(bad).some((issue) => /adc\.wifiSafe/.test(issue.message)));
    });

    it('digital-input validates pin membership and pull selection', () => {
        const ok = issuesFor(
            { id: 'di', controlValues: { pin: 0, pull: null } },
            coreDefs['digital-input'],
            s3
        );
        assert.equal(membershipIssues(ok).length, 0);

        const badPin = issuesFor(
            { id: 'di', controlValues: { pin: 26, pull: null } },
            coreDefs['digital-input'],
            s3
        );
        assert.ok(membershipIssues(badPin).some((issue) => /digital\.input/.test(issue.message)));

        const badPull = issuesFor(
            { id: 'di', controlValues: { pin: 44, pull: 'up' } },
            coreDefs['digital-input'],
            s3
        );
        assert.ok(badPull.some((issue) => issue.capability === 'pull.up'));
    });

    it('digital-output validates pin membership', () => {
        const ok = issuesFor(
            { id: 'do', controlValues: { pin: 2 } },
            coreDefs['digital-output'],
            s3
        );
        assert.equal(membershipIssues(ok).length, 0);

        const bad = issuesFor(
            { id: 'do', controlValues: { pin: 44 } },
            coreDefs['digital-output'],
            s3
        );
        assert.ok(membershipIssues(bad).some((issue) => /digital\.output/.test(issue.message)));
    });

    it('dac-output validates against esp32_wroom', () => {
        const ok = issuesFor(
            { id: 'dac', controlValues: { pin: 25 } },
            coreDefs['dac-output'],
            wroom
        );
        assert.equal(membershipIssues(ok).length, 0);

        const bad = issuesFor(
            { id: 'dac', controlValues: { pin: 1 } },
            coreDefs['dac-output'],
            wroom
        );
        assert.ok(membershipIssues(bad).some((issue) => issue.capability === 'dac'));
    });

    it('dac-output requires the dac capability on esp32_s3', () => {
        for (const controlValues of [{ pin: 25 }, { pin: null }, {}]) {
            const issues = issuesFor({ id: 'dac', controlValues }, coreDefs['dac-output'], s3);
            assert.equal(issues.length, 1, JSON.stringify(controlValues));
            assert.equal(issues[0].capability, 'dac');
            assert.equal(issues[0].source, 'requiredCapabilities');
            assert.equal(issues[0].message, 'Missing required capability: dac');
            assert.equal(
                issues.some((issue) => /does not support/.test(issue.message)),
                false
            );
        }
    });

    it('dac-output requires the dac capability on the esp32_s3_mini delta', () => {
        const issues = issuesFor(
            { id: 'dac', controlValues: { pin: 25 } },
            coreDefs['dac-output'],
            s3Mini
        );
        assert.equal(issues.length, 1);
        assert.equal(issues[0].capability, 'dac');
        assert.equal(issues[0].message, 'Missing required capability: dac');
    });

    it('dac-output stays clean on esp32_wroom but keeps a bad-pin line', () => {
        const ok = issuesFor(
            { id: 'dac', controlValues: { pin: 25 } },
            coreDefs['dac-output'],
            wroom
        );
        assert.deepEqual(ok, []);

        const bad = issuesFor(
            { id: 'dac', controlValues: { pin: 1 } },
            coreDefs['dac-output'],
            wroom
        );
        assert.equal(bad.length, 1);
        assert.equal(bad[0].message, 'Pin 1 does not support dac.');
    });

    it('bypasses the derived requirement on the open pin set', () => {
        const result = validateNodeCapabilities({
            node: { id: 'dac', controlValues: { pin: 25 } },
            nodeType: coreDefs['dac-output'],
            capabilities: generic,
            targetId: generic.targetId,
        });
        assert.equal(result.bypassed, true);
        assert.deepEqual(result.issues, []);
    });

    it('does not invent a node issue when the target exposes adc pins', () => {
        const issues = issuesFor(
            { id: 'adc', controlValues: { pin: 6 } },
            coreDefs['adc-input'],
            s3
        );
        assert.deepEqual(issues, []);
    });

    it('reports one node issue for adc-input on a target without adc pins', () => {
        const issues = issuesFor({ id: 'adc', controlValues: { pin: 6 } }, coreDefs['adc-input'], {
            capabilityToPins: { 'digital.output': [2] },
        });

        assert.equal(issues.length, 1);
        assert.equal(issues[0].scope, 'node');
        assert.equal(issues[0].capability, 'adc.wifiSafe');
        assert.equal(issues[0].message, 'Missing required capability: adc.wifiSafe');
    });

    it('derives one node issue per incomplete i2s-input pin', () => {
        const issues = issuesFor(
            {
                id: 'mic',
                controlValues: { bclkPin: 1, wsPin: 2, dataPin: 3, i2sId: 0 },
            },
            audioDefs['i2s-input'],
            { capabilityToPins: { 'digital.output': [2] } }
        );

        assert.equal(issues.length, 3);
        assert.deepEqual(
            issues.map((issue) => issue.capability).sort(),
            ['i2s.bclk', 'i2s.din', 'i2s.ws']
        );
        for (const issue of issues) {
            assert.equal(issue.scope, 'node');
            assert.equal(issue.message, `Missing required capability: ${issue.capability}`);
        }
        assert.equal(
            issues.some((issue) => /does not support/.test(issue.message)),
            false
        );
    });

    it('collapses repeated pwm.output pins into one node issue', () => {
        const issues = issuesFor(
            { id: 'strip', controlValues: { redPin: 1, greenPin: 2, bluePin: 3 } },
            ledDefs['led-pwm-strip-output'],
            { capabilityToPins: { 'digital.output': [2] } }
        );

        assert.equal(issues.length, 1);
        assert.equal(issues[0].scope, 'node');
        assert.equal(issues[0].message, 'Missing required capability: pwm.output');
    });

    it('accepts both DAC pins of the esp32_s2 target', () => {
        for (const pin of [17, 18]) {
            const issues = issuesFor(
                { id: 'dac', controlValues: { pin } },
                coreDefs['dac-output'],
                s2
            );
            assert.deepEqual(issues, [], `GPIO${pin}`);
        }
    });

    it('keeps a genuine bad-pin line on the DAC-capable esp32_s2 target', () => {
        const issues = issuesFor(
            { id: 'dac', controlValues: { pin: 1 } },
            coreDefs['dac-output'],
            s2
        );

        assert.equal(issues.length, 1);
        assert.equal(issues[0].scope, 'control');
        assert.equal(issues[0].message, 'Pin 1 does not support dac.');
    });

    it('satisfies the adc and i2s requirements on esp32_s2', () => {
        assert.deepEqual(
            issuesFor({ id: 'adc', controlValues: { pin: 6 } }, coreDefs['adc-input'], s2),
            []
        );

        for (const nodeTypeId of ['i2s-input', 'i2s-output']) {
            assert.deepEqual(
                issuesFor(
                    { id: 'audio', controlValues: { bclkPin: 5, wsPin: 6, dataPin: 7 } },
                    audioDefs[nodeTypeId],
                    s2
                ),
                [],
                nodeTypeId
            );
        }
    });

    it('does not require the optional i2s-output amplifier pins on esp32_s2', () => {
        const issues = issuesFor(
            {
                id: 'audio',
                controlValues: {
                    bclkPin: 5,
                    wsPin: 6,
                    dataPin: 7,
                    sdPin: 9,
                    gainPin: 10,
                },
            },
            audioDefs['i2s-output'],
            s2
        );

        assert.deepEqual(issues, []);
    });
});
