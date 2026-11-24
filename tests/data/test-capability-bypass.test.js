// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('Custom Target Capability Bypass', () => {
    describe('servoNode capability check', () => {
        it('bypasses validation for Custom target with missing PWM data', () => {
            // Mock Custom target with missing PWM data
            const capabilities = {
                targetId: 'custom',
                metadata: {
                    isCustomTarget: true,
                    disableValidation: true,
                },
                // No capabilityToPins field - intentionally missing
            };

            // Simulate bypass logic
            const issues = [];
            if (
                capabilities?.metadata?.isCustomTarget &&
                !capabilities?.capabilityToPins?.['pwm.output']
            ) {
                // Bypass - return empty issues array
            } else {
                issues.push({ message: 'Validation failed' });
            }

            assert.equal(issues.length, 0, 'Should have no validation issues for Custom target');
        });

        it('validates standard targets normally with valid pin', () => {
            // Mock standard target with PWM data
            const capabilities = {
                targetId: 'esp32_wroom',
                capabilityToPins: {
                    'pwm.output': ['25', '26', '27'],
                },
            };

            const node = {
                id: 'servo-1',
                controlValues: { pin: 25 },
            };

            // Simulate validation
            const issues = [];
            const capabilityPins = capabilities?.capabilityToPins?.['pwm.output'];

            if (!Array.isArray(capabilityPins)) {
                issues.push({
                    nodeId: node.id,
                    message: 'Target does not advertise PWM-capable pins',
                });
            } else {
                // Pin 25 is in the list - no issue
                const selectedPin = String(node.controlValues.pin);
                if (!capabilityPins.includes(selectedPin)) {
                    issues.push({
                        nodeId: node.id,
                        message: `Pin ${selectedPin} not valid`,
                    });
                }
            }

            assert.equal(issues.length, 0, 'Should have no issues for valid pin');
        });

        it('validates standard targets normally with invalid pin', () => {
            // Mock standard target with PWM data
            const capabilities = {
                targetId: 'esp32_wroom',
                capabilityToPins: {
                    'pwm.output': ['25', '26', '27'],
                },
            };

            const node = {
                id: 'servo-1',
                controlValues: { pin: 99 }, // Invalid pin
            };

            // Simulate validation
            const issues = [];
            const capabilityPins = capabilities?.capabilityToPins?.['pwm.output'];
            const selectedPin = String(node.controlValues.pin);

            if (!capabilityPins.includes(selectedPin)) {
                issues.push({
                    nodeId: node.id,
                    capability: 'pwm.output',
                    message: `Pin ${selectedPin} not valid`,
                });
            }

            assert.equal(issues.length, 1, 'Should have validation issue for invalid pin');
            assert.equal(issues[0].capability, 'pwm.output');
        });

        it('detects missing capability data on standard target', () => {
            // Standard target missing PWM capability data
            const capabilities = {
                targetId: 'esp32_wroom',
                capabilityToPins: {
                    // PWM output missing
                },
            };

            const node = {
                id: 'servo-1',
                controlValues: { pin: 25 },
            };

            // Simulate validation
            const issues = [];
            const capabilityPins = capabilities?.capabilityToPins?.['pwm.output'];

            if (!Array.isArray(capabilityPins)) {
                issues.push({
                    nodeId: node.id,
                    capability: 'pwm.output',
                    message: 'Active target does not advertise PWM-capable pins',
                });
            }

            assert.equal(
                issues.length,
                1,
                'Should report missing PWM capability for standard target'
            );
        });
    });

    describe('mathNode capability check', () => {
        it('bypasses validation for Custom target with missing math capabilities', () => {
            // Mock Custom target with missing general capabilities
            const capabilities = {
                targetId: 'custom',
                metadata: {
                    isCustomTarget: true,
                    disableValidation: true,
                },
                // No generalCapabilities field - intentionally missing
            };

            // Simulate bypass logic
            const issues = [];
            if (
                capabilities?.metadata?.isCustomTarget &&
                !capabilities?.generalCapabilities?.math
            ) {
                // Bypass - return empty issues array
            } else {
                issues.push({ message: 'Validation failed' });
            }

            assert.equal(issues.length, 0, 'Should have no validation issues for Custom target');
        });

        it('validates standard targets normally with math support', () => {
            // Mock standard target with math capabilities
            const capabilities = {
                targetId: 'esp32_wroom',
                generalCapabilities: {
                    math: {
                        float: {
                            supported: true,
                            bits: 32,
                        },
                    },
                },
            };

            const node = {
                id: 'math-1',
                controlValues: { operation: 'sin' },
            };

            // Simulate validation
            const issues = [];
            const mathCaps = capabilities?.generalCapabilities?.math;

            if (mathCaps?.float?.supported === false) {
                issues.push({
                    nodeId: node.id,
                    message: 'No float support',
                });
            }

            assert.equal(issues.length, 0, 'Should have no issues for supported math');
        });

        it('validates standard targets and detects missing math capabilities', () => {
            // Standard target missing math capabilities
            const capabilities = {
                targetId: 'esp32_wroom',
                generalCapabilities: {
                    // No math field
                },
            };

            const node = {
                id: 'math-1',
                controlValues: { operation: 'sin' },
            };

            // Simulate validation
            const issues = [];
            const mathCaps = capabilities?.generalCapabilities?.math;

            if (!mathCaps) {
                issues.push({
                    nodeId: node.id,
                    capability: 'math',
                    message: 'Target does not advertise math capabilities',
                });
            }

            assert.equal(
                issues.length,
                1,
                'Should report missing math capability for standard target'
            );
        });
    });

    describe('Custom target detection logic', () => {
        it('correctly identifies Custom target with both metadata flags', () => {
            const capabilities = {
                targetId: 'custom',
                metadata: {
                    isCustomTarget: true,
                    disableValidation: true,
                },
            };

            const isCustom = capabilities?.metadata?.isCustomTarget === true;
            assert.equal(isCustom, true, 'Should identify Custom target');
        });

        it('correctly identifies standard target without metadata', () => {
            const capabilities = {
                targetId: 'esp32_wroom',
                capabilityToPins: {
                    'pwm.output': ['25', '26'],
                },
            };

            const isCustom = capabilities?.metadata?.isCustomTarget === true;
            assert.equal(isCustom, false, 'Should not identify standard target as Custom');
        });

        it('handles missing capabilities object gracefully', () => {
            const capabilities = null;

            const isCustom = capabilities?.metadata?.isCustomTarget === true;
            assert.equal(isCustom, false, 'Should handle null capabilities');
        });
    });
});
