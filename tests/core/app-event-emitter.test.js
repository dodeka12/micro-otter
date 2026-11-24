import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AppEvent, AppPayload } from '../../src/micro_otter/nodes/html/js/core/app-event.js';
import { AppEventEmitter } from '../../src/micro_otter/nodes/html/js/core/app-event-emitter.js';

class SamplePayload extends AppPayload {
    constructor(value) {
        super('Sample.Value.v1');
        this.value = value;
    }
}

describe('AppEventEmitter', () => {
    it('emit dispatches AppEvent envelope to matching event listeners', () => {
        const emitter = new AppEventEmitter();
        const received = [];

        emitter.on('value-changed', (event) => {
            received.push(event);
        });

        const emitted = emitter.emit('value-changed', new SamplePayload(42));

        assert.equal(received.length, 1);
        assert.equal(received[0], emitted);
        assert.equal(received[0] instanceof AppEvent, true);
        assert.equal(received[0].name, 'value-changed');
        assert.equal(received[0].detail.payloadTypeId, 'Sample.Value.v1');
        assert.equal(received[0].detail.value, 42);
    });

    it('emit rejects non-AppPayload values', () => {
        const emitter = new AppEventEmitter();
        assert.throws(
            () => emitter.emit('value-changed', { payloadTypeId: 'Sample.Value.v1' }),
            /AppPayload/
        );
    });

    it('on rejects invalid event names and non-function listeners', () => {
        const emitter = new AppEventEmitter();

        assert.throws(() => emitter.on('', () => {}), /eventName/);
        assert.throws(() => emitter.on('alpha', null), /listener/);
    });

    it('once rejects invalid event names and non-function listeners', () => {
        const emitter = new AppEventEmitter();

        assert.throws(() => emitter.once('', () => {}), /eventName/);
        assert.throws(() => emitter.once('alpha', null), /listener/);
    });

    it('off rejects invalid event names', () => {
        const emitter = new AppEventEmitter();
        assert.throws(() => emitter.off('', () => {}), /eventName/);
    });

    it('removeAllListeners rejects invalid event name when provided', () => {
        const emitter = new AppEventEmitter();
        assert.throws(() => emitter.removeAllListeners(''), /eventName/);
    });

    it("wildcard listeners receive every emitted event envelope", () => {
        const emitter = new AppEventEmitter();
        const names = [];
        const unsubscribe = emitter.on('*', (event) => names.push(event.name));

        emitter.emit('alpha', new SamplePayload(1));
        emitter.emit('beta', new SamplePayload(2));
        unsubscribe();
        emitter.emit('gamma', new SamplePayload(3));

        assert.deepEqual(names, ['alpha', 'beta']);
    });

    it('once unsubscribes automatically after first event', () => {
        const emitter = new AppEventEmitter();
        let calls = 0;

        emitter.once('fire', () => {
            calls += 1;
        });

        emitter.emit('fire', new SamplePayload(1));
        emitter.emit('fire', new SamplePayload(2));

        assert.equal(calls, 1);
    });

    it('removeAllListeners clears all registered listeners', () => {
        const emitter = new AppEventEmitter();
        const observed = [];

        emitter.on('alpha', (event) => observed.push(event.name));
        emitter.on('beta', (event) => observed.push(event.name));
        emitter.on('*', (event) => observed.push(`*:${event.name}`));

        emitter.removeAllListeners();
        emitter.emit('alpha', new SamplePayload(1));
        emitter.emit('beta', new SamplePayload(2));

        assert.deepEqual(observed, []);
    });
});