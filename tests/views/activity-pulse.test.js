// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { ActivityPulse } from '../../src/micro_otter/nodes/html/js/views/activity-pulse.js';

const PULSE_CLASS = 'mo-activity-pulse';

describe('ActivityPulse', () => {
    let dom;
    let host;

    beforeEach(() => {
        dom = new JSDOM('<!DOCTYPE html><html><body><div id="host"></div></body></html>', {
            url: 'http://localhost',
        });

        global.window = dom.window;
        global.document = dom.window.document;
        global.HTMLElement = dom.window.HTMLElement;

        host = document.getElementById('host');
    });

    afterEach(() => {
        delete global.window;
        delete global.document;
        delete global.HTMLElement;
    });

    it('adds the pulse class on start and removes it on the last stop', () => {
        const pulse = new ActivityPulse(host);

        assert.equal(pulse.active, false);
        assert.equal(host.classList.contains(PULSE_CLASS), false);

        pulse.start('device-connection');

        assert.equal(pulse.active, true);
        assert.equal(host.classList.contains(PULSE_CLASS), true);

        pulse.stop('device-connection');

        assert.equal(pulse.active, false);
        assert.equal(host.classList.contains(PULSE_CLASS), false);
    });

    it('keeps pulsing while overlapping reasons are active', () => {
        const pulse = new ActivityPulse(host);

        pulse.start('device-connection');
        pulse.start('deploy');
        pulse.stop('device-connection');

        assert.deepEqual([...pulse.reasons], ['deploy']);
        assert.equal(host.classList.contains(PULSE_CLASS), true);

        pulse.stop('deploy');

        assert.deepEqual([...pulse.reasons], []);
        assert.equal(host.classList.contains(PULSE_CLASS), false);
    });

    it('ignores repeated starts, unknown stops and blank reasons', () => {
        const pulse = new ActivityPulse(host);

        pulse.start('deploy');
        pulse.start('deploy');
        assert.deepEqual([...pulse.reasons], ['deploy']);

        pulse.stop('not-running');
        assert.deepEqual([...pulse.reasons], ['deploy']);
        assert.equal(host.classList.contains(PULSE_CLASS), true);

        pulse.start('');
        pulse.start('   ');
        assert.deepEqual([...pulse.reasons], ['deploy']);

        pulse.stop('');
        assert.deepEqual([...pulse.reasons], ['deploy']);

        pulse.stop('  deploy  ');
        assert.equal(host.classList.contains(PULSE_CLASS), false);
    });

    it('reports a defensive snapshot of the active reasons', () => {
        const pulse = new ActivityPulse(host);
        pulse.start('deploy');

        const snapshot = pulse.reasons;
        snapshot.push('injected');

        assert.deepEqual([...pulse.reasons], ['deploy']);
    });

    it('stopAll() releases every reason', () => {
        const pulse = new ActivityPulse(host);
        pulse.start('device-connection');
        pulse.start('deploy');

        pulse.stopAll();

        assert.equal(pulse.active, false);
        assert.deepEqual([...pulse.reasons], []);
        assert.equal(host.classList.contains(PULSE_CLASS), false);
    });

    it('supports a custom class name', () => {
        const pulse = new ActivityPulse(host, { className: 'custom-pulse' });

        pulse.start('deploy');

        assert.equal(host.classList.contains('custom-pulse'), true);
        assert.equal(host.classList.contains(PULSE_CLASS), false);

        pulse.stop('deploy');

        assert.equal(host.classList.contains('custom-pulse'), false);
    });

    it('touches only the class list of its element', () => {
        host.setAttribute('style', 'background-color: rgb(1, 2, 3);');
        const pulse = new ActivityPulse(host);

        pulse.start('deploy');
        pulse.stop('deploy');

        assert.equal(host.getAttribute('style'), 'background-color: rgb(1, 2, 3);');
    });
});
