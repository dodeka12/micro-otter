// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * General dynamic control resolution: turns a control's `dynamicOptions` descriptor into a
 * concrete `{ options, disabled, value }` result using the active device target and other
 * control values.
 */

import {
    collectGraphTopics,
    GRAPH_TOPIC_NEW_SENTINEL,
    type GraphTopicSourceLike,
} from './graph-topics.js';
import {
    AVAILABILITY_REF_SOURCE,
    availabilityFlagOptions,
    collectCollectionNodes,
    type AvailabilityCollectionLike,
} from './availability-flags.js';
import {
    collectIrqTriggerEntries,
    IRQ_NAME_SOURCE,
} from './irq-triggers.js';
import { collectSignalNames, SIGNAL_NAME_SOURCE } from './signal-names.js';
import {
    collectVarNames,
    collectVarStores,
    customVarControlId,
    DEFAULT_VAR_STORE,
    VAR_NAME_SOURCE,
    VAR_NEW_SENTINEL,
    VAR_STORE_SOURCE,
} from './var-stores.js';

export interface ResolvedDynamicOption {
    value: unknown;
    label?: string | Record<string, string>;
    /**
     * Text the picker shows for this option instead of its `label`.
     *
     * Used by the "create new…" sentinel: while the sentinel is selected the row displays
     * the text typed into its companion control, so the field the user just filled in is
     * echoed where they picked it from. The menu keeps showing `label`.
     */
    displayLabel?: string | Record<string, string>;
    activeControls?: string[];
}

export interface DynamicControlResolution {
    options: ResolvedDynamicOption[];
    disabled: boolean;
    value: unknown;
}

export interface DeviceTargetInfoLike {
    getPinsForCapability?: (capabilityKey: string) => unknown;
    getPinCapability?: (pinId: unknown) => PinCapabilityLike | null;
    hasPinCapability?: (pinId: unknown, capabilityKey: string) => boolean;
    resources?: Record<string, Record<string, unknown>>;
}

export interface PinCapabilityLike {
    label?: string;
    pull?: unknown;
    fixedPull?: unknown;
    claims?: unknown;
}

export interface DynamicControlResolverArgs {
    control: {
        id?: string;
        type?: string;
        default?: unknown;
        options?: unknown[];
        dynamicOptions?: Record<string, unknown>;
    };
    nodeData: {
        /** Node id, used to exclude the resolving node's own declaration from its own list. */
        id?: string;
        type?: string;
        controlValues?: Record<string, unknown>;
        /** Values of input-row default controls (`inputDefaults`, keyed by input id). */
        inputDefaults?: Record<string, unknown>;
    };
    deviceTarget: DeviceTargetInfoLike | null;
    graph?: GraphTopicSourceLike | null;
    /** Collection the node belongs to, for option lists that span every graph. */
    collection?: AvailabilityCollectionLike | null;
}

export type DynamicControlResolver = (
    args: DynamicControlResolverArgs
) => DynamicControlResolution;

const resolvers = new Map<string, DynamicControlResolver>();

const CLAIM_ROLE_LABELS: Record<string, string> = {
    'console.tx': 'UART0 TX (console)',
    'console.rx': 'UART0 RX (console)',
    'usb.dminus': 'USB D- (native)',
    'usb.dplus': 'USB D+ (native)',
    'onboard.led': 'onboard LED',
};

function humanizeClaimRole(role: string): string {
    return CLAIM_ROLE_LABELS[role] || role.replace(/\./g, ' ');
}

export function registerDynamicControlResolver(
    source: string,
    resolver: DynamicControlResolver
): void {
    if (!source || typeof source !== 'string') {
        throw new TypeError('registerDynamicControlResolver requires a non-empty source name');
    }
    if (typeof resolver !== 'function') {
        throw new TypeError('registerDynamicControlResolver requires a resolver function');
    }
    resolvers.set(source, resolver);
}

export function getDynamicControlResolver(source: string): DynamicControlResolver | null {
    return resolvers.get(source) || null;
}

export function resolveDynamicControl(
    args: DynamicControlResolverArgs
): DynamicControlResolution | null {
    const source = args.control?.dynamicOptions?.source;
    if (typeof source !== 'string' || !source.trim()) {
        return null;
    }

    const resolver = getDynamicControlResolver(source);
    if (!resolver) {
        return null;
    }

    return resolver(args);
}

function flattenPins(raw: unknown): unknown[] {
    if (!Array.isArray(raw)) {
        return raw === undefined || raw === null ? [] : [raw];
    }
    const result: unknown[] = [];
    raw.forEach((entry) => {
        if (Array.isArray(entry)) {
            flattenPins(entry).forEach((nested) => result.push(nested));
        } else {
            result.push(entry);
        }
    });
    return result;
}

function pullLabel(direction: unknown): string {
    if (direction === 'up') {
        return 'Pull Up';
    }
    if (direction === 'down') {
        return 'Pull Down';
    }
    return String(direction);
}

registerDynamicControlResolver('targetPinPull', (args) => {
    const control = args.control;
    const descriptor = control.dynamicOptions || {};
    const includeUndefined = descriptor.includeUndefined !== false;
    const controlValues = args.nodeData?.controlValues || {};
    const deviceTarget = args.deviceTarget;

    const pinCap =
        deviceTarget?.getPinCapability && controlValues.pin !== undefined
            ? deviceTarget.getPinCapability(controlValues.pin)
            : null;

    if (!pinCap) {
        return { options: [], disabled: false, value: null };
    }

    const fixedPull =
        pinCap.fixedPull === 'up' || pinCap.fixedPull === 'down' ? pinCap.fixedPull : null;
    if (fixedPull) {
        return {
            options: [{ value: fixedPull, label: pullLabel(fixedPull) }],
            disabled: true,
            value: fixedPull,
        };
    }

    const options: ResolvedDynamicOption[] = [];
    if (includeUndefined) {
        options.push({ value: null, label: 'Undefined' });
    }
    if (Array.isArray(pinCap.pull)) {
        pinCap.pull.forEach((direction) => {
            if (direction === 'up' || direction === 'down') {
                options.push({ value: direction, label: pullLabel(direction) });
            }
        });
    }

    const current = controlValues[control.id];
    const hasValue = options.some((option) => option.value === current);
    return { options, disabled: false, value: hasValue ? current : null };
});

registerDynamicControlResolver('targetPinsForCapability', (args) => {
    const control = args.control;
    const descriptor = control.dynamicOptions || {};
    const capabilityKey =
        typeof descriptor.capabilityKey === 'string' ? descriptor.capabilityKey : '';
    const allowNone = descriptor.allowNone === true;
    const deviceTarget = args.deviceTarget;

    const options: ResolvedDynamicOption[] = [];
    if (allowNone) {
        options.push({ value: null, label: 'None' });
    }

    let pins: unknown[] = [];
    if (deviceTarget?.getPinsForCapability && capabilityKey) {
        pins = flattenPins(deviceTarget.getPinsForCapability(capabilityKey));
    }

    pins.forEach((pin) => {
        const pinCap = deviceTarget?.getPinCapability
            ? deviceTarget.getPinCapability(pin)
            : null;
        let label = pinCap?.label || String(pin);
        const claims = pinCap?.claims;
        if (Array.isArray(claims) && claims.length > 0) {
            const role = claims[0]?.role;
            if (typeof role === 'string' && role) {
                label = `${label} — ${humanizeClaimRole(role)}`;
            }
        }
        options.push({ value: pin, label });
    });

    if (options.length === 0) {
        return { options: [], disabled: true, value: null };
    }

    const current = args.nodeData?.controlValues?.[control.id];
    const hasValue = options.some((option) => option.value === current);
    return {
        options,
        disabled: false,
        value: hasValue ? current : options.length ? options[0].value : null,
    };
});

registerDynamicControlResolver('targetResourceValues', (args) => {
    const control = args.control;
    const descriptor = control.dynamicOptions || {};
    const resourceGroup =
        typeof descriptor.resourceGroup === 'string' ? descriptor.resourceGroup : '';
    const resourceKey = typeof descriptor.resourceKey === 'string' ? descriptor.resourceKey : '';
    const deviceTarget = args.deviceTarget;

    let count = 0;
    if (resourceGroup && resourceKey && deviceTarget?.resources) {
        const raw = deviceTarget.resources[resourceGroup]?.[resourceKey];
        if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
            count = Math.floor(raw);
        }
    }

    const options: ResolvedDynamicOption[] = [];
    for (let index = 0; index < count; index += 1) {
        options.push({ value: index, label: String(index) });
    }

    if (count === 0) {
        return { options: [], disabled: true, value: null };
    }

    const current = args.nodeData?.controlValues?.[control.id];
    const hasValue = options.some((option) => option.value === current);
    return { options, disabled: false, value: hasValue ? current : options[0].value };
});

registerDynamicControlResolver('graphTopics', (args) => {
    const control = args.control;
    const descriptor = control.dynamicOptions || {};
    const rawCurrent = String(args.nodeData?.controlValues?.[control.id] ?? '').trim();
    // A stored sentinel means "the user is typing a new topic": list the sentinel once and
    // label the first entry as unset instead of showing '__new__' twice.
    const current = rawCurrent === GRAPH_TOPIC_NEW_SENTINEL ? '' : rawCurrent;
    const declaredIds = Array.isArray(descriptor.controlIds)
        ? descriptor.controlIds.filter((id): id is string => typeof id === 'string')
        : undefined;
    const topics = collectGraphTopics(args.graph, declaredIds)
        .map((entry) => entry.topic)
        .filter((topic) => topic !== current);

    const options: ResolvedDynamicOption[] = [];
    // Always offer the current value first: a topic may be stored while the node that
    // used to publish it was deleted, and the resolver never rewrites an existing value.
    options.push({ value: current, label: current || '(not set)' });
    topics.forEach((topic) => options.push({ value: topic, label: topic }));
    options.push({
        value: GRAPH_TOPIC_NEW_SENTINEL,
        label:
            typeof descriptor.newLabel === 'string' && descriptor.newLabel
                ? descriptor.newLabel
                : 'New topic\u2026',
        displayLabel:
            rawCurrent === GRAPH_TOPIC_NEW_SENTINEL
                ? sentinelTypedText(args, descriptor, 'newTopicControls') || undefined
                : undefined,
        activeControls: Array.isArray(descriptor.newTopicControls)
            ? descriptor.newTopicControls.filter((id): id is string => typeof id === 'string')
            : [],
    });

    return { options, disabled: false, value: rawCurrent || GRAPH_TOPIC_NEW_SENTINEL };
});

/**
 * Value a control shows: input-row defaults win for input ids, controls otherwise.
 * @param args - Resolver arguments.
 * @param controlId - Control or input id.
 * @returns The trimmed value, or an empty string when nothing is stored.
 */
function controlValue(args: DynamicControlResolverArgs, controlId: string): string {
    const raw =
        args.nodeData?.inputDefaults?.[controlId] ?? args.nodeData?.controlValues?.[controlId] ?? '';
    return String(raw).trim();
}

/**
 * Label of a sentinel option: the descriptor's own text, or a generic fallback.
 *
 * A node definition declares `newLabel` as an i18n text map; the dropdown control resolves
 * that map, so it is passed through unchanged when no plain string was declared.
 *
 * @param descriptor - The control's `dynamicOptions` descriptor.
 * @param fallback - Label used when the descriptor declares none.
 * @returns The label to render.
 */
function sentinelLabel(
    descriptor: Record<string, unknown>,
    fallback: string
): string | Record<string, string> {
    const declared = descriptor.newLabel;
    if (typeof declared === 'string' && declared) {
        return declared;
    }
    if (declared && typeof declared === 'object' && !Array.isArray(declared)) {
        const entries = Object.entries(declared as Record<string, unknown>).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1] !== ''
        );
        if (entries.length > 0) {
            return Object.fromEntries(entries);
        }
    }
    return fallback;
}

/**
 * Text typed into the companion control of a sentinel option.
 *
 * The sentinel stays the selected value; only the text the picker shows changes, so a name
 * or namespace the user just created is visible where they picked it — instead of the
 * placeholder of the empty sentinel.
 *
 * @param args - Resolver arguments.
 * @param descriptor - The control's `dynamicOptions` descriptor.
 * @param key - Descriptor key holding the companion control ids (`newNameControls`, ...).
 * @returns The trimmed text, or an empty string when nothing was typed.
 */
function sentinelTypedText(
    args: DynamicControlResolverArgs,
    descriptor: Record<string, unknown>,
    key: string
): string {
    const [companionId] = declaredControls(descriptor, key);
    return companionId ? controlValue(args, companionId) : '';
}

/**
 * Controls an option of a descriptor reveals, as a clean string list.
 * @param descriptor - The control's `dynamicOptions` descriptor.
 * @param key - Descriptor key holding the control ids.
 * @returns The declared ids, or an empty list.
 */
function declaredControls(descriptor: Record<string, unknown>, key: string): string[] {
    const declared = descriptor[key];
    return Array.isArray(declared)
        ? declared.filter((id): id is string => typeof id === 'string')
        : [];
}

/**
 * Descriptor keys naming the companion controls of a "create new…" sentinel option.
 *
 * While the sentinel is selected the picker mirrors the text of that companion (see
 * `sentinelTypedText()`), so a keystroke in the companion changes the picker's own row. The
 * node UI uses this list to treat the companion as a dependency of the picker without
 * rebuilding the node.
 */
export const SENTINEL_COMPANION_KEYS = [
    'newNameControls',
    'newStoreControls',
    'newTopicControls',
] as const;

/**
 * Whether a descriptor renders the text of `controlId` on one of its options.
 *
 * @param descriptor - A control's `dynamicOptions` descriptor, or `undefined`.
 * @param controlId - Control or input id to look for.
 * @returns True when the descriptor echoes that control.
 */
export function descriptorEchoesControl(descriptor: unknown, controlId: string): boolean {
    const record =
        descriptor && typeof descriptor === 'object'
            ? (descriptor as Record<string, unknown>)
            : null;
    if (!record || !controlId) {
        return false;
    }

    return SENTINEL_COMPANION_KEYS.some((key) => declaredControls(record, key).includes(controlId));
}

registerDynamicControlResolver(VAR_STORE_SOURCE, (args) => {
    const control = args.control;
    const descriptor = control.dynamicOptions || {};
    const rawCurrent = controlValue(args, String(control.id ?? ''));
    // An unset store is the default namespace, not the sentinel: the picker has to name the
    // namespace the generator will use, and only an explicitly picked sentinel opens the
    // companion text control.
    const isNew = rawCurrent === VAR_NEW_SENTINEL;
    const current = isNew ? '' : rawCurrent || DEFAULT_VAR_STORE;
    const stores = collectVarStores(args.collection, args.graph).filter(
        (store) => store !== current
    );

    const options: ResolvedDynamicOption[] = [];
    // A namespace may be stored while the node that used it was deleted: it is shown first
    // and never rewritten.
    if (current) {
        options.push({ value: current, label: current });
    }
    stores.forEach((store) => options.push({ value: store, label: store }));
    options.push({
        value: VAR_NEW_SENTINEL,
        label: sentinelLabel(descriptor, 'New store\u2026'),
        // While the sentinel is selected the row echoes the typed namespace instead of the
        // placeholder, so a freshly created "presets" stays visible after closing the field.
        displayLabel: isNew
            ? sentinelTypedText(args, descriptor, 'newStoreControls') || undefined
            : undefined,
        activeControls: declaredControls(descriptor, 'newStoreControls'),
    });

    return { options, disabled: false, value: isNew ? VAR_NEW_SENTINEL : current };
});

registerDynamicControlResolver(VAR_NAME_SOURCE, (args) => {
    const control = args.control;
    const descriptor = control.dynamicOptions || {};
    const rawCurrent = controlValue(args, String(control.id ?? ''));
    const current = rawCurrent === VAR_NEW_SENTINEL ? '' : rawCurrent;
    const dependsOn = descriptor.dependsOn;
    const storeControlId = Array.isArray(dependsOn) ? dependsOn[0] : undefined;
    const rawStore = storeControlId ? controlValue(args, String(storeControlId)) : '';
    // The store picker may itself sit on "New store…": the namespace then comes from its
    // companion text control, exactly like the store resolver resolves it.
    const resolvedStore =
        rawStore === VAR_NEW_SENTINEL
            ? controlValue(args, customVarControlId(String(storeControlId)))
            : rawStore;
    const store = resolvedStore || DEFAULT_VAR_STORE;
    // A declaring node must not see its own declaration: the sentinel is its own row.
    const names = collectVarNames(args.collection, args.graph, store, args.nodeData?.id).filter(
        (name) => name !== current
    );

    const options: ResolvedDynamicOption[] = [];
    // The first entry shows the current value; a brand-new node has no name yet, so it reads
    // "(not set)" until the user picks a variable or "Declare variable…".
    options.push({ value: current, label: current || '(not set)' });
    names.forEach((name) => options.push({ value: name, label: name }));
    options.push({
        value: VAR_NEW_SENTINEL,
        label: sentinelLabel(descriptor, 'Declare variable\u2026'),
        // While the sentinel is selected the row shows the typed variable name instead of
        // the placeholder, so the name the user just declared stays visible.
        displayLabel:
            rawCurrent === VAR_NEW_SENTINEL
                ? sentinelTypedText(args, descriptor, 'newNameControls') || undefined
                : undefined,
        activeControls: declaredControls(descriptor, 'newNameControls'),
    });

    return { options, disabled: false, value: rawCurrent };
});

/**
 * Interrupt-name picker (`irqTriggerNames`).
 *
 * The source is collection-wide: an `interrupt-enable` node may reference a channel declared by
 * an `interrupt-input` node in any graph, so every declared name is listed regardless of the
 * active graph. It needs no device target, because the names are plain user-declared labels.
 *
 * The resolving node's own declaration is skipped: a declaring node never picks from itself.
 * A stale reference (the declaration was deleted or renamed away) stays selectable until the
 * `IrqReferenceReconciler` clears it, so the picker never silently hides what is stored.
 */
registerDynamicControlResolver(IRQ_NAME_SOURCE, (args) => {
    const control = args.control;
    const current = String(controlValue(args, String(control.id ?? '')) ?? '').trim();
    const entries = collectIrqTriggerEntries(args.collection, args.graph);
    const ownNodeId = String(args.nodeData?.id ?? '').trim();
    const options: ResolvedDynamicOption[] = entries
        .filter((entry) => !ownNodeId || entry.nodeId !== ownNodeId)
        .map((entry) => ({ value: entry.name, label: entry.name }));

    // A name may outlive its declaration (e.g. after a reload that races the reconciler): show it
    // once at the top so the stored value stays visible and selectable. A declared current name is
    // already among the entries and must not be listed twice.
    if (current && !entries.some((entry) => entry.name === current)) {
        options.unshift({ value: current, label: current });
    }

    return { options, disabled: options.length === 0, value: current };
});

/**
 * Signal-name picker (`signalNames`).
 *
 * The source is collection-wide: an `event` graph may watch a signal posted by a
 * `signal-post` node in any graph. It needs no device target. The first option is
 * `(not set)`, which disables the posting node; the sentinel means "type a new signal
 * name". A stale stored value that no declaration covers stays selectable until the
 * `SignalReferenceReconciler` clears it.
 *
 * The stored sentinel is normalised to an empty current value before the option list is
 * built. Otherwise the stale-value preservation adds a second `__new__` option without
 * `activeControls`, and `resolveHiddenControlIds()` finds that duplicate first, leaving
 * the companion text control hidden.
 */
registerDynamicControlResolver(SIGNAL_NAME_SOURCE, (args) => {
    const control = args.control;
    const descriptor = control.dynamicOptions || {};
    const rawCurrent = String(controlValue(args, String(control.id ?? '')) ?? '').trim();
    const current = rawCurrent === VAR_NEW_SENTINEL ? '' : rawCurrent;
    const names = collectSignalNames(args.collection, args.graph).filter(
        (name) => name !== current
    );

    // A brand-new node has no signal yet, so it reads "(not set)" and stays disabled until
    // the user picks a signal or "Define signal…".
    const options: ResolvedDynamicOption[] = [
        { value: current, label: current || '(not set)' },
    ];
    names.forEach((name) => options.push({ value: name, label: name }));
    options.push({
        value: VAR_NEW_SENTINEL,
        label: sentinelLabel(descriptor, 'Define signal\u2026'),
        // While the sentinel is selected the row echoes the typed name instead of the
        // placeholder, so the signal the user just defined stays visible.
        displayLabel:
            rawCurrent === VAR_NEW_SENTINEL
                ? sentinelTypedText(args, descriptor, 'newNameControls') || undefined
                : undefined,
        activeControls: declaredControls(descriptor, 'newNameControls'),
    });

    return { options, disabled: false, value: rawCurrent };
});

/** Normalise a stored multi-select value to a list of ids. */
function toIdList(value: unknown): string[] {
    const raw = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
    const ids: string[] = [];
    raw.forEach((entry) => {
        const id = String(entry ?? '').trim();
        if (id && !ids.includes(id)) {
            ids.push(id);
        }
    });
    return ids;
}

registerDynamicControlResolver(AVAILABILITY_REF_SOURCE, (args) => {
    const control = args.control;
    const stored = toIdList(args.nodeData?.controlValues?.[control.id]);
    const nodes = collectCollectionNodes(args.collection, args.graph);
    const options: ResolvedDynamicOption[] = availabilityFlagOptions(nodes);

    // A flag node may be deleted while entities still reference its id: the resolver never
    // rewrites a stored selection, it shows it and lets the graph rule flag it.
    const known = new Set(options.map((option) => String(option.value)));
    stored
        .filter((id) => !known.has(id))
        .sort((left, right) => left.localeCompare(right))
        .forEach((id) => options.push({ value: id, label: `${id} (missing)` }));

    return { options, disabled: options.length === 0, value: stored };
});

