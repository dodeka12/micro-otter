// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

(function () {
    const globalScope =
        typeof window !== 'undefined' ? window : typeof self !== 'undefined' ? self : globalThis;
    if (!globalScope.NodeCapabilityChecks) {
        globalScope.NodeCapabilityChecks = {};
    }

    // Math node checks: ensure target math capability and guard invalid sqrt defaults.
    globalScope.NodeCapabilityChecks.mathNode = function ({ nodeData, deviceTarget }) {
        const node = nodeData;

        // Check if this is the Custom target with missing general capabilities
        if (deviceTarget?.metadata?.isCustomTarget && !deviceTarget?.generalCapabilities?.math) {
            // Custom target: bypass validation
            return [];
        }

        const issues = [];

        const mathCaps = deviceTarget?.generalCapabilities?.math || null;
        const hasLegacyMath = Array.isArray(deviceTarget?.getPinsForCapability?.('math'));

        if (mathCaps) {
            if (mathCaps.float?.supported === false) {
                issues.push({
                    nodeId: node?.id ?? null,
                    capability: 'math.float',
                    message:
                        'Target reports no floating point support; math node operations may be invalid.',
                });
            }
            const floatBits = mathCaps.float?.bits;
            if (typeof floatBits === 'number' && floatBits < 32) {
                issues.push({
                    nodeId: node?.id ?? null,
                    capability: 'math.float',
                    message: `Target float precision is ${floatBits} bits; math node expects at least 32-bit floats.`,
                });
            }
        } else if (!hasLegacyMath) {
            issues.push({
                nodeId: node?.id ?? null,
                capability: 'math',
                message:
                    'Active target does not advertise math capabilities (generalCapabilities.math missing).',
            });
        }

        const operation = node?.controlValues?.operation;
        if (operation === 'sqrt') {
            const defaults = node?.inputDefaults || {};
            const defaultVal = defaults.in0 ?? defaults['input_0'];
            if (typeof defaultVal === 'number' && defaultVal < 0) {
                issues.push({
                    nodeId: node?.id ?? null,
                    capability: null,
                    message:
                        'Square root on a negative default input is invalid. Set a non-negative default or change the operation.',
                });
            }
        }

        return issues;
    };

    // Digital input: pin membership is validated via resourceUsage (digital.input);
    // this bespoke check validates the optional pull-resistor selection.
    globalScope.NodeCapabilityChecks.digitalInput = function ({ nodeData, deviceTarget }) {
        const node = nodeData;
        const issues = [];
        if (!node || !deviceTarget || typeof deviceTarget.hasPinCapability !== 'function') {
            return issues;
        }

        const controls = node.controlValues || {};
        const pin = controls.pin;
        const pull = controls.pull;

        if (pull === 'up' && !deviceTarget.hasPinCapability(pin, 'pull.up')) {
            issues.push({
                nodeId: node.id ?? null,
                capability: 'pull.up',
                message: `Selected pin ${pin} does not support pull-up.`,
            });
        } else if (pull === 'down' && !deviceTarget.hasPinCapability(pin, 'pull.down')) {
            issues.push({
                nodeId: node.id ?? null,
                capability: 'pull.down',
                message: `Selected pin ${pin} does not support pull-down.`,
            });
        }

        return issues;
    };
})();
