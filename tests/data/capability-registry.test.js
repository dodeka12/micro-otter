import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    CapabilityRegistry,
    normalizeGenericPeripheral,
} from '../../src/micro_otter/nodes/html/js/data/capability-registry.js';

describe('CapabilityRegistry', () => {
    it('registers built-in capabilities at construction', () => {
        const registry = new CapabilityRegistry();

        assert.equal(registry.has('pwm'), true);
        assert.equal(registry.has('adc'), true);
        assert.equal(registry.has('i2s'), true);
        assert.ok(registry.get('pwm').derivedKeys.includes('pwm.output'));
        assert.ok(registry.getAll().length >= 10);
    });

    it('registers general capabilities with a domain and glyph', () => {
        const registry = new CapabilityRegistry();

        const viper = registry.get('viper');
        assert.ok(viper, 'viper should be registered');
        assert.equal(viper.domain, 'general');
        assert.equal(viper.glyph, 'V');
        assert.equal(viper.check.kind, 'membership');

        const math = registry.get('math');
        assert.ok(math, 'math should be registered');
        assert.equal(math.domain, 'general');
        assert.equal(math.icon, 'calculate');

        const ethernet = registry.get('ethernet');
        assert.ok(ethernet, 'ethernet should be registered');
        assert.equal(ethernet.domain, 'general');
        assert.equal(ethernet.glyph, 'E');

        assert.equal(registry.getDomain('viper'), 'general');
        assert.equal(registry.getDomain('math'), 'general');
        assert.equal(registry.getDomain('ethernet'), 'general');
        assert.equal(registry.getDomain('pwm'), 'pin');
        assert.equal(registry.getDomain('unknown'), 'pin');
    });

    it('returns null for unknown capability ids', () => {
        const registry = new CapabilityRegistry();

        assert.equal(registry.get('can'), null);
        assert.equal(registry.has('can'), false);
    });

    it('registers the derived irq pin capability', () => {
        const registry = new CapabilityRegistry();

        const irq = registry.get('irq');
        assert.ok(irq, 'irq should be registered');
        assert.equal(registry.getDomain('irq'), 'pin');
        assert.equal(irq.icon, 'irq');
        assert.equal(irq.limitKey, null);
        assert.deepEqual(irq.derivedKeys, ['irq']);
        assert.equal(irq.check.kind, 'membership');
    });

    it('rejects duplicate ids', () => {
        const registry = new CapabilityRegistry();

        assert.throws(
            () =>
                registry.register({
                    id: 'pwm',
                    derivedKeys: ['pwm.output'],
                    icon: null,
                    limitKey: null,
                    check: { kind: 'membership' },
                }),
            /already registered/
        );
    });

    it('rejects malformed descriptors', () => {
        const registry = new CapabilityRegistry();

        assert.throws(() => registry.register(null), /must be an object/);
        assert.throws(
            () => registry.register({ id: '', derivedKeys: ['x'], icon: null, limitKey: null }),
            /non-empty string id/
        );
        assert.throws(
            () =>
                registry.register({
                    id: 'can',
                    derivedKeys: [],
                    icon: null,
                    limitKey: null,
                    check: { kind: 'membership' },
                }),
            /non-empty derivedKeys/
        );
    });

    it('registers a new capability with a count strategy', () => {
        const registry = new CapabilityRegistry();

        registry.register({
            id: 'can',
            derivedKeys: ['can', 'can.tx', 'can.rx'],
            icon: 'can',
            limitKey: 'can.controllers',
            check: { kind: 'count', limitKey: 'can.controllers' },
        });

        const descriptor = registry.get('can');
        assert.equal(descriptor.limitKey, 'can.controllers');
        assert.equal(descriptor.check.kind, 'count');
    });

    it('discriminates check strategies via kind', () => {
        const registry = new CapabilityRegistry();

        const label = (check) => {
            switch (check.kind) {
                case 'membership':
                    return 'membership';
                case 'count':
                    return check.limitKey;
                case 'constraint':
                    return 'constraint';
                default:
                    return 'unknown';
            }
        };

        assert.equal(label({ kind: 'membership' }), 'membership');
        assert.equal(label({ kind: 'count', limitKey: 'pwm.channels' }), 'pwm.channels');
        assert.equal(label({ kind: 'constraint', rule: {} }), 'constraint');
        assert.equal(registry.get('pwm').check.kind, 'membership');
    });
});

describe('normalizeGenericPeripheral', () => {
    it('extracts known fields and drops junk', () => {
        assert.deepEqual(normalizeGenericPeripheral({ bus: 'can0', role: 'rx', junk: true }), {
            bus: 'can0',
            role: 'rx',
        });
    });

    it('returns null for empty or invalid payloads', () => {
        assert.equal(normalizeGenericPeripheral(null), null);
        assert.equal(normalizeGenericPeripheral({}), null);
        assert.equal(normalizeGenericPeripheral([]), null);
    });
});
