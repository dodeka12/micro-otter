import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import {
    TargetConfigView,
    formatCapabilityRecord,
    getPinCapabilityIconSpecs,
} from '../../src/micro_otter/nodes/html/js/views/target-config-view.js';
import { DeviceTargetInfo } from '../../src/micro_otter/nodes/html/js/data/device-target.js';
import { IconProvider } from '../../src/micro_otter/nodes/html/js/views/icon-provider.js';

function flush() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('TargetConfigView', () => {
    let dom;
    let container;

    beforeEach(() => {
        dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
            url: 'http://localhost',
        });

        global.window = dom.window;
        global.document = dom.window.document;
        global.HTMLElement = dom.window.HTMLElement;
        global.Node = dom.window.Node;
        global.EventTarget = dom.window.EventTarget;
        global.CustomEvent = dom.window.CustomEvent;

        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        global.window = undefined;
        global.document = undefined;
        global.HTMLElement = undefined;
        global.Node = undefined;
        global.EventTarget = undefined;
        global.CustomEvent = undefined;
        dom.window.close();
    });

    it('renders general capabilities and per-pin table for runtime target', async () => {
        const target = new DeviceTargetInfo({
            id: 'esp32',
            generalCapabilities: {
                math: {
                    float: {
                        supported: true,
                        bits: 32,
                        hardware: true,
                    },
                },
                wifi: { supported: true },
                bluetooth: { supported: true },
                notes: ['line one', 'line two'],
            },
            capabilityToPins: {
                'pwm.output': [5, 6],
                'digital.output': [5, 6, 7],
            },
            pinCapabilities: {
                5: { label: 'GPIO5', pwm: { output: true }, digital: { output: true } },
                6: { label: 'GPIO6', pwm: { output: true }, digital: { output: true } },
                7: { label: 'GPIO7', digital: { output: true } },
            },
        });

        const collection = {
            getTargetId: () => 'esp32',
            getDeviceRuntimeId: () => 'general',
            on: () => () => {},
        };

        const view = new TargetConfigView({
            workspace: {
                runtimeCollection: {
                    getRuntime: () => ({
                        getDeviceTarget: () => target,
                    }),
                },
                getUserTargetConfig: async () => null,
            },
            collectionManager: {
                getActiveCollection: () => collection,
                on: () => () => {},
            },
        });

        view.attachTo(container);
        await flush();
        await flush();

        assert.ok(container.querySelector('.target-config-view__general-list'));
        const generalStatusIcons = Array.from(
            container.querySelectorAll('.target-config-view__general-status-icon')
        );
        assert.equal(generalStatusIcons.length, 2);
        assert.equal(container.querySelectorAll('.target-config-view__general-status-label').length, 0);
        assert.ok(
            generalStatusIcons.some((icon) => icon.getAttribute('src') === IconProvider.get('wifi'))
        );
        assert.ok(
            generalStatusIcons.some(
                (icon) => icon.getAttribute('src') === IconProvider.get('bluetooth')
            )
        );
        const mathKeyIcon = container.querySelector('.target-config-view__general-key-icon');
        assert.ok(mathKeyIcon);
        assert.equal(mathKeyIcon.getAttribute('src'), IconProvider.get('calculate'));
        assert.ok(
            generalStatusIcons.some(
                (icon) =>
                    icon.classList.contains('target-config-view__general-status-icon--wifi') &&
                    icon.classList.contains('target-config-view__general-status-icon--on')
            )
        );
        assert.ok(
            generalStatusIcons.some(
                (icon) =>
                    icon.classList.contains('target-config-view__general-status-icon--bluetooth') &&
                    icon.classList.contains('target-config-view__general-status-icon--on')
            )
        );
        assert.ok(container.textContent.includes('float, 32, hw'));
        const notesField = container.querySelector('.target-config-view__general-notes');
        assert.ok(notesField);
        assert.equal(notesField.value, 'line one\nline two');
        assert.ok(container.querySelector('.target-config-view__per-pin-table'));
        assert.ok(container.querySelector('.target-config-view__capability-table'));
    });

    it('renders general capabilities with glyph badges from the registry', async () => {
        const target = new DeviceTargetInfo({
            id: 'esp32',
            generalCapabilities: {
                math: {
                    float: { supported: true, bits: 32, hardware: true },
                },
                viper: { supported: true },
                wifi: { supported: true },
            },
            capabilityToPins: {},
        });

        const collection = {
            getTargetId: () => 'esp32',
            getDeviceRuntimeId: () => 'general',
            on: () => () => {},
        };

        const view = new TargetConfigView({
            workspace: {
                runtimeCollection: {
                    getRuntime: () => ({
                        getDeviceTarget: () => target,
                    }),
                },
                getUserTargetConfig: async () => null,
            },
            collectionManager: {
                getActiveCollection: () => collection,
                on: () => () => {},
            },
        });

        view.attachTo(container);
        await flush();
        await flush();

        const glyph = container.querySelector('.target-config-view__general-key-glyph');
        assert.ok(glyph, 'expected a glyph badge');
        assert.equal(glyph.textContent, 'V');
        assert.equal(glyph.getAttribute('title'), 'viper');

        const mathIcon = container.querySelector('.target-config-view__general-key-icon');
        assert.ok(mathIcon, 'expected the math icon');
        assert.equal(mathIcon.getAttribute('src'), IconProvider.get('calculate'));

        assert.ok(container.textContent.includes('supported: yes'), 'expected supported value');
    });

    it('renders topic groups as collapsible sections with the legend folded by default', async () => {
        const target = new DeviceTargetInfo({
            id: 'esp32',
            capabilityToPins: {
                'pwm.output': [5, 6],
            },
            pinCapabilities: {
                5: { label: 'GPIO5', pwm: { output: true } },
                6: { label: 'GPIO6', pwm: { output: true } },
            },
        });

        const collection = {
            getTargetId: () => 'esp32',
            getDeviceRuntimeId: () => 'general',
            on: () => () => {},
        };

        const view = new TargetConfigView({
            workspace: {
                runtimeCollection: {
                    getRuntime: () => ({
                        getDeviceTarget: () => target,
                    }),
                },
                getUserTargetConfig: async () => null,
            },
            collectionManager: {
                getActiveCollection: () => collection,
                on: () => () => {},
            },
        });

        view.attachTo(container);
        await flush();
        await flush();

        // Five topic groups are collapsible panes.
        const groups = container.querySelectorAll('.collapsible-view');
        assert.equal(groups.length, 5);

        // The panes inherit the shared 28px header default from CollapsibleView.
        const headers = container.querySelectorAll('.collapsible-view__header');
        assert.equal(headers.length, 5);
        for (const header of headers) {
            assert.equal(header.style.height, '28px');
        }

        // Both pin table modes are always present now.
        assert.ok(container.querySelector('.target-config-view__per-pin-table'));
        assert.ok(container.querySelector('.target-config-view__capability-table'));

        // The icon legend group is collapsed by default.
        const legend = container.querySelector('.collapsible-view.is-collapsed');
        assert.ok(legend);
        assert.equal(
            legend.querySelector('.collapsible-view__title').textContent,
            'Pin Capability Icon Legend'
        );
        assert.equal(legend.querySelector('.collapsible-view__content').style.display, 'none');
    });

    it('explains the derived irq capability in the icon legend without adding a pin badge', async () => {
        const target = new DeviceTargetInfo({
            id: 'esp32',
            pinCapabilities: {
                5: { label: 'GPIO5', digital: { input: true, output: false } },
            },
        });

        const collection = {
            getTargetId: () => 'esp32',
            getDeviceRuntimeId: () => 'general',
            on: () => () => {},
        };

        const view = new TargetConfigView({
            workspace: {
                runtimeCollection: {
                    getRuntime: () => ({
                        getDeviceTarget: () => target,
                    }),
                },
                getUserTargetConfig: async () => null,
            },
            collectionManager: {
                getActiveCollection: () => collection,
                on: () => () => {},
            },
        });

        view.attachTo(container);
        await flush();
        await flush();

        const legendRows = Array.from(
            container.querySelectorAll('.target-config-view__icon-legend-table tbody tr')
        );
        const irqRow = legendRows.find(
            (row) => row.children[1]?.textContent === 'Interrupt (IRQ)'
        );
        assert.ok(irqRow, 'expected an Interrupt (IRQ) legend row');

        const irqIcon = irqRow.querySelector('img');
        assert.equal(irqIcon.getAttribute('src'), IconProvider.irq);
        assert.ok(
            irqIcon.classList.contains('target-config-view__capability-icon--digital'),
            'the irq legend entry reuses the digital family style'
        );
        assert.equal(
            irqRow.children[2].textContent,
            'Pin can raise a hardware interrupt on an edge or level'
        );

        const pin = target.getPinCapability(5);
        assert.ok(pin);
        assert.deepEqual(
            getPinCapabilityIconSpecs(target, pin).map((spec) => spec.key),
            ['digital.input']
        );
    });

    it('falls back to user target config when runtime target is missing', async () => {
        const collection = {
            getTargetId: () => 'custom-alpha',
            getDeviceRuntimeId: () => 'general',
            on: () => () => {},
        };

        const view = new TargetConfigView({
            workspace: {
                runtimeCollection: {
                    getRuntime: () => ({
                        getDeviceTarget: () => null,
                    }),
                },
                getUserTargetConfig: async (id) => {
                    if (id !== 'custom-alpha') {
                        return null;
                    }
                    return {
                        targetData: {
                            id: 'custom-alpha',
                            generalCapabilities: { math: { float: { supported: true } } },
                            capabilityToPins: { 'pwm.output': [15] },
                            pinCapabilities: {
                                15: { label: 'GPIO15', pwm: { output: true } },
                            },
                        },
                    };
                },
            },
            collectionManager: {
                getActiveCollection: () => collection,
                on: () => () => {},
            },
        });

        view.attachTo(container);
        await flush();
        await flush();

        assert.ok(container.querySelector('.target-config-view__per-pin-table'));
        assert.ok(!container.textContent.includes('No target configuration selected.'));
    });

    it('renders math notes in notes field instead of inline math text', async () => {
        const target = new DeviceTargetInfo({
            id: 'esp32',
            generalCapabilities: {
                math: {
                    double: { supported: true, bits: 64 },
                    float: { supported: true, bits: 32, hardware: true },
                    integer: true,
                    notes: ['hardware float', 'double is emulated'],
                },
                wifi: { supported: true },
                bluetooth: { supported: false },
            },
            pinCapabilities: {
                1: { label: 'GPIO1', digital: { input: true } },
            },
        });

        const collection = {
            getTargetId: () => 'esp32',
            getDeviceRuntimeId: () => 'general',
            on: () => () => {},
        };

        const view = new TargetConfigView({
            workspace: {
                runtimeCollection: {
                    getRuntime: () => ({
                        getDeviceTarget: () => target,
                    }),
                },
                getUserTargetConfig: async () => null,
            },
            collectionManager: {
                getActiveCollection: () => collection,
                on: () => () => {},
            },
        });

        view.attachTo(container);
        await flush();
        await flush();

        assert.ok(container.textContent.includes('double, 64 · float, 32, hw · integer'));
        assert.ok(!container.textContent.includes('notes: ['));

        const notesField = container.querySelector('.target-config-view__general-notes');
        assert.ok(notesField);
        assert.equal(notesField.value, 'hardware float\ndouble is emulated');
    });

    it('returns combined and directional icon specs for per-pin capabilities', () => {
        const target = new DeviceTargetInfo({
            id: 'esp32',
            capabilityToPins: {
                'pwm.input': [5],
                'digital.input': [5],
                'digital.output': [5],
                'pull.up': [5],
                'pull.down': [5],
                'pwm.output': [5],
                'adc': [5],
                'spi.out': [5],
                'i2c.in': [5],
            },
            pinCapabilities: {
                5: {
                    label: 'GPIO5',
                    digital: { input: true, output: true },
                    pull: ['up', 'down'],
                    pwm: { output: true },
                    adc: { channel: 0 },
                    spi: { roles: ['out'] },
                    i2c: { roles: ['in'] },
                },
            },
        });

        const pin = target.getPinCapability(5);
        assert.ok(pin);

        const iconSpecs = getPinCapabilityIconSpecs(target, pin);
        assert.deepEqual(
            iconSpecs.map((spec) => spec.key),
            ['pwm.inout', 'digital.inout', 'pull.up_down', 'adc', 'spi.mosi', 'i2c.sda']
        );
    });

    it('renders per-pin capability icons with color classes and tooltips', async () => {
        const target = new DeviceTargetInfo({
            id: 'esp32',
            capabilityToPins: {
                'pwm.input': [6],
                'digital.input': [6],
                'digital.output': [6],
                'pull.up': [6],
                'pull.down': [6],
                adc: [6],
            },
            pinCapabilities: {
                6: {
                    label: 'GPIO6',
                    pwm: { input: true },
                    digital: { input: true, output: true },
                    pull: ['up', 'down'],
                    adc: { channel: 3 },
                },
            },
        });

        const collection = {
            getTargetId: () => 'esp32',
            getDeviceRuntimeId: () => 'general',
            on: () => () => {},
        };

        const view = new TargetConfigView({
            workspace: {
                runtimeCollection: {
                    getRuntime: () => ({
                        getDeviceTarget: () => target,
                    }),
                },
                getUserTargetConfig: async () => null,
            },
            collectionManager: {
                getActiveCollection: () => collection,
                on: () => () => {},
            },
        });

        view.attachTo(container);
        await flush();
        await flush();

        const capabilityIcons = Array.from(container.querySelectorAll('.target-config-view__capability-icon'));
        assert.ok(capabilityIcons.length >= 4);

        assert.ok(
            capabilityIcons.some(
                (icon) =>
                    icon.classList.contains('target-config-view__capability-icon--digital') &&
                    icon.getAttribute('title') === 'Digital Input + Output'
            )
        );
        assert.ok(
            capabilityIcons.some(
                (icon) =>
                    icon.classList.contains('target-config-view__capability-icon--pull') &&
                    icon.getAttribute('title') === 'Pull Up + Pull Down'
            )
        );
        assert.ok(
            capabilityIcons.some(
                (icon) =>
                    icon.classList.contains('target-config-view__capability-icon--pwm') &&
                    icon.getAttribute('title') === 'PWM Input'
            )
        );
    });

    it('falls back to SPI/I2C role metadata for icon direction when mapping is missing', () => {
        const target = new DeviceTargetInfo({
            id: 'esp32',
            capabilityToPins: {},
            pinCapabilities: {
                12: {
                    label: 'GPIO12',
                    spi: { roles: ['miso'] },
                    i2c: { roles: ['out'] },
                },
            },
        });

        const pin = target.getPinCapability(12);
        assert.ok(pin);

        const iconSpecs = getPinCapabilityIconSpecs(target, pin);
        assert.deepEqual(
            iconSpecs.map((spec) => spec.key),
            ['spi.miso', 'i2c.scl']
        );
    });

    it('maps i2c sda/scl roles to dedicated icons', () => {
        const target = new DeviceTargetInfo({
            id: 'esp32-wroom',
            capabilityToPins: {},
            pinCapabilities: {
                21: {
                    label: 'GPIO21',
                    i2c: { roles: ['sda'] },
                },
                22: {
                    label: 'GPIO22',
                    i2c: { roles: ['scl'] },
                },
            },
        });

        const sdaPin = target.getPinCapability(21);
        const sclPin = target.getPinCapability(22);
        assert.ok(sdaPin);
        assert.ok(sclPin);

        const sdaIcons = getPinCapabilityIconSpecs(target, sdaPin);
        const sclIcons = getPinCapabilityIconSpecs(target, sclPin);

        assert.deepEqual(sdaIcons.map((spec) => spec.key), ['i2c.sda']);
        assert.deepEqual(sclIcons.map((spec) => spec.key), ['i2c.scl']);
    });

    it('maps spi mosi/miso/sck/cs roles to dedicated icons', () => {
        const target = new DeviceTargetInfo({
            id: 'esp32-wroom',
            capabilityToPins: {},
            pinCapabilities: {
                18: { label: 'GPIO18', spi: { roles: ['sck'] } },
                19: { label: 'GPIO19', spi: { roles: ['miso'] } },
                23: { label: 'GPIO23', spi: { roles: ['mosi'] } },
                5: { label: 'GPIO5', spi: { roles: ['cs'] } },
            },
        });

        const sckPin = target.getPinCapability(18);
        const misoPin = target.getPinCapability(19);
        const mosiPin = target.getPinCapability(23);
        const csPin = target.getPinCapability(5);

        assert.ok(sckPin);
        assert.ok(misoPin);
        assert.ok(mosiPin);
        assert.ok(csPin);

        assert.deepEqual(getPinCapabilityIconSpecs(target, sckPin).map((spec) => spec.key), ['spi.sck']);
        assert.deepEqual(
            getPinCapabilityIconSpecs(target, misoPin).map((spec) => spec.key),
            ['spi.miso']
        );
        assert.deepEqual(
            getPinCapabilityIconSpecs(target, mosiPin).map((spec) => spec.key),
            ['spi.mosi']
        );
        assert.deepEqual(getPinCapabilityIconSpecs(target, csPin).map((spec) => spec.key), ['spi.cs']);
    });

    it('maps uart rx/tx roles to serial in/out icons on matching pins', () => {
        const target = new DeviceTargetInfo({
            id: 'esp32-wroom',
            capabilityToPins: {},
            pinCapabilities: {
                1: {
                    label: 'GPIO1',
                    uart: { roles: ['tx'], port: 'uart0' },
                },
                3: {
                    label: 'GPIO3',
                    uart: { roles: ['rx'], port: 'uart0' },
                },
            },
        });

        const txPin = target.getPinCapability(1);
        const rxPin = target.getPinCapability(3);
        assert.ok(txPin);
        assert.ok(rxPin);

        const txIcons = getPinCapabilityIconSpecs(target, txPin);
        const rxIcons = getPinCapabilityIconSpecs(target, rxPin);

        assert.deepEqual(txIcons.map((spec) => spec.key), ['serial.output']);
        assert.deepEqual(rxIcons.map((spec) => spec.key), ['serial.input']);
    });

    it('maps i2s, touch, dac and rtc capabilities to icon specs', () => {
        const target = new DeviceTargetInfo({
            id: 'esp32-s3',
            pinCapabilities: {
                4: { i2s: { controller: 0, roles: ['bclk'] } },
                2: { touch: { channel: 2 } },
                25: { dac: { channel: 1 } },
                3: { rtc: { gpio: true } },
            },
        });

        const i2sIcons = getPinCapabilityIconSpecs(target, target.getPinCapability(4));
        const touchIcons = getPinCapabilityIconSpecs(target, target.getPinCapability(2));
        const dacIcons = getPinCapabilityIconSpecs(target, target.getPinCapability(25));
        const rtcIcons = getPinCapabilityIconSpecs(target, target.getPinCapability(3));

        assert.deepEqual(i2sIcons.map((spec) => spec.key), ['i2s.bclk']);
        assert.deepEqual(touchIcons.map((spec) => spec.key), ['touch']);
        assert.deepEqual(dacIcons.map((spec) => spec.key), ['dac']);
        assert.deepEqual(rtcIcons.map((spec) => spec.key), ['rtc']);
    });

    it('collapses a full protocol role set into a single general icon', () => {
        const target = new DeviceTargetInfo({
            id: 'esp32-s3',
            pinCapabilities: {
                4: { i2s: { controller: 0, roles: ['bclk', 'ws', 'din', 'dout'] } },
                5: { uart: { port: 'uart0', roles: ['tx', 'rx'] } },
                6: { i2c: { bus: 'i2c0', roles: ['sda', 'scl'] } },
                7: { spi: { bus: 'spi0', roles: ['cs', 'sck', 'mosi', 'miso'] } },
            },
        });

        assert.deepEqual(
            getPinCapabilityIconSpecs(target, target.getPinCapability(4)).map((spec) => spec.key),
            ['i2s']
        );
        assert.deepEqual(
            getPinCapabilityIconSpecs(target, target.getPinCapability(5)).map((spec) => spec.key),
            ['serial']
        );
        assert.deepEqual(
            getPinCapabilityIconSpecs(target, target.getPinCapability(6)).map((spec) => spec.key),
            ['i2c']
        );
        assert.deepEqual(
            getPinCapabilityIconSpecs(target, target.getPinCapability(7)).map((spec) => spec.key),
            ['spi']
        );
    });

    it('lists every role explicitly when a protocol is only partially supported', () => {
        const target = new DeviceTargetInfo({
            id: 'esp32-s3',
            pinCapabilities: {
                4: { i2s: { controller: 0, roles: ['bclk', 'ws'] } },
                5: { spi: { bus: 'spi0', roles: ['mosi', 'miso'] } },
            },
        });

        assert.deepEqual(
            getPinCapabilityIconSpecs(target, target.getPinCapability(4)).map((spec) => spec.key),
            ['i2s.bclk', 'i2s.ws']
        );
        assert.deepEqual(
            getPinCapabilityIconSpecs(target, target.getPinCapability(5)).map((spec) => spec.key),
            ['spi.mosi', 'spi.miso']
        );
    });

    it('shows a general I2S icon plus an explicit mclk icon for the full role set', () => {
        const target = new DeviceTargetInfo({
            id: 'esp32-s3',
            pinCapabilities: {
                4: { i2s: { controller: 0, roles: ['bclk', 'ws', 'din', 'dout', 'mclk'] } },
            },
        });

        assert.deepEqual(
            getPinCapabilityIconSpecs(target, target.getPinCapability(4)).map((spec) => spec.key),
            ['i2s', 'i2s.mclk']
        );
    });

    it('renders reserved/strapping badges and hardware resources', async () => {
        const target = new DeviceTargetInfo({
            id: 'esp32-s3',
            resources: {
                pwm: { channels: 8, timers: 4 },
                i2s: { controllers: 2 },
            },
            pinCapabilities: {
                0: { label: 'GPIO0', strapping: { role: 'boot', safeLevel: 'high' } },
                26: { label: 'GPIO26', reserved: { reason: 'psram' } },
            },
        });

        const collection = {
            getTargetId: () => 'esp32-s3',
            getDeviceRuntimeId: () => 'general',
            on: () => () => {},
        };

        const view = new TargetConfigView({
            workspace: {
                runtimeCollection: {
                    getRuntime: () => ({ getDeviceTarget: () => target }),
                },
                getUserTargetConfig: async () => null,
            },
            collectionManager: {
                getActiveCollection: () => collection,
                on: () => () => {},
            },
        });

        view.attachTo(container);
        await flush();
        await flush();

        assert.ok(container.querySelector('.target-config-view__resources-table'));
        assert.ok(container.textContent.includes('pwm'));
        assert.ok(container.textContent.includes('i2s'));
        assert.equal(
            container.querySelectorAll('.target-config-view__pin-badge--reserved').length,
            1
        );
        assert.equal(
            container.querySelectorAll('.target-config-view__pin-badge--strapping').length,
            1
        );
        assert.ok(container.textContent.includes('psram'));
        assert.ok(container.textContent.includes('boot'));
    });

    it('renders the pin capability icon legend as a table', async () => {
        const target = new DeviceTargetInfo({
            id: 'esp32-s3',
            displayName: 'ESP32-S3',
        });

        const collection = {
            getTargetId: () => 'esp32-s3',
            getDeviceRuntimeId: () => 'general',
            on: () => () => {},
        };

        const view = new TargetConfigView({
            workspace: {
                runtimeCollection: {
                    getRuntime: () => ({ getDeviceTarget: () => target }),
                },
                getUserTargetConfig: async () => null,
            },
            collectionManager: {
                getActiveCollection: () => collection,
                on: () => () => {},
            },
        });

        view.attachTo(container);
        await flush();
        await flush();

        const table = container.querySelector('.target-config-view__icon-legend-table');
        assert.ok(table);
        assert.equal(table.querySelectorAll('tbody tr').length, 31);
        assert.ok(container.textContent.includes('Analog-to-digital converter'));
        assert.ok(container.textContent.includes('PWM Output'));
        assert.ok(container.textContent.includes('UART receive'));
        assert.ok(container.textContent.includes('Real-time clock'));
        assert.ok(container.textContent.includes('Interrupt (IRQ)'));
        assert.ok(container.textContent.includes('I2C SDA'));
        assert.ok(container.textContent.includes('SPI — any role assignable'));
        assert.ok(container.textContent.includes('I2S — any role assignable'));
    });

    it('renders structured capabilities and resources as readable text', async () => {
        const target = new DeviceTargetInfo({
            id: 'esp32-s3',
            generalCapabilities: {
                concurrency: { cores: 2, threading: true, async: true },
            },
            resources: {
                pwm: { channels: 8, timers: 4 },
            },
        });

        const collection = {
            getTargetId: () => 'esp32-s3',
            getDeviceRuntimeId: () => 'general',
            on: () => () => {},
        };

        const view = new TargetConfigView({
            workspace: {
                runtimeCollection: {
                    getRuntime: () => ({ getDeviceTarget: () => target }),
                },
                getUserTargetConfig: async () => null,
            },
            collectionManager: {
                getActiveCollection: () => collection,
                on: () => () => {},
            },
        });

        view.attachTo(container);
        await flush();
        await flush();

        assert.ok(container.textContent.includes('cores: 2, threading: yes, async: yes'));
        assert.ok(container.textContent.includes('channels: 8, timers: 4'));
        assert.equal(container.textContent.includes('{"cores"'), false);
        assert.equal(container.textContent.includes('{"channels"'), false);
    });

    it('separates pin label from reserved/strapping badges', async () => {
        const target = new DeviceTargetInfo({
            id: 'esp32-s3',
            pinCapabilities: {
                0: { label: 'GPIO0', strapping: { role: 'boot', safeLevel: 'high' } },
            },
        });

        const collection = {
            getTargetId: () => 'esp32-s3',
            getDeviceRuntimeId: () => 'general',
            on: () => () => {},
        };

        const view = new TargetConfigView({
            workspace: {
                runtimeCollection: {
                    getRuntime: () => ({ getDeviceTarget: () => target }),
                },
                getUserTargetConfig: async () => null,
            },
            collectionManager: {
                getActiveCollection: () => collection,
                on: () => () => {},
            },
        });

        view.attachTo(container);
        await flush();
        await flush();

        assert.ok(container.textContent.includes('GPIO0 strapping: boot'));
        assert.equal(container.textContent.includes('GPIO0strapping'), false);
    });

    it('shows the selected target name at the top', async () => {
        const target = new DeviceTargetInfo({
            id: 'esp32-s3-mini',
            displayName: 'ESP32-S3 Mini',
        });

        const collection = {
            getTargetId: () => 'esp32-s3-mini',
            getDeviceRuntimeId: () => 'general',
            on: () => () => {},
        };

        const view = new TargetConfigView({
            workspace: {
                runtimeCollection: {
                    getRuntime: () => ({ getDeviceTarget: () => target }),
                },
                getUserTargetConfig: async () => null,
            },
            collectionManager: {
                getActiveCollection: () => collection,
                on: () => () => {},
            },
        });

        view.attachTo(container);
        await flush();
        await flush();

        const title = container.querySelector('.target-config-view__title');
        assert.ok(title);
        assert.equal(title.textContent, 'ESP32-S3 Mini');
    });

    it('shows the firmware target for the selected target', async () => {
        const target = new DeviceTargetInfo({
            id: 'esp32_s3_mini',
            displayName: 'ESP32-S3 Mini',
        });

        const collection = {
            getTargetId: () => 'esp32_s3_mini',
            getDeviceRuntimeId: () => 'general',
            on: () => () => {},
        };

        const view = new TargetConfigView({
            workspace: {
                runtimeCollection: {
                    getRuntime: () => ({
                        getDeviceTarget: () => target,
                        getCompileTarget: (id) =>
                            id === 'esp32_s3_mini'
                                ? { board: 'ESP32_GENERIC_S3', port: 'esp32' }
                                : null,
                    }),
                },
                getUserTargetConfig: async () => null,
            },
            collectionManager: {
                getActiveCollection: () => collection,
                on: () => () => {},
            },
        });

        view.attachTo(container);
        await flush();
        await flush();

        const firmware = container.querySelector('.target-config-view__firmware-target');
        assert.ok(firmware);
        assert.equal(
            firmware.textContent,
            'Firmware target: ESP32_GENERIC_S3 (port: esp32)'
        );
    });

    it('shows a fallback when the firmware target is not specific', async () => {
        const target = new DeviceTargetInfo({
            id: 'custom',
            displayName: 'Custom Device',
        });

        const collection = {
            getTargetId: () => 'custom',
            getDeviceRuntimeId: () => 'general',
            on: () => () => {},
        };

        const view = new TargetConfigView({
            workspace: {
                runtimeCollection: {
                    getRuntime: () => ({
                        getDeviceTarget: () => target,
                        getCompileTarget: () => null,
                    }),
                },
                getUserTargetConfig: async () => null,
            },
            collectionManager: {
                getActiveCollection: () => collection,
                on: () => () => {},
            },
        });

        view.attachTo(container);
        await flush();
        await flush();

        const firmware = container.querySelector('.target-config-view__firmware-target');
        assert.ok(firmware);
        assert.equal(firmware.textContent, 'Firmware target: any board (not specific)');
    });
});

describe('formatCapabilityRecord', () => {
    it('formats object records with booleans and numbers', () => {
        assert.equal(
            formatCapabilityRecord({ cores: 2, threading: true, async: true }),
            'cores: 2, threading: yes, async: yes'
        );
        assert.equal(formatCapabilityRecord({ channels: 8, timers: 4 }), 'channels: 8, timers: 4');
    });

    it('formats array values and falls back to scalars', () => {
        assert.equal(
            formatCapabilityRecord({ wifiConflictedUnits: [2] }),
            'wifiConflictedUnits: [2]'
        );
        assert.equal(formatCapabilityRecord('esp32'), 'esp32');
        assert.equal(formatCapabilityRecord(null), '—');
    });

    it('formats per-instance limit maps inline', () => {
        assert.equal(
            formatCapabilityRecord({ channelsPerUnit: { 1: 8, 2: 10 } }),
            'channelsPerUnit: 1: 8, 2: 10'
        );
    });
});
