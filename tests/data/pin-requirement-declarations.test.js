import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { CapabilityRegistry } from '../../src/micro_otter/nodes/html/js/data/capability-registry.js';
import { NodeType } from '../../src/micro_otter/nodes/html/js/data/node-type.js';

const PACKAGES_ROOT = path.resolve('src/micro_otter/nodes/device/node_pkgs');

/** Names of every node package directory that ships a `node_definitions.json`. */
function packageNames() {
    return readdirSync(PACKAGES_ROOT, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .filter((name) => existsSync(path.join(PACKAGES_ROOT, name, 'node_definitions.json')))
        .sort();
}

/** Load the node type map of one package. */
function loadNodeTypes(pkg) {
    const file = path.join(PACKAGES_ROOT, pkg, 'node_definitions.json');
    return JSON.parse(readFileSync(file, 'utf8')).nodeTypes ?? {};
}

const registry = new CapabilityRegistry();
const pinCapabilityIds = new Set(
    registry
        .getAll()
        .filter((descriptor) => descriptor.domain === undefined || descriptor.domain === 'pin')
        .flatMap((descriptor) => [descriptor.id, ...(descriptor.derivedKeys ?? [])])
);

/** `resourceUsage` entries of a node type that declare a pin capability. */
function pinEntries(nodeType) {
    return (nodeType.resourceUsage ?? []).filter(
        (entry) =>
            entry &&
            typeof entry === 'object' &&
            typeof entry.kind === 'string' &&
            entry.kind.trim() === 'pin'
    );
}

/** Find one control definition of a node type by id. */
function controlOf(nodeType, controlId) {
    return (nodeType.controls ?? []).find((control) => control && control.id === controlId);
}

/** Static option values of a dropdown control. */
function optionValues(control) {
    return (control.options ?? []).map((option) => option.value);
}


describe('pin requirement declarations (all packages)', () => {
    for (const pkg of packageNames()) {
        const nodeTypes = loadNodeTypes(pkg);

        for (const [nodeTypeId, nodeType] of Object.entries(nodeTypes)) {
            const entries = pinEntries(nodeType);
            if (entries.length === 0) {
                continue;
            }

            it(`${pkg}/${nodeTypeId} declares resolvable pin requirements`, () => {
                for (const entry of entries) {
                    const where = `${pkg}/${nodeTypeId}/${entry.controlId}`;
                    const control = controlOf(nodeType, entry.controlId);

                    assert.ok(control, `${where}: controlId must name an existing control`);
                    assert.ok(
                        typeof entry.capability === 'string' && entry.capability.trim(),
                        `${where}: capability must be a non-empty string`
                    );
                    assert.ok(
                        pinCapabilityIds.has(entry.capability),
                        `${where}: '${entry.capability}' is not a registered pin capability`
                    );

                    const dynamicOptions = control.dynamicOptions;
                    if (dynamicOptions?.source === 'targetPinsForCapability') {
                        assert.equal(
                            dynamicOptions.capabilityKey,
                            entry.capability,
                            `${where}: capabilityKey must match the resourceUsage capability`
                        );
                    }

                    if (dynamicOptions?.allowNone === true) {
                        assert.equal(
                            entry.requiredWhen,
                            undefined,
                            `${where}: allowNone and requiredWhen are mutually exclusive`
                        );
                    }
                }
            });
        }
    }

    it('declares well-formed requiredWhen conditions', () => {
        for (const pkg of packageNames()) {
            const nodeTypes = loadNodeTypes(pkg);

            for (const [nodeTypeId, nodeType] of Object.entries(nodeTypes)) {
                for (const entry of pinEntries(nodeType)) {
                    if (entry.requiredWhen === undefined) {
                        continue;
                    }

                    const where = `${pkg}/${nodeTypeId}/${entry.controlId}`;
                    const condition = entry.requiredWhen;
                    const modeControl = controlOf(nodeType, condition.controlId);

                    assert.equal(
                        typeof condition.controlId,
                        'string',
                        `${where}: requiredWhen.controlId must be a string`
                    );
                    assert.ok(
                        condition.controlId.trim(),
                        `${where}: requiredWhen.controlId must not be empty`
                    );
                    assert.notEqual(
                        condition.controlId,
                        entry.controlId,
                        `${where}: a pin cannot make itself conditional`
                    );
                    assert.ok(
                        modeControl,
                        `${where}: requiredWhen.controlId must name a control of the same node`
                    );

                    const hasEquals = condition.equals !== undefined;
                    const hasIn = condition.in !== undefined;
                    assert.ok(
                        hasEquals !== hasIn,
                        `${where}: exactly one of requiredWhen.equals / requiredWhen.in is required`
                    );

                    let values;
                    if (hasEquals) {
                        assert.ok(
                            ['string', 'number', 'boolean'].includes(typeof condition.equals) ||
                                condition.equals === null,
                            `${where}: requiredWhen.equals must be a primitive or null`
                        );
                        values = [condition.equals];
                    } else {
                        assert.ok(
                            Array.isArray(condition.in) && condition.in.length > 0,
                            `${where}: requiredWhen.in must be a non-empty array`
                        );
                        values = condition.in;
                        for (const value of values) {
                            assert.ok(
                                ['string', 'number', 'boolean'].includes(typeof value),
                                `${where}: requiredWhen.in values must be primitives`
                            );
                        }
                    }

                    assert.equal(
                        modeControl.type,
                        'dropdown',
                        `${where}: requiredWhen.controlId must name a dropdown`
                    );
                    assert.ok(
                        Array.isArray(modeControl.options),
                        `${where}: requiredWhen control must declare static options`
                    );
                    const allowed = optionValues(modeControl);
                    for (const value of values) {
                        assert.ok(
                            allowed.includes(value),
                            `${where}: requiredWhen value '${String(value)}' is not an option of '${condition.controlId}'`
                        );
                    }
                }
            }
        }
    });

    it('leaves the optional i2s-output amplifier pins undeclared', () => {
        const output = loadNodeTypes('audio')['i2s-output'];
        const entries = pinEntries(output);

        assert.equal(entries.length, 3, 'i2s-output must declare exactly three pin entries');
        assert.equal(
            entries.some((entry) => entry.controlId === 'sdPin'),
            false,
            'sdPin is optional and must stay out of resourceUsage'
        );
        assert.equal(
            entries.some((entry) => entry.controlId === 'gainPin'),
            false,
            'gainPin is optional and must stay out of resourceUsage'
        );
    });

describe('NodeType resourceUsage deep copy', () => {
    /** Source definition carrying a conditional pin entry. */
    function definition() {
        return {
            type: 'copy.test',
            requiredCapabilities: ['viper'],
            controls: [
                { id: 'pin', type: 'dropdown' },
                { id: 'mode', type: 'dropdown', options: [{ value: 'a' }, { value: 'b' }] },
            ],
            resourceUsage: [
                {
                    kind: 'pin',
                    controlId: 'pin',
                    capability: 'dac',
                    requiredWhen: { controlId: 'mode', in: ['a', 'b'] },
                },
            ],
        };
    }

    it('does not alias the source condition in the constructor', () => {
        const source = definition();
        const nodeType = new NodeType(source, '');

        source.resourceUsage[0].capability = 'pwm.output';
        source.resourceUsage[0].requiredWhen.controlId = 'other';
        source.resourceUsage[0].requiredWhen.in.push('c');

        assert.equal(nodeType.resourceUsage[0].capability, 'dac');
        assert.deepEqual(nodeType.resourceUsage[0].requiredWhen, {
            controlId: 'mode',
            in: ['a', 'b'],
        });
    });

    it('does not alias the source condition in toDefinition()', () => {
        const nodeType = new NodeType(definition(), '');
        const serialized = nodeType.toDefinition();

        serialized.resourceUsage[0].capability = 'pwm.output';
        serialized.resourceUsage[0].requiredWhen.controlId = 'other';
        serialized.resourceUsage[0].requiredWhen.in.push('c');

        assert.equal(nodeType.resourceUsage[0].capability, 'dac');
        assert.deepEqual(nodeType.resourceUsage[0].requiredWhen, {
            controlId: 'mode',
            in: ['a', 'b'],
        });
    });
});

});
