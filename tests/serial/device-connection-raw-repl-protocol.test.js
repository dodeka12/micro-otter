// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * Raw-REPL wire protocol regression tests.
 *
 * The fixtures in this file reproduce the byte stream of the pinned MicroPython
 * runtime (v1.29, `shared/runtime/pyexec.c`): the ack is exactly the two bytes
 * `OK` with no line ending, followed by stdout, `0x04`, stderr, `0x04` and the
 * `>` prompt. A transport may split or coalesce that stream arbitrarily, so the
 * same frame is replayed with different chunking patterns.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    ConnectionState,
    DeviceConnection,
} from '../../src/micro_otter/nodes/html/js/serial/device-connection.js';

const encoder = new TextEncoder();

/** Raw REPL banner as emitted by `pyexec_raw_repl` including the trailing prompt. */
const RAW_REPL_BANNER = 'raw REPL; CTRL-B to exit\r\n>';

/**
 * Build one raw-REPL response frame.
 * @param {string} stdout - Captured standard output.
 * @param {string} [stderr] - Captured standard error (traceback or empty).
 * @returns {string} The frame as device-side text.
 */
function frame(stdout, stderr = '') {
    return `OK${stdout}\x04${stderr}\x04>`;
}

/**
 * Fake transport that answers raw-REPL commands with programmable chunks.
 *
 * `respond(command, emit)` receives the command text without its `0x04`
 * terminator and an `emit(text)` callback that dispatches one `data` event per
 * call, which lets every test choose its own chunk boundaries.
 */
class RawReplProvider extends EventTarget {
    /**
     * @param {(command: string, emit: (text: string) => void) => void} respond - Frame builder.
     */
    constructor(respond) {
        super();
        this.sent = [];
        this.disconnectCalls = 0;
        this.respond = respond;
    }

    /**
     * Send bytes to the fake device.
     * @param {string} payload - Text written by the connection.
     * @returns {Promise<void>}
     */
    async send(payload) {
        this.sent.push(payload);

        if (payload === '\r\x01') {
            this.emit(RAW_REPL_BANNER);
            return;
        }

        if (payload === '\x02') {
            this.emit('>>> ');
            return;
        }

        if (payload.endsWith('\x04')) {
            this.respond(payload.slice(0, -1), (text) => this.emit(text));
        }
    }

    /**
     * Emit one decoded chunk to data listeners.
     * @param {string} text - Chunk text.
     * @returns {void}
     */
    emit(text) {
        this.dispatchEvent(new CustomEvent('data', { detail: { data: encoder.encode(text) } }));
    }

    /**
     * Close the fake port.
     * @returns {Promise<void>}
     */
    async disconnect() {
        this.disconnectCalls += 1;
    }

    /**
     * Report the fake port as open.
     * @returns {boolean} Always true.
     */
    isConnected() {
        return true;
    }

    /**
     * Concatenate everything written after the control bytes.
     * @returns {string} The command text received by the device.
     */
    receivedCommand() {
        const controlBytes = ['\x03', '\x02', '\r\x03', '\r\x01'];
        const payload = this.sent.filter((entry) => !controlBytes.includes(entry)).join('');
        return payload.endsWith('\x04') ? payload.slice(0, -1) : payload;
    }
}

/**
 * Create a connection in the connected raw-REPL state on top of `provider`.
 * @param {RawReplProvider} provider - Transport under test.
 * @param {string[]} logs - Optional sink for logger output.
 * @returns {DeviceConnection} Connected connection.
 */
function createRawReplConnection(provider, logs = []) {
    const connection = new DeviceConnection({
        providers: {},
        logger: {
            log: (message, data) => logs.push(`${message} ${JSON.stringify(data ?? {})}`),
            warn: () => {},
            error: () => {},
        },
    });

    connection._state = ConnectionState.CONNECTED;
    connection._activeConnection = provider;
    connection._isRawRepl = true;

    return connection;
}

describe('raw REPL frame parsing', () => {
    it('reads stdout when the ack arrives in its own chunk', async () => {
        const provider = new RawReplProvider((_command, emit) => {
            emit('OK');
            emit('hello\n\x04\x04>');
        });
        const connection = createRawReplConnection(provider);

        const output = await connection.executeCode('print("hello")');

        assert.equal(output, 'hello\n');
    });

    it('reads stdout when ack and payload arrive in one chunk', async () => {
        const provider = new RawReplProvider((_command, emit) => {
            emit(frame('hello\n'));
        });
        const connection = createRawReplConnection(provider);

        const output = await connection.executeCode('print("hello")');

        assert.equal(output, 'hello\n');
    });

    it('reads stdout when a chunk splits the payload', async () => {
        const provider = new RawReplProvider((_command, emit) => {
            emit('OKhel');
            emit('lo\n\x04');
            emit('\x04>');
        });
        const connection = createRawReplConnection(provider);

        const output = await connection.executeCode('print("hello")');

        assert.equal(output, 'hello\n');
    });

    it('returns stdout only and logs stderr for a traceback frame', async () => {
        const logs = [];
        const traceback = 'Traceback (most recent call last):\n  File "<stdin>", line 1\n';
        const provider = new RawReplProvider((_command, emit) => {
            emit(frame('partial\n', traceback));
        });
        const connection = createRawReplConnection(provider, logs);

        const output = await connection.executeCode('raise ValueError()');

        assert.equal(output, 'partial\n');
        assert.equal(output.includes('Traceback'), false);
        assert.ok(
            logs.some((entry) => entry.includes('Traceback')),
            'stderr must reach the logger'
        );
    });

    it('preserves helper error text printed on stdout', async () => {
        const provider = new RawReplProvider((_command, emit) => {
            emit(frame('ERROR: missing file\n'));
        });
        const connection = createRawReplConnection(provider);

        const output = await connection.executeCode('print("ERROR: missing file")');

        assert.equal(output.startsWith('ERROR:'), true);
        assert.equal(output, 'ERROR: missing file\n');
    });

    it('rejects when the device does not answer with the OK ack', async () => {
        const provider = new RawReplProvider((_command, emit) => {
            emit('ERoops\x04\x04>');
        });
        const connection = createRawReplConnection(provider);

        await assert.rejects(
            () => connection._executeRawCommandWithTimeout('print("hello")', 300),
            /ack/i
        );
    });

    it('keeps a stdout byte that looks like a prompt', async () => {
        const provider = new RawReplProvider((_command, emit) => {
            emit('OKa > b\n\x04\x04>');
        });
        const connection = createRawReplConnection(provider);

        const output = await connection.executeCode('print("a > b")');

        assert.equal(output, 'a > b\n');
    });

    it('does not resolve before the trailing prompt arrives', async () => {
        const provider = new RawReplProvider((_command, emit) => {
            emit('OKhello\x04\x04');
        });
        const connection = createRawReplConnection(provider);

        await assert.rejects(
            () => connection._executeRawCommandWithTimeout('print("hello")', 150),
            /timeout|prompt/i
        );
    });

    it('writes a long command without truncation', async () => {
        const longCommand = `print("${'x'.repeat(600)}")`;
        const provider = new RawReplProvider((_command, emit) => {
            emit(frame('done\n'));
        });
        const connection = createRawReplConnection(provider);

        await connection.executeCode(longCommand);

        assert.equal(provider.receivedCommand(), longCommand);
    });
});
