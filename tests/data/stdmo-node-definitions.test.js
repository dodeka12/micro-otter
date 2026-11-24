import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const defsPath = path.resolve('src/micro_otter/nodes/device/node_pkgs/stdmo/node_definitions.json');

function loadNodeTypes() {
    return JSON.parse(readFileSync(defsPath, 'utf8')).nodeTypes;
}

describe('stdmo node definitions', () => {
    it('defines the servo as the only stdmo node', () => {
        const nodeTypes = loadNodeTypes();
        assert.deepEqual(Object.keys(nodeTypes), ['servo']);
    });

    it('leads with a bool enabled gate before the angle input', () => {
        const servo = loadNodeTypes().servo;
        assert.deepEqual(
            servo.inputs.map((input) => input.id),
            ['enabled', 'angle']
        );

        const enabled = servo.inputs[0];
        assert.deepEqual(enabled.allowedTypes, ['bool']);
        assert.deepEqual(enabled.initialTypes, ['bool']);
        assert.equal(enabled.defaultControl.type, 'checkbox');
        assert.equal(enabled.defaultControl.default, true);
        assert.equal(enabled.name.en, 'Enabled');
        assert.equal(enabled.name.de, 'Aktiviert');
        assert.ok(enabled.description.en.length > 0);
        assert.ok(enabled.description.de.length > 0);
    });

    it('keeps the callable function implementation and angle output', () => {
        const servo = loadNodeTypes().servo;
        assert.equal(servo.implementations.python.type, 'function');
        assert.equal(servo.implementations.python.value, 'otter_stdmo.servo_callable.ServoNodeFn');
        assert.deepEqual(
            servo.outputs.map((output) => output.id),
            ['angleOut']
        );
    });
});
