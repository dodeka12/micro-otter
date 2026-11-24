// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    FIRMWARE_ERROR_CODES,
    describeFirmwareError,
    markDisconnected,
    reduceFirmwareFrame,
    startJobState,
} from '../../src/micro_otter/nodes/html/js/firmware/firmware-job-state.js';

describe('reduceFirmwareFrame', () => {
    it('ignores unknown, missing-type, and non-object frames', () => {
        const state = startJobState('compile');
        assert.equal(reduceFirmwareFrame(state, null), state);
        assert.equal(reduceFirmwareFrame(state, 'nope'), state);
        assert.equal(reduceFirmwareFrame(state, {}), state);
        assert.equal(reduceFirmwareFrame(state, { type: 'future-frame' }), state);
    });

    it('moves through status, output, and result to succeeded', () => {
        let state = startJobState('compile');
        state = reduceFirmwareFrame(state, { type: 'status', job: 'compile', state: 'queued' });
        assert.equal(state.phase, 'queued');
        state = reduceFirmwareFrame(state, { type: 'status', job: 'compile', state: 'running', stage: 'build' });
        assert.equal(state.phase, 'running');
        assert.equal(state.stage, 'build');
        state = reduceFirmwareFrame(state, { type: 'output', job: 'compile', stream: 'stdout', text: 'ok\n' });
        assert.equal(state.log.length, 1);
        state = reduceFirmwareFrame(state, {
            type: 'result',
            job: 'compile',
            status: 'succeeded',
            payload: { firmware: { path: '/x.bin' } },
        });
        assert.equal(state.phase, 'succeeded');
        assert.equal(state.busy, false);
        assert.deepEqual(state.result.payload, { firmware: { path: '/x.bin' } });
        assert.equal(state.result.status, 'succeeded');
    });

    it('keeps a done status running until the terminal frame', () => {
        let state = startJobState('compile');
        state = reduceFirmwareFrame(state, { type: 'status', job: 'compile', state: 'done' });
        assert.equal(state.phase, 'running');
    });

    it('keeps job-busy from clearing the running job', () => {
        let state = startJobState('compile');
        state = reduceFirmwareFrame(state, { type: 'status', job: 'compile', state: 'running' });
        state = reduceFirmwareFrame(state, { type: 'error', code: 'job-busy', message: 'busy' });
        assert.equal(state.phase, 'running');
        assert.equal(state.busy, true);
        assert.equal(state.error.code, 'job-busy');
    });

    it('marks any other error as failed', () => {
        let state = startJobState('deploy');
        state = reduceFirmwareFrame(state, {
            type: 'error',
            code: 'flash-command',
            message: 'nope',
            hint: 'try again',
            details: { returncode: 2 },
        });
        assert.equal(state.phase, 'failed');
        assert.equal(state.busy, false);
        assert.equal(state.error.code, 'flash-command');
        assert.equal(state.error.hint, 'try again');
    });

    it('trims the log past the limit keeping the newest lines', () => {
        let state = startJobState('compile');
        for (let index = 0; index < 2005; index += 1) {
            state = reduceFirmwareFrame(state, {
                type: 'output',
                job: 'compile',
                stream: 'stdout',
                text: `line ${index}\n`,
            });
        }
        assert.equal(state.log.length, 2000);
        assert.equal(state.log[1999].text, 'line 2004\n');
    });

    it('rewrites the last line when a reprint of it arrives', () => {
        let state = startJobState('deploy');
        state = reduceFirmwareFrame(state, {
            type: 'output',
            job: 'deploy',
            stream: 'stdout',
            text: 'Writing at 0x00100000 [>          ]   0.0% 1000/20000 bytes... \n',
        });
        state = reduceFirmwareFrame(state, {
            type: 'output',
            job: 'deploy',
            stream: 'stdout',
            text: '\rWriting at 0x00100000 [====>      ]  50.0% 10000/20000 bytes... \n',
        });
        assert.equal(state.log.length, 2, 'the first reprint starts a line of its own');
        assert.equal(state.log[1].redraw, true);
        assert.ok(state.log[1].text.startsWith('Writing at'), 'the marker never reaches the text');
        state = reduceFirmwareFrame(state, {
            type: 'output',
            job: 'deploy',
            stream: 'stdout',
            text: '\rWriting at 0x00100000 [==========] 100.0% 20000/20000 bytes... \n',
        });
        assert.equal(state.log.length, 2, 'the next updates rewrite the same line');
        assert.equal(
            state.log[1].text,
            'Writing at 0x00100000 [==========] 100.0% 20000/20000 bytes... \n'
        );
        assert.equal(
            state.log[0].text,
            'Writing at 0x00100000 [>          ]   0.0% 1000/20000 bytes... \n',
            'the line before the bar is untouched'
        );
    });

    it('appends a reprint that follows an ordinary line or the other stream', () => {
        let state = startJobState('deploy');
        const bar = (percent) => ({
            type: 'output',
            job: 'deploy',
            stream: 'stdout',
            text: `\rWriting at 0x00100000 [==>       ]  ${percent}% 1000/20000 bytes... \n`,
        });
        state = reduceFirmwareFrame(state, bar('10'));
        state = reduceFirmwareFrame(state, {
            type: 'output',
            job: 'deploy',
            stream: 'stdout',
            text: 'Hash of data verified.\n',
        });
        state = reduceFirmwareFrame(state, bar('20'));
        assert.deepEqual(
            state.log.map((line) => line.text),
            [
                'Writing at 0x00100000 [==>       ]  10% 1000/20000 bytes... \n',
                'Hash of data verified.\n',
                'Writing at 0x00100000 [==>       ]  20% 1000/20000 bytes... \n',
            ],
            'a real message is never replaced by a later bar'
        );
        state = reduceFirmwareFrame(state, {
            type: 'output',
            job: 'deploy',
            stream: 'stderr',
            text: '\rWriting at 0x00100000 [====>     ]  30% 1000/20000 bytes... \n',
        });
        assert.equal(state.log.length, 4, 'a bar on stderr does not rewrite the stdout line');
        assert.equal(state.log[3].stream, 'stderr');
    });

    it('reduces a list job result without a compile/deploy payload', () => {
        let state = startJobState('list');
        state = reduceFirmwareFrame(state, {
            type: 'status',
            job: 'list',
            state: 'running',
            stage: 'inventory',
        });
        assert.equal(state.phase, 'running');
        state = reduceFirmwareFrame(state, {
            type: 'result',
            job: 'list',
            status: 'succeeded',
            payload: { entries: [] },
        });
        assert.equal(state.phase, 'succeeded');
        assert.deepEqual(state.result.payload, { entries: [] });
    });

    it('reduces a delete job result', () => {
        let state = startJobState('delete');
        state = reduceFirmwareFrame(state, {
            type: 'result',
            job: 'delete',
            status: 'succeeded',
            payload: { removed: [], absent: [] },
        });
        assert.equal(state.phase, 'succeeded');
        assert.deepEqual(state.result.payload, { removed: [], absent: [] });
    });

    it('starts an add-on job and reduces its frames like any other job', () => {
        let state = startJobState('addon-install');
        assert.equal(state.job, 'addon-install');
        assert.equal(state.busy, true);

        state = reduceFirmwareFrame(state, {
            type: 'status',
            job: 'addon-install',
            state: 'running',
            stage: 'addon-install',
        });
        assert.equal(state.phase, 'running');
        assert.equal(state.stage, 'addon-install');

        state = reduceFirmwareFrame(state, {
            type: 'result',
            job: 'addon-install',
            status: 'succeeded',
            payload: { addons: [], installed: { id: 'pulse' } },
        });
        assert.equal(state.phase, 'succeeded');
        assert.equal(state.busy, false);
        assert.deepEqual(state.result.payload, { addons: [], installed: { id: 'pulse' } });

        let uninstall = startJobState('addon-uninstall');
        uninstall = reduceFirmwareFrame(uninstall, {
            type: 'status',
            job: 'addon-uninstall',
            state: 'running',
            stage: 'addon-uninstall',
            message: 'pulse',
        });
        assert.equal(uninstall.message, 'pulse');
        uninstall = reduceFirmwareFrame(uninstall, {
            type: 'result',
            job: 'addon-uninstall',
            status: 'succeeded',
            payload: { addons: [], removed: [{ id: 'pulse', version: '1.0.0' }] },
        });
        assert.equal(uninstall.phase, 'succeeded');
        assert.deepEqual(uninstall.result.payload.removed, [{ id: 'pulse', version: '1.0.0' }]);
    });

    it('now translates an addon code to its locale key', () => {
        assert.deepEqual(
            describeFirmwareError({
                code: 'addon-already-installed',
                message: 'x',
                hint: null,
                details: null,
            }),
            { key: 'firmwareBuild.errors.addon-already-installed', params: {} }
        );
    });
});

describe('markDisconnected', () => {
    it('clears busy but keeps the log and error', () => {
        let state = startJobState('compile');
        state = reduceFirmwareFrame(state, { type: 'output', job: 'compile', stream: 'stdout', text: 'x\n' });
        const next = markDisconnected(state);
        assert.equal(next.phase, 'disconnected');
        assert.equal(next.busy, false);
        assert.equal(next.log.length, 1);
    });
});

describe('describeFirmwareError', () => {
    it('maps every known code to a locale key and null for unknown', () => {
        for (const code of FIRMWARE_ERROR_CODES) {
            const result = describeFirmwareError({ code, message: code, hint: null, details: null });
            assert.equal(result.key, `firmwareBuild.errors.${code}`);
        }
        const unknown = describeFirmwareError({ code: 'future-code', message: 'x', hint: null, details: null });
        assert.equal(unknown, null);
    });

    it('returns null for a null error', () => {
        assert.equal(describeFirmwareError(null), null);
    });

    it('lists all 76 documented codes, 22 of them add-on codes, without duplicates', () => {
        assert.equal(FIRMWARE_ERROR_CODES.length, 76);
        assert.equal(new Set(FIRMWARE_ERROR_CODES).size, 76);
        assert.equal(
            FIRMWARE_ERROR_CODES.filter((code) => code.startsWith('addon-')).length,
            22
        );
    });
});
