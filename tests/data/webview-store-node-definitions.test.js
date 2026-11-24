import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { NodeType } from '../../src/micro_otter/nodes/html/js/data/node-type.js';

const packageRoot = path.resolve('src/micro_otter/nodes/device/node_pkgs/webview');
const defsPath = path.join(packageRoot, 'node_definitions.json');

function loadNodeTypes() {
    return JSON.parse(readFileSync(defsPath, 'utf8')).nodeTypes;
}

describe('webview value-store node definitions', () => {
    it('defines web-store-read and web-store-write as data nodes', () => {
        const nodeTypes = loadNodeTypes();

        for (const id of ['web-store-read', 'web-store-write']) {
            assert.ok(nodeTypes[id], `missing ${id}`);
            assert.equal(nodeTypes[id].category, 'data');
            assert.equal(nodeTypes[id].implementations.python.type, 'code-generator');
        }
        assert.equal(
            nodeTypes['web-store-read'].implementations.python.value,
            'NodeCodeGenerators.webStoreRead'
        );
        assert.equal(
            nodeTypes['web-store-write'].implementations.python.value,
            'NodeCodeGenerators.webStoreWrite'
        );
    });

    it('web-store-read exposes a loop fallback input and one value output', () => {
        const read = loadNodeTypes()['web-store-read'];

        assert.deepEqual(
            read.inputs.map((input) => input.id),
            ['value']
        );
        assert.equal(read.inputs[0].phase, 'loop');
        assert.ok(read.inputs[0].allowedTypes.includes('vars.array'));
        assert.equal(read.outputs.length, 1);
        assert.equal(read.outputs[0].id, 'value');
        assert.equal(read.outputs[0].outputType, 'any');
        assert.equal(read.outputs[0].phase, 'loop');
    });

    it('web-store-write exposes a loop value input and no outputs', () => {
        const write = loadNodeTypes()['web-store-write'];

        assert.deepEqual(
            write.inputs.map((input) => input.id),
            ['enabled', 'value']
        );
        assert.equal(write.inputs[1].phase, 'loop');
        assert.ok(write.inputs[1].allowedTypes.includes('vars.array'));
        assert.deepEqual(write.outputs, []);
    });

    it('both nodes require a text name control', () => {
        const nodeTypes = loadNodeTypes();

        for (const id of ['web-store-read', 'web-store-write']) {
            const controls = nodeTypes[id].controls;
            assert.equal(controls.length, 1, `${id} should have exactly one control`);
            assert.equal(controls[0].id, 'name');
            assert.equal(controls[0].type, 'text');
            assert.equal(controls[0].required, true);
            assert.equal(controls[0].default, '');
        }
    });

    it('neither node declares markup helper or init implementations', () => {
        const nodeTypes = loadNodeTypes();

        for (const id of ['web-store-read', 'web-store-write']) {
            assert.equal(nodeTypes[id].helperImplementations, undefined);
            assert.equal(nodeTypes[id].initImplementations, undefined);
            assert.equal(nodeTypes[id].initFunction, undefined);
            assert.equal(nodeTypes[id].executionPhase, undefined);
        }
    });

    it('all four icons resolve to files inside the package', () => {
        const nodeTypes = loadNodeTypes();
        const ids = ['web-store-read', 'web-store-write', 'web-store-save', 'web-store-load'];

        for (const id of ids) {
            const iconPath = nodeTypes[id].icon;
            assert.ok(iconPath, `${id} is missing an icon`);
            assert.ok(
                existsSync(path.join(packageRoot, iconPath)),
                `${id} icon ${iconPath} does not exist`
            );
        }
    });

    it('does not declare node-level capability requirements', () => {
        const nodeTypes = loadNodeTypes();
        const ids = ['web-store-read', 'web-store-write', 'web-store-save', 'web-store-load'];

        for (const id of ids) {
            assert.equal(nodeTypes[id].requiredCapabilities, undefined);
            assert.equal(nodeTypes[id].capabilityCheck, undefined);
        }
    });

    it('defines web-store-save and web-store-load as loop-phase data nodes', () => {
        const nodeTypes = loadNodeTypes();
        const expected = {
            'web-store-save': { trigger: 'save', impl: 'NodeCodeGenerators.webStoreSave' },
            'web-store-load': { trigger: 'load', impl: 'NodeCodeGenerators.webStoreLoad' },
        };

        for (const [id, { trigger, impl }] of Object.entries(expected)) {
            const node = nodeTypes[id];
            assert.ok(node, `missing ${id}`);
            assert.equal(node.category, 'data');
            assert.equal(node.executionPhase, 'loop');
            assert.equal(node.implementations.python.type, 'code-generator');
            assert.equal(node.implementations.python.value, impl);
            assert.deepEqual(
                node.inputs.map((input) => input.id),
                id === 'web-store-save' ? ['enabled', trigger] : [trigger]
            );
            const triggerIndex = id === 'web-store-save' ? 1 : 0;
            assert.deepEqual(node.inputs[triggerIndex].allowedTypes, ['bool']);
            assert.equal(node.inputs[triggerIndex].phase, 'loop');
            assert.equal(node.inputs[triggerIndex].defaultControl.type, 'checkbox');
            assert.deepEqual(node.outputs, []);
            assert.deepEqual(node.controls, []);
            assert.equal(node.helperImplementations, undefined);
            assert.equal(node.initImplementations, undefined);
            assert.equal(node.initFunction, undefined);
        }
    });

    it('keeps Save off but enables Load by default', () => {
        const nodeTypes = loadNodeTypes();

        assert.equal(nodeTypes['web-store-save'].inputs[1].defaultControl.default, false);
        assert.equal(
            nodeTypes['web-store-load'].inputs[0].defaultControl.default,
            true,
            'Load must default to true so an Init graph restores the store on the first tick'
        );
    });

    it('save and load take no store name, so the reserved namespace stays implicit', () => {
        const nodeTypes = loadNodeTypes();

        assert.deepEqual(
            nodeTypes['web-store-save'].inputs.map((input) => input.id),
            ['enabled', 'save']
        );
        assert.deepEqual(
            nodeTypes['web-store-load'].inputs.map((input) => input.id),
            ['load']
        );
    });

    it('leads the web value writes with a bool enabled gate', () => {
        const nodeTypes = loadNodeTypes();
        for (const id of ['web-store-write', 'web-store-save']) {
            const inputs = nodeTypes[id].inputs;
            const enabled = inputs[0];
            assert.equal(enabled.id, 'enabled', `${id} enabled id`);
            assert.deepEqual(enabled.allowedTypes, ['bool']);
            assert.deepEqual(enabled.initialTypes, ['bool']);
            assert.equal(enabled.defaultControl.type, 'checkbox');
            assert.equal(enabled.defaultControl.default, true);
            assert.ok(enabled.description.en.length > 0);
            assert.ok(enabled.description.de.length > 0);
        }
        assert.deepEqual(
            nodeTypes['web-store-read'].inputs.map((input) => input.id),
            ['value']
        );
        assert.deepEqual(
            nodeTypes['web-store-load'].inputs.map((input) => input.id),
            ['load']
        );
    });

    it('titles the save and load nodes as value store operations', () => {
        const nodeTypes = loadNodeTypes();

        assert.equal(nodeTypes['web-store-read'].title.en, 'Web Value Read');
        assert.equal(nodeTypes['web-store-write'].title.en, 'Web Value Write');
        assert.equal(nodeTypes['web-store-save'].title.en, 'Web Value Store Save');
        assert.equal(nodeTypes['web-store-load'].title.en, 'Web Value Store Load');
    });

    it('uses a palette color between the webview and vars node colors', () => {
        const nodeTypes = loadNodeTypes();

        for (const id of [
            'web-store-read',
            'web-store-write',
            'web-store-save',
            'web-store-load',
        ]) {
            assert.equal(nodeTypes[id].color, '#837faf', `${id} color`);
        }
    });

    it('every node type still loads through NodeType', () => {
        const nodeTypes = loadNodeTypes();

        for (const [id, def] of Object.entries(nodeTypes)) {
            const nodeType = new NodeType({ ...def, type: `webview.${id}` }, '');
            assert.ok(nodeType.toDefinition());
        }
    });
});
