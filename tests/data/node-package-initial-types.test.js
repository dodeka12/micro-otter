import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const PKG_ROOT = 'src/micro_otter/nodes/device/node_pkgs';

function readJson(relativePath) {
    return JSON.parse(readFileSync(path.resolve(relativePath), 'utf8'));
}

function listPackageIds() {
    const index = readJson(path.join(PKG_ROOT, 'index.json'));
    return index.packages.map((entry) => entry.id);
}

function loadDefinitions(packageId) {
    return readJson(path.join(PKG_ROOT, packageId, 'node_definitions.json')).nodeTypes ?? {};
}

function dynamicallyTypedInputIds(nodeType) {
    const ids = new Set();
    for (const control of nodeType.controls ?? []) {
        for (const option of control.options ?? []) {
            for (const inputId of Object.keys(option.inputTypes ?? {})) {
                ids.add(inputId);
            }
        }
    }
    return ids;
}

function isDynamicallyTypedOutput(output) {
    return Boolean(
        output.outputTypeControl ||
            output.outputTypeByControlValue !== undefined ||
            output.typeInputSources !== undefined
    );
}

// NodeGraph.addNode() resets every connector's live type from its `initialTypes`.
// For statically typed connectors that reset must be a no-op, otherwise declared
// `allowedTypes` (e.g. `int` or a namespaced array type) get silently dropped and
// valid connections are rejected. Only dropdown-driven (dynamic) connectors and
// union outputs (`typeInputSources`) may keep a wider `initialTypes` fallback.
describe('node connector initialTypes', () => {
    it('static input initialTypes mirror allowedTypes', () => {
        for (const packageId of listPackageIds()) {
            const nodeTypes = loadDefinitions(packageId);
            for (const [typeId, nodeType] of Object.entries(nodeTypes)) {
                const dynamicInputs = dynamicallyTypedInputIds(nodeType);
                for (const input of nodeType.inputs ?? []) {
                    if (!Array.isArray(input.initialTypes) || input.initialTypes.length === 0) {
                        continue;
                    }
                    if (dynamicInputs.has(input.id)) {
                        continue;
                    }
                    assert.deepEqual(
                        input.initialTypes,
                        input.allowedTypes,
                        `${packageId}/${typeId} input '${input.id}' initialTypes must equal allowedTypes`
                    );
                }
            }
        }
    });

    it('static output initialTypes mirror outputType', () => {
        for (const packageId of listPackageIds()) {
            const nodeTypes = loadDefinitions(packageId);
            for (const [typeId, nodeType] of Object.entries(nodeTypes)) {
                for (const output of nodeType.outputs ?? []) {
                    if (!Array.isArray(output.initialTypes) || output.initialTypes.length === 0) {
                        continue;
                    }
                    if (isDynamicallyTypedOutput(output)) {
                        continue;
                    }
                    assert.deepEqual(
                        output.initialTypes,
                        [output.outputType],
                        `${packageId}/${typeId} output '${output.id}' initialTypes must equal [outputType]`
                    );
                }
            }
        }
    });
});
