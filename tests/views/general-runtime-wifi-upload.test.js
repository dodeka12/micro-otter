// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file End-to-end upload checks for the general runtime WiFi settings.
 *
 * The renderer is driven with the shipped `custom_view.json` so the wiring
 * between the view definition, the `visibleWhen` rules and
 * `custom_settings.create_runtime_settings()` stays covered. Regression guard
 * for station-only/AP-only uploads that used to be blocked without feedback.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

import { CustomViewRenderer } from '../../src/micro_otter/nodes/html/js/views/custom-runtime-view.js';

const VIEW_PATH = new URL(
    '../../src/micro_otter/nodes/device/runtime/general/custom_view.json',
    import.meta.url
);
const VIEW_DEFINITION = JSON.parse(readFileSync(VIEW_PATH, 'utf8'));

/** Device answer for a device that stores an access-point-only configuration. */
const AP_ONLY_SETTINGS_RESPONSE = JSON.stringify({
    success: true,
    wifi_sta_enabled: false,
    wifi_sta_ssid: '',
    wifi_sta_password: '',
    wifi_ap_enabled: true,
    wifi_ap_ssid: 'MicroOtter-AP',
    wifi_ap_password: '',
    webserver_enable: true,
    webserver_port: 80,
    mqtt_enabled: false,
    mqtt_host: '',
    mqtt_port: 1883,
    mqtt_client_id: '',
    mqtt_user: '',
    mqtt_password: '',
    mqtt_keepalive: 60,
    mqtt_pump_delay_ms: 50,
    status: 'generalRuntime.customView.downloadSuccess',
});

class RecordingDeviceConnection {
    constructor(response) {
        this.response = response;
        this.calls = [];
    }

    async executeCustomViewAction(functionName, parameters = []) {
        this.calls.push({ functionName, parameters });
        return this.response;
    }

    async executeCustomViewRefreshAction(functionName, parameters = []) {
        this.calls.push({ functionName, parameters });
        return this.response;
    }
}

const flushAsync = () => new Promise((resolve) => setTimeout(resolve, 20));

function uploadButtonDefinition() {
    return VIEW_DEFINITION.toolbar.controls.find((control) => control.id === 'runtime_upload');
}

describe('general runtime WiFi upload', () => {
    let dom;
    let container;
    let deviceConnection;
    let renderer;

    const inputFor = (controlId) =>
        container.querySelector(`[data-control-id="${controlId}"] input`);

    const setCheckbox = (controlId, checked) => {
        const input = inputFor(controlId);
        assert.ok(input, `Expected an input for ${controlId}`);
        input.checked = checked;
        input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    };

    const setText = (controlId, value) => {
        const input = inputFor(controlId);
        assert.ok(input, `Expected an input for ${controlId}`);
        input.value = value;
        input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    };

    beforeEach(async () => {
        dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
        global.window = dom.window;
        global.document = dom.window.document;
        global.HTMLElement = dom.window.HTMLElement;
        global.HTMLButtonElement = dom.window.HTMLButtonElement;
        global.HTMLInputElement = dom.window.HTMLInputElement;

        deviceConnection = new RecordingDeviceConnection(AP_ONLY_SETTINGS_RESPONSE);
        renderer = new CustomViewRenderer({
            deviceConnection,
            viewDefinition: VIEW_DEFINITION,
            i18nService: { t: (key) => key },
        });

        container = dom.window.document.createElement('div');
        renderer.render(container);
        await flushAsync();
    });

    afterEach(() => {
        delete global.window;
        delete global.document;
        delete global.HTMLElement;
        delete global.HTMLButtonElement;
        delete global.HTMLInputElement;
    });

    it('uploads an access-point-only configuration with an open access point', async () => {
        setText('wifi_ap_ssid', 'Boat-AP');
        setText('wifi_ap_password', '');
        deviceConnection.calls = [];

        const executed = await renderer._executeFunction(uploadButtonDefinition(), null);

        assert.equal(executed, true);
        assert.equal(deviceConnection.calls.length, 1);
        assert.equal(deviceConnection.calls[0].functionName, 'create_runtime_settings');
        assert.deepEqual(deviceConnection.calls[0].parameters, [
            false,
            '',
            '',
            true,
            'Boat-AP',
            '',
            6,
            4,
            30,
            true,
            80,
            false,
            '',
            1883,
            '',
            '',
            '',
            60,
            50,
            30,
        ]);
    });

    it('uploads an access-point-only configuration with a WPA2 password', async () => {
        setText('wifi_ap_ssid', 'Boat-AP');
        setText('wifi_ap_password', 'otter12345');
        deviceConnection.calls = [];

        const executed = await renderer._executeFunction(uploadButtonDefinition(), null);

        assert.equal(executed, true);
        assert.equal(deviceConnection.calls.length, 1);
        assert.equal(deviceConnection.calls[0].parameters[4], 'Boat-AP');
        assert.equal(deviceConnection.calls[0].parameters[5], 'otter12345');
    });

    it('reports a rejected access-point password instead of failing silently', async () => {
        setText('wifi_ap_ssid', 'Boat-AP');
        setText('wifi_ap_password', 'otter');
        deviceConnection.calls = [];

        const executed = await renderer._executeFunction(uploadButtonDefinition(), null);

        assert.equal(executed, false);
        assert.equal(deviceConnection.calls.length, 0);
        assert.match(renderer._controls.get('runtime_status').getValue(), /validationFailed/);

        const wrapper = container.querySelector('[data-control-id="wifi_ap_password"] .custom-control');
        assert.ok(wrapper.classList.contains('is-invalid'));
    });

    it('does not let the hidden station credentials block an access-point-only upload', async () => {
        setCheckbox('wifi_sta_enabled', false);
        setText('wifi_ap_ssid', 'Boat-AP');
        setText('wifi_ap_password', 'otter12345');
        deviceConnection.calls = [];

        const executed = await renderer._executeFunction(uploadButtonDefinition(), null);

        assert.equal(executed, true);
        assert.equal(deviceConnection.calls.length, 1);
        assert.equal(deviceConnection.calls[0].parameters[0], false);
    });

    it('blocks a station upload with a missing SSID and reports which field failed', async () => {
        setCheckbox('wifi_sta_enabled', true);
        setText('wifi_sta_ssid', '');
        setText('wifi_sta_password', 'secret123');
        deviceConnection.calls = [];

        const executed = await renderer._executeFunction(uploadButtonDefinition(), null);

        assert.equal(executed, false);
        assert.equal(deviceConnection.calls.length, 0);
        assert.match(
            renderer._controls.get('runtime_status').getValue(),
            /generalRuntime\.wifiSettings\.staSsid/
        );

        const wrapper = container.querySelector('[data-control-id="wifi_sta_ssid"] .custom-control');
        assert.ok(wrapper.classList.contains('is-invalid'));
    });
});
