// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

(function () {
    const globalScope =
        typeof window !== 'undefined' ? window : typeof self !== 'undefined' ? self : globalThis;
    if (!globalScope.NodeCapabilityChecks) {
        globalScope.NodeCapabilityChecks = {};
    }

    /**
     * Validates that the selected pin for the servo node supports PWM on the active target.
     * Expects the target capabilities map to expose pins -> capabilities via capabilityToPins.
     */
    globalScope.NodeCapabilityChecks.servoNode = function ({ nodeData, deviceTarget }) {
        const node = nodeData;

        // Check if this is the Custom target with missing PWM data
        if (
            deviceTarget?.metadata?.isCustomTarget &&
            !deviceTarget?.getPinsForCapability?.('pwm.output')
        ) {
            // Custom target: bypass validation
            return [];
        }

        const issues = [];
        const pinValue = node?.controlValues?.pin;
        if (pinValue === undefined || pinValue === null) {
            return issues;
        }

        if (!deviceTarget?.hasPinCapability?.(pinValue, 'pwm.output')) {
            issues.push({
                nodeId: node?.id ?? null,
                scope: 'control',
                controlId: 'pin',
                capability: 'pwm.output',
                message: `Pin ${String(pinValue)} does not support PWM on the active target.`,
            });
        }

        return issues;
    };
})();
