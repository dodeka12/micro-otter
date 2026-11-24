import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    DeviceConnection,
    MessageType,
} from '../../src/micro_otter/nodes/html/js/serial/device-connection.js';

function createConnection() {
    return new DeviceConnection({
        providers: {},
        logger: { log: () => {}, warn: () => {}, error: () => {} },
    });
}

describe('DeviceConnection message parsing', () => {
    it('parses [user] lines into user message events', () => {
        const connection = createConnection();
        const messages = [];

        connection.addEventListener('message', (event) => {
            messages.push(event.detail);
        });

        connection._parseMessages('[user] Main loop: Doing nothing... 0\n');

        assert.equal(messages.length, 1);
        assert.equal(messages[0].type, MessageType.USER);
        assert.equal(messages[0].message, 'Main loop: Doing nothing... 0');
    });

    it('parses chunked [user] lines across multiple serial packets', () => {
        const connection = createConnection();
        const messages = [];

        connection.addEventListener('message', (event) => {
            messages.push(event.detail);
        });

        connection._parseMessages('[us');
        connection._parseMessages('er] Main loop: Doing n');
        connection._parseMessages('othing... 1\n');

        assert.equal(messages.length, 1);
        assert.equal(messages[0].type, MessageType.USER);
        assert.equal(messages[0].message, 'Main loop: Doing nothing... 1');
    });

    it('parses [otter] structured logs as otter messages', () => {
        const connection = createConnection();
        const messages = [];

        connection.addEventListener('message', (event) => {
            messages.push(event.detail);
        });

        connection._parseMessages(
            '[otter] {"event":"wifi","state":"station-search","status_label":"no-ap-found"}\n'
        );

        assert.equal(messages.length, 1);
        assert.equal(messages[0].type, MessageType.OTTER);
        assert.ok(messages[0].message.includes('"event":"wifi"'));
    });

    it('emits trailing [otter] line without newline when flush=true', () => {
        const connection = createConnection();
        const messages = [];

        connection.addEventListener('message', (event) => {
            messages.push(event.detail);
        });

        connection._parseMessages('[otter] {"event":"fatal","message":"Wifi Internal State Error"}');
        assert.equal(messages.length, 0);

        connection._parseMessages('', true);
        assert.equal(messages.length, 1);
        assert.equal(messages[0].type, MessageType.OTTER);
        assert.ok(messages[0].message.includes('"event":"fatal"'));
    });

    it('parses [success] and [data] lines into their own message types', () => {
        const connection = createConnection();
        const messages = [];

        connection.addEventListener('message', (event) => {
            messages.push(event.detail);
        });

        connection._parseMessages(
            '[success] mqtt: connected to 192.168.1.10:1883\n[data] io-queue: 2 registered stream(s)\n'
        );

        assert.equal(messages.length, 2);
        assert.equal(messages[0].type, MessageType.SUCCESS);
        assert.equal(messages[0].message, 'mqtt: connected to 192.168.1.10:1883');
        assert.equal(messages[1].type, MessageType.DATA);
        assert.equal(messages[1].message, 'io-queue: 2 registered stream(s)');
    });

    it('keeps non-canonical bracket tags such as [debug] in the raw stream', () => {
        const connection = createConnection();
        const messages = [];

        connection.addEventListener('message', (event) => {
            messages.push(event.detail);
        });

        connection._parseMessages('[debug] ws: keep-alive id=3\n', true);

        assert.equal(messages.length, 1);
        assert.equal(messages[0].type, MessageType.RAW);
        assert.equal(messages[0].message, '[debug] ws: keep-alive id=3');
    });

    it('emits untagged text between tagged messages as raw', () => {
        const connection = createConnection();
        const messages = [];

        connection.addEventListener('message', (event) => {
            messages.push(event.detail);
        });

        connection._parseMessages(
            '[otter] {"event":"wifi","state":"station-search"}\n[diag] station: rssi=-70\n[user] Main loop: 0\n'
        );

        assert.equal(messages.length, 3);
        assert.equal(messages[0].type, MessageType.OTTER);
        assert.equal(messages[1].type, MessageType.RAW);
        assert.equal(messages[1].message, '[diag] station: rssi=-70');
        assert.equal(messages[2].type, MessageType.USER);
    });
});
