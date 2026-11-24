// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

const PAYLOAD_TYPE_ID_PATTERN = /^[A-Za-z][A-Za-z0-9]*\.[A-Za-z][A-Za-z0-9]*\.v[1-9][0-9]*$/;

type DetailFieldValidator = (value: unknown) => boolean;

export interface AppEventDetailFieldSpec {
    name: string;
    validate?: DetailFieldValidator;
    expected?: string;
}

/**
 * Base class for all event payload types used in AppEvent envelopes.
 *
 * Derived payload classes must call super(payloadTypeId) in their constructor.
 */
export class AppPayload {
    [key: string]: unknown;

    readonly payloadTypeId: string;

    constructor(payloadTypeId: string) {
        if (!payloadTypeId || typeof payloadTypeId !== 'string') {
            throw new TypeError('AppPayload requires a non-empty string payloadTypeId');
        }

        if (!PAYLOAD_TYPE_ID_PATTERN.test(payloadTypeId)) {
            throw new TypeError(
                "AppPayload payloadTypeId must match '<EmitterClass>.<EventSemantic>.v<major>'"
            );
        }

        this.payloadTypeId = payloadTypeId;
    }
}

/**
 * Standard event envelope used by internal emitter-based systems.
 *
 * Envelope shape:
 * - name: Event name, e.g. 'tab-renamed'
 * - detail: Dedicated payload class instance (extends AppPayload)
 */
export class AppEvent<TDetail extends AppPayload = AppPayload> {
    readonly name: string;

    readonly detail: TDetail;

    constructor(name: string, detail: TDetail) {
        if (!name || typeof name !== 'string') {
            throw new TypeError('AppEvent requires a non-empty string name');
        }

        if (!(detail instanceof AppPayload)) {
            throw new TypeError('AppEvent requires detail to be an AppPayload instance');
        }

        this.name = name;
        this.detail = detail;

        Object.freeze(this);
    }
}

/**
 * Assert that an event is an AppEvent carrying an expected payload type id.
 * Throws on mismatches to enforce fail-fast event contract handling.
 *
 * @param {unknown} event Incoming event object.
 * @param {string} expectedPayloadTypeId Required payload type id.
 * @param {Array<{name: string, validate?: (value: any) => boolean, expected?: string}>|string} [fieldSpecsOrContext]
 * Optional required-field specs or context label (backward compatible overload).
 * @param {string} [context='AppEvent listener'] Context label used in error messages.
 * @throws {TypeError} When event is not AppEvent or payload type id does not match.
 */
export function assertAppEventPayloadType(
    event: unknown,
    expectedPayloadTypeId: string,
    fieldSpecsOrContext?: AppEventDetailFieldSpec[] | string,
    context = 'AppEvent listener'
): AppEvent {
    const fieldSpecs: AppEventDetailFieldSpec[] | null = Array.isArray(fieldSpecsOrContext)
        ? fieldSpecsOrContext
        : null;
    const resolvedContext =
        typeof fieldSpecsOrContext === 'string' ? fieldSpecsOrContext : context;

    if (!(event instanceof AppEvent)) {
        throw new TypeError(`${resolvedContext}: expected AppEvent instance`);
    }

    const actualPayloadTypeId = event.detail?.payloadTypeId;
    if (actualPayloadTypeId !== expectedPayloadTypeId) {
        throw new TypeError(
            `${resolvedContext}: expected payloadTypeId '${expectedPayloadTypeId}' but received '${actualPayloadTypeId}'`
        );
    }

    if (fieldSpecs) {
        assertAppEventDetailFields(event, fieldSpecs, resolvedContext);
    }

    return event;
}

/**
 * Assert that required detail fields exist and pass optional validators.
 * Throws on invalid/missing fields to enforce fail-fast listener contracts.
 *
 * @param {AppEvent} event AppEvent instance.
 * @param {Array<{name: string, validate?: (value: any) => boolean, expected?: string}>} fieldSpecs
 * Required fields and optional validators.
 * @param {string} [context='AppEvent listener'] Context label used in error messages.
 * @throws {TypeError} When required fields are missing or invalid.
 */
export function assertAppEventDetailFields(
    event: AppEvent,
    fieldSpecs: AppEventDetailFieldSpec[],
    context = 'AppEvent listener'
): AppEvent {
    if (!(event instanceof AppEvent)) {
        throw new TypeError(`${context}: expected AppEvent instance`);
    }

    if (!Array.isArray(fieldSpecs)) {
        throw new TypeError(`${context}: fieldSpecs must be an array`);
    }

    for (const spec of fieldSpecs) {
        const fieldName = spec?.name;
        if (!fieldName || typeof fieldName !== 'string') {
            throw new TypeError(`${context}: invalid field spec`);
        }

        const value = event.detail[fieldName];
        if (value === undefined || value === null) {
            throw new TypeError(`${context}: missing required detail field '${fieldName}'`);
        }

        if (typeof spec.validate === 'function' && !spec.validate(value)) {
            const expected = spec.expected ? ` (${spec.expected})` : '';
            throw new TypeError(`${context}: invalid detail field '${fieldName}'${expected}`);
        }
    }

    return event;
}
