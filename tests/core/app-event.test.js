import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    AppEvent,
    AppPayload,
    assertAppEventPayloadType,
    assertAppEventDetailFields,
} from '../../src/micro_otter/nodes/html/js/core/app-event.js';

class ExamplePayload extends AppPayload {
    constructor(value) {
        super('Example.Payload.v1');
        this.value = value;
    }
}

describe('AppEvent', () => {
    it('creates an envelope with name and payload instance', () => {
        const payload = new ExamplePayload('ok');
        const event = new AppEvent('tab-renamed', payload);

        assert.equal(event.name, 'tab-renamed');
        assert.equal(event.detail, payload);
        assert.equal(event.detail.payloadTypeId, 'Example.Payload.v1');
    });

    it('freezes the envelope object', () => {
        const event = new AppEvent('tab-changed', new ExamplePayload(1));
        assert.equal(Object.isFrozen(event), true);
    });

    it('rejects empty event name', () => {
        assert.throws(
            () => new AppEvent('', new ExamplePayload(1)),
            /name/
        );
    });

    it('rejects payloads not derived from AppPayload', () => {
        assert.throws(
            () => new AppEvent('tab-changed', { payloadTypeId: 'Example.Payload.v1' }),
            /AppPayload/
        );
    });

    it('rejects non-object detail payload', () => {
        assert.throws(
            () => new AppEvent('tab-changed', 'bad-payload'),
            /detail/
        );
    });

    it('throws when required detail field is missing', () => {
        const event = new AppEvent('tab-changed', new ExamplePayload(1));
        assert.throws(
            () =>
                assertAppEventDetailFields(
                    event,
                    [{ name: 'activeId', validate: (value) => typeof value === 'string' }],
                    'test-listener'
                ),
            /missing required detail field 'activeId'/
        );
    });

    it('throws when required detail field is invalid', () => {
        class InvalidPayload extends AppPayload {
            constructor() {
                super('Example.Invalid.v1');
                this.activeId = 42;
            }
        }

        const event = new AppEvent('tab-changed', new InvalidPayload());
        assert.throws(
            () =>
                assertAppEventDetailFields(
                    event,
                    [
                        {
                            name: 'activeId',
                            validate: (value) => typeof value === 'string',
                            expected: 'string',
                        },
                    ],
                    'test-listener'
                ),
            /invalid detail field 'activeId'/
        );
    });

    it('assertAppEventPayloadType validates required fields via optional array argument', () => {
        class ValidPayload extends AppPayload {
            constructor() {
                super('Example.Valid.v1');
                this.activeId = 'graph-1';
            }
        }

        const event = new AppEvent('tab-changed', new ValidPayload());

        assert.doesNotThrow(() =>
            assertAppEventPayloadType(
                event,
                'Example.Valid.v1',
                [{ name: 'activeId', validate: (value) => typeof value === 'string' }],
                'test-listener'
            )
        );
    });

    it('assertAppEventPayloadType keeps backward-compatible context-only overload', () => {
        const event = new AppEvent('tab-changed', new ExamplePayload(1));

        assert.throws(
            () => assertAppEventPayloadType(event, 'Example.Other.v1', 'test-listener'),
            /test-listener: expected payloadTypeId/
        );
    });
});
