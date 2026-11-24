import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { validateNodeCapabilities } from '../../src/micro_otter/nodes/html/js/core/node-capability-validator.js';

const audioDefsPath = path.resolve(
    'src/micro_otter/nodes/device/node_pkgs/audio/node_definitions.json'
);
const powerDefsPath = path.resolve(
    'src/micro_otter/nodes/device/node_pkgs/power/node_definitions.json'
);
const targetPath = path.resolve('src/micro_otter/nodes/device/targets/esp32_s3.json');

function loadJson(filePath) {
    return JSON.parse(readFileSync(filePath, 'utf8'));
}

const target = loadJson(targetPath);
const audioDefs = loadJson(audioDefsPath).nodeTypes;
const powerDefs = loadJson(powerDefsPath).nodeTypes;

function issuesFor(node, nodeType) {
    return validateNodeCapabilities({
        node,
        nodeType,
        capabilities: target,
        targetId: target.targetId,
    }).issues;
}

function membershipIssues(issues) {
    return issues.filter((issue) => /does not support/.test(issue.message));
}

describe('audio/power capability validation against esp32_s3_mini', () => {
    it('produces no membership issues for the Phase 0 pin mapping', () => {
        const mic = issuesFor(
            { id: 'mic', controlValues: { i2sId: 0, bclkPin: 4, wsPin: 5, dataPin: 7 } },
            audioDefs['i2s-input']
        );
        const spk = issuesFor(
            { id: 'spk', controlValues: { i2sId: 1, bclkPin: 4, wsPin: 5, dataPin: 6 } },
            audioDefs['i2s-output']
        );
        const bat = issuesFor(
            { id: 'bat', controlValues: { adcPin: 1 } },
            powerDefs['battery-monitor']
        );

        assert.equal(membershipIssues([...mic, ...spk, ...bat]).length, 0);
    });

    it('flags a membership issue when the mic data pin uses a non-routable pin', () => {
        const mic = issuesFor(
            { id: 'mic', controlValues: { i2sId: 0, bclkPin: 4, wsPin: 5, dataPin: 26 } },
            audioDefs['i2s-input']
        );
        assert.ok(
            membershipIssues(mic).some((issue) => /does not support i2s\.din/.test(issue.message))
        );
    });

    it('flags a membership issue for a wifi-conflicted ADC pin', () => {
        const bat = issuesFor(
            { id: 'bat', controlValues: { adcPin: 11 } },
            powerDefs['battery-monitor']
        );
        assert.ok(
            membershipIssues(bat).some((issue) =>
                /does not support adc\.wifiSafe/.test(issue.message)
            )
        );
    });

    it('requires viper for DSP nodes', () => {
        const gain = audioDefs['gain'];
        assert.deepEqual(gain.requiredCapabilities, ['viper']);

        const supported = issuesFor({ id: 'g', controlValues: {} }, gain).filter((issue) =>
            /Missing required capability: viper/.test(issue.message)
        );
        assert.equal(supported.length, 0, 'esp32_s3_mini supports viper');

        const unsupported = validateNodeCapabilities({
            node: { id: 'g', controlValues: {} },
            nodeType: gain,
            capabilities: { targetId: 'no-viper', capabilityToPins: {}, generalCapabilities: {} },
            targetId: 'no-viper',
        }).issues.filter((issue) => /Missing required capability: viper/.test(issue.message));
        assert.equal(unsupported.length, 1);
    });
});
