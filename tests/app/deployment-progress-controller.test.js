// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
//
// Tests for the deployment progress controller: which bus sources open the one dialog, what the
// terminal events do, and the modal-slot guards (identity, generation, foreign dialogs).

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
    COMPLETE_LINGER_MS,
    DEPLOYMENT_PROGRESS_OPERATIONS,
    ERROR_LINGER_MS,
    startDeploymentProgressController,
} from '../../src/micro_otter/nodes/html/js/app/deployment-progress-controller.js';

/** Echo translator: the tests assert on keys, which is what the controller passes. */
const t = (key) => key;

/**
 * Recording dialog stand-in for `DeploymentProgressDialogLike`.
 * @param {string} title Translated title the controller passed.
 */
function createDialog(title) {
    return {
        title,
        calls: [],
        setPhase(message) {
            this.calls.push(['setPhase', message]);
        },
        setOverall(progress, message) {
            this.calls.push(['setOverall', progress, message]);
        },
        setFile(progress, message) {
            this.calls.push(['setFile', progress, message]);
        },
        markComplete(message) {
            this.calls.push(['markComplete', message]);
        },
        markError(message) {
            this.calls.push(['markError', message]);
        },
        /**
         * First recorded call of a method.
         * @param {string} name Method name.
         * @returns {Array|undefined} The recorded call.
         */
        call(name) {
            return this.calls.find((entry) => entry[0] === name);
        },
        /**
         * Last recorded call of a method.
         * @param {string} name Method name.
         * @returns {Array|undefined} The recorded call.
         */
        lastCall(name) {
            return [...this.calls].reverse().find((entry) => entry[0] === name);
        },
    };
}

/** Recording `ViewManager` stand-in with a real single modal slot. */
function createHost() {
    return {
        modalView: null,
        showCalls: [],
        clearCalls: 0,
        showModal(view, options) {
            this.modalView = view;
            this.showCalls.push({ view, options });
        },
        clearModal() {
            this.clearCalls += 1;
            this.modalView = null;
        },
    };
}

/** Manually driven scheduler, so linger delays are asserted instead of waited out. */
function createScheduler() {
    let nextId = 0;
    const timers = new Map();
    return {
        timers,
        setTimeout(handler, ms) {
            nextId += 1;
            timers.set(nextId, { handler, ms });
            return nextId;
        },
        clearTimeout(handle) {
            timers.delete(handle);
        },
        /** Run (and consume) every armed timer. */
        fireAll() {
            const armed = [...timers.values()];
            timers.clear();
            for (const timer of armed) {
                timer.handler();
            }
        },
    };
}

describe('deployment progress controller', () => {
    let host;
    let scheduler;
    let dialogs;
    let listener;
    let unsubscribeCalls;
    let stop;
    let logged;

    /** Start a fresh controller against fresh fakes. */
    function start() {
        host = createHost();
        scheduler = createScheduler();
        dialogs = [];
        logged = [];
        listener = null;
        unsubscribeCalls = 0;
        stop = startDeploymentProgressController({
            viewManager: host,
            createDialog: (title) => {
                const dialog = createDialog(title);
                dialogs.push(dialog);
                return dialog;
            },
            subscribe: (handler) => {
                listener = handler;
                return () => {
                    unsubscribeCalls += 1;
                    listener = null;
                };
            },
            t,
            setTimeout: (handler, ms) => scheduler.setTimeout(handler, ms),
            clearTimeout: (handle) => scheduler.clearTimeout(handle),
            logger: (message) => logged.push(message),
        });
    }

    beforeEach(() => {
        start();
    });

    /**
     * Publish one event to the controller.
     * @param {string} source Tracker name.
     * @param {string} type Event type.
     * @param {object} [extra] Message, progress and detail.
     */
    function emit(source, type, extra = {}) {
        listener({ source, type, message: extra.message ?? '', progress: extra.progress });
    }

    it('opens one dialog per operation source, with that source title key', () => {
        for (const [source, titleKey] of Object.entries(DEPLOYMENT_PROGRESS_OPERATIONS)) {
            start();
            emit(source, 'start', { message: `${source} started` });

            assert.equal(dialogs.length, 1, `${source} opens one dialog`);
            assert.equal(dialogs[0].title, titleKey);
            assert.deepEqual(dialogs[0].call('setPhase'), ['setPhase', `${source} started`]);
            assert.deepEqual(dialogs[0].call('setOverall'), ['setOverall', 0, `${source} started`]);
            assert.deepEqual(dialogs[0].call('setFile'), [
                'setFile',
                0,
                'deployment.progressFileIdle',
            ]);
            assert.equal(host.showCalls.length, 1);
            assert.deepEqual(host.showCalls[0].options, { scrim: true });
            assert.equal(host.modalView, dialogs[0]);
        }
    });

    it('forwards an update and keeps the last percentage when none is reported', () => {
        emit('collection-sync', 'start', { message: 'Syncing' });
        emit('collection-sync', 'update', { message: 'Writing 2/5', progress: 35 });
        emit('collection-sync', 'update', { message: 'Writing 3/5' });

        assert.deepEqual(dialogs[0].lastCall('setOverall'), ['setOverall', 35, 'Writing 3/5']);
        assert.deepEqual(dialogs[0].lastCall('setPhase'), ['setPhase', 'Writing 3/5']);
    });

    it('ignores a second start while another operation runs, and logs it', () => {
        emit('collection-sync', 'start', { message: 'Syncing' });

        emit('runtime-install', 'start', { message: 'Installing runtime' });

        assert.equal(dialogs.length, 1, 'no second dialog');
        assert.equal(dialogs[0].title, 'deployment.syncCollection', 'title not flipped');
        assert.equal(host.showCalls.length, 1);
        assert.deepEqual(logged, ['deployment-progress-start-ignored: runtime-install']);
    });

    it('opens a new dialog for the same source after the previous operation settled', () => {
        emit('collection-deploy', 'start', { message: 'Deploying' });
        emit('collection-deploy', 'complete', { message: 'Deployed' });
        scheduler.fireAll();

        emit('collection-deploy', 'start', { message: 'Deploying again' });

        assert.equal(dialogs.length, 2);
        assert.equal(dialogs[1].title, 'deployment.deployCollection');
        assert.equal(host.modalView, dialogs[1]);
    });

    it('drives the file tier from file-send events without touching the overall tier', () => {
        emit('collection-sync', 'start', { message: 'Syncing' });
        emit('collection-sync', 'update', { message: 'Writing 1/3', progress: 20 });

        emit('file-send-main.py', 'update', { message: 'Sending main.py', progress: 42 });

        assert.deepEqual(dialogs[0].lastCall('setFile'), ['setFile', 42, 'Sending main.py']);
        assert.deepEqual(dialogs[0].lastCall('setOverall'), ['setOverall', 20, 'Writing 1/3']);
    });

    it('fills the file tier on a file complete but never closes the dialog', () => {
        emit('collection-sync', 'start', { message: 'Syncing' });

        emit('file-send-main.py', 'complete', { message: 'Sent main.py' });

        assert.deepEqual(dialogs[0].lastCall('setFile'), ['setFile', 100, 'Sent main.py']);
        assert.equal(host.clearCalls, 0, 'a file complete does not close the dialog');
        assert.equal(host.modalView, dialogs[0]);
        assert.equal(scheduler.timers.size, 0, 'no linger armed');
    });

    it('ignores the batch trackers, file-receive and every unrelated source', () => {
        for (const source of [
            'collection-files-upload',
            'runtime-files-upload',
            'runtime-libraries-upload',
            'tools-upload',
            'file-receive-main.py',
            'device-info-load',
            'device-runtime',
            'transpiler',
            'workspace',
            'views',
            'fs',
            'node-packages',
            'custom-function-delete',
        ]) {
            emit(source, 'start', { message: source });
            emit(source, 'update', { message: source, progress: 50 });
            emit(source, 'complete', { message: source });
        }

        assert.equal(dialogs.length, 0, 'no dialog');
        assert.equal(host.showCalls.length, 0);
        assert.equal(logged.length, 0);
    });

    it('marks a completion and closes only after the completion linger', () => {
        emit('runtime-upgrade', 'start', { message: 'Upgrading' });

        emit('runtime-upgrade', 'complete', { message: 'Runtime upgraded' });

        assert.deepEqual(dialogs[0].call('markComplete'), ['markComplete', 'Runtime upgraded']);
        assert.equal(host.clearCalls, 0, 'still visible during the linger');
        assert.equal(scheduler.timers.size, 1);
        assert.equal([...scheduler.timers.values()][0].ms, COMPLETE_LINGER_MS);

        scheduler.fireAll();

        assert.equal(host.clearCalls, 1, 'closed after the linger');
        assert.equal(host.modalView, null);
    });

    it('marks an error and closes after the longer error linger', () => {
        emit('runtime-remove', 'start', { message: 'Removing' });

        emit('runtime-remove', 'error', { message: 'Device disconnected' });

        assert.deepEqual(dialogs[0].call('markError'), ['markError', 'Device disconnected']);
        assert.equal(scheduler.timers.size, 1);
        assert.equal([...scheduler.timers.values()][0].ms, ERROR_LINGER_MS);

        scheduler.fireAll();

        assert.equal(host.clearCalls, 1);
    });

    it('does not cancel or re-arm the linger when an update arrives', () => {
        emit('collection-sync', 'start', { message: 'Syncing' });
        emit('collection-sync', 'complete', { message: 'Synced' });
        const [armed] = [...scheduler.timers.keys()];

        emit('collection-sync', 'update', { message: 'late update', progress: 80 });

        assert.equal(scheduler.timers.size, 1, 'no second timer');
        assert.ok(scheduler.timers.has(armed), 'the original timer still armed');

        scheduler.fireAll();
        assert.equal(host.clearCalls, 1);
    });

    it('never closes a foreign dialog that took the modal slot', () => {
        emit('collection-sync', 'start', { message: 'Syncing' });
        emit('collection-sync', 'complete', { message: 'Synced' });
        const foreign = { id: 'error-dialog' };
        host.modalView = foreign;

        scheduler.fireAll();

        assert.equal(host.clearCalls, 0, 'the foreign dialog keeps the layer');
        assert.equal(host.modalView, foreign);
    });

    it('re-shows the same dialog instance once the layer is free, without stealing it', () => {
        emit('collection-sync', 'start', { message: 'Syncing' });
        const dialog = dialogs[0];
        const foreign = { id: 'form-dialog' };
        host.modalView = foreign;

        emit('collection-sync', 'update', { message: 'Writing', progress: 10 });
        assert.equal(host.showCalls.length, 1, 'foreign dialog is not evicted');

        host.modalView = null;
        emit('collection-sync', 'update', { message: 'Writing', progress: 20 });

        assert.equal(host.showCalls.length, 2, 'shown again once the layer is free');
        assert.equal(host.showCalls[1].view, dialog, 'the same instance is re-shown');
        assert.equal(dialogs.length, 1, 'no new dialog instance');
    });

    it('never lets a stale linger close the dialog of a newer operation', () => {
        emit('collection-sync', 'start', { message: 'A' });
        emit('collection-sync', 'complete', { message: 'A done' });
        const [staleTimer] = [...scheduler.timers.values()];

        emit('runtime-install', 'start', { message: 'B' });
        emit('runtime-install', 'complete', { message: 'B done' });

        staleTimer.handler();

        assert.equal(host.modalView, dialogs[1], 'B keeps the dialog');
        assert.equal(host.clearCalls, 0);

        scheduler.fireAll();
        assert.equal(host.clearCalls, 1, 'B closes on its own linger');
        assert.equal(host.modalView, null);
    });

    it('stop() unsubscribes, disarms the linger and closes only its own dialog', () => {
        emit('collection-sync', 'start', { message: 'Syncing' });
        const handler = listener;

        stop();

        assert.equal(unsubscribeCalls, 1);
        assert.equal(host.clearCalls, 1);
        assert.equal(host.modalView, null);
        assert.doesNotThrow(() => stop(), 'stop is idempotent');
        assert.equal(host.clearCalls, 1, 'second stop does not close again');

        assert.doesNotThrow(
            () => handler({ source: 'collection-sync', type: 'start', message: 'late' }),
            'a late event after stop is ignored'
        );
        assert.equal(dialogs.length, 1);
    });

    it('forwards the boundary percentages unchanged and tolerates an empty start message', () => {
        assert.doesNotThrow(() => emit('runtime-refresh', 'start'));

        emit('runtime-refresh', 'update', { message: 'start', progress: 0 });
        assert.equal(dialogs[0].lastCall('setOverall')[1], 0);

        emit('runtime-refresh', 'update', { message: 'end', progress: 100 });
        assert.equal(dialogs[0].lastCall('setOverall')[1], 100);
    });
});
