// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
    normalizeSerialPorts,
    fetchSerialPorts,
    serialPortOptions,
} from '../../src/micro_otter/nodes/html/js/serial/serial-ports.js';

describe('serial-ports client helper', () => {
    afterEach(() => {
        global.fetch = undefined;
    });

    describe('normalizeSerialPorts', () => {
        it('keeps only entries with a non-empty string device', () => {
            const ports = normalizeSerialPorts([
                { device: '/dev/ttyUSB0', label: 'usb-Espressif', display: 'Espressif (usb, /dev/ttyUSB0)' },
                { device: '', label: 'ghost', display: 'ghost' },
                { label: 'no-device' },
                'not-an-object',
                null,
            ]);

            assert.deepEqual(ports, [
                {
                    device: '/dev/ttyUSB0',
                    label: 'usb-Espressif',
                    display: 'Espressif (usb, /dev/ttyUSB0)',
                },
            ]);
        });

        it('coerces non-string label/display to null', () => {
            const ports = normalizeSerialPorts([
                { device: '/dev/ttyUSB0', label: 42, display: true },
            ]);

            assert.deepEqual(ports, [
                { device: '/dev/ttyUSB0', label: null, display: null },
            ]);
        });

        it('returns an empty list for a non-array payload', () => {
            assert.deepEqual(normalizeSerialPorts({ device: '/dev/ttyUSB0' }), []);
            assert.deepEqual(normalizeSerialPorts('nope'), []);
            assert.deepEqual(normalizeSerialPorts(null), []);
        });
    });

    describe('fetchSerialPorts', () => {
        it('returns the normalized ports on success', async () => {
            global.fetch = async () => ({
                ok: true,
                json: async () => [{ device: '/dev/ttyUSB0', label: null, display: '/dev/ttyUSB0' }],
            });

            const ports = await fetchSerialPorts();

            assert.deepEqual(ports, [
                { device: '/dev/ttyUSB0', label: null, display: '/dev/ttyUSB0' },
            ]);
        });

        it('throws when the response is not ok', async () => {
            global.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });

            await assert.rejects(() => fetchSerialPorts(), /HTTP 500/);
        });

        it('throws when fetch fails', async () => {
            global.fetch = async () => {
                throw new Error('network unavailable');
            };

            await assert.rejects(() => fetchSerialPorts(), /network unavailable/);
        });
    });

    describe('serialPortOptions', () => {
        it('prefers display, then label, then device', () => {
            const options = serialPortOptions([
                {
                    device: '/dev/ttyUSB0',
                    label: 'usb-Espressif',
                    display: 'Espressif (usb, /dev/ttyUSB0)',
                },
                { device: '/dev/ttyUSB1', label: 'USB1', display: null },
                { device: '/dev/ttyUSB2', label: null, display: null },
            ]);

            assert.deepEqual(options, [
                { value: '/dev/ttyUSB0', label: 'Espressif (usb, /dev/ttyUSB0)' },
                { value: '/dev/ttyUSB1', label: 'USB1' },
                { value: '/dev/ttyUSB2', label: '/dev/ttyUSB2' },
            ]);
        });
    });
});
