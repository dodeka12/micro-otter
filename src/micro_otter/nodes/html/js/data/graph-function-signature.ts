// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file Function signature model for function graphs.
 *
 * A function graph declares its interface in the graph settings: a category, a
 * header icon and two ordered port lists. Input ports become the emitted Python
 * parameters, output ports become the returned values. Port identifiers are derived from the
 * port position (`in_0`, `out_0`, …) because connections store connector
 * indices, not names; names are free text and never key wiring. The structural
 * input/output nodes mirror this signature onto the canvas, and every input port
 * also declares a default value that becomes the inline editor on the generated
 * call node.
 *
 * Every helper here is pure and defensive: values come from storage, from the
 * settings view and from the transpiler, so unknown shapes degrade to a valid
 * empty signature instead of throwing.
 *
 * @module data/graph-function-signature
 */

import { normalizeAllowedTypes } from './type-conversions.js';

/** Which side of the function interface a port belongs to. */
export type FunctionPortKind = 'input' | 'output';

/**
 * Default value of one declared input parameter.
 *
 * The value is expressed in {@link type}, one of the port's declared data types, and —
 * for numeric types — may carry the `min`/`max`/`step` bounds the call node's default
 * editor enforces. Output ports never carry a default.
 */
export interface FunctionPortDefault {
    /** Data type the default value is expressed in; one of the port's declared types. */
    type: string;
    /** Default value; a number, boolean or string matching {@link type}. */
    value: unknown;
    /** Lower bound for numeric defaults; omitted means "no bound". */
    min?: number;
    /** Upper bound for numeric defaults; omitted means "no bound". */
    max?: number;
    /** Increment for numeric defaults; must be positive when present. */
    step?: number;
}

/** One declared function input or output. */
export interface FunctionPort {
    /** Stable, index-derived connector identifier (`in_0`, `out_0`, …). */
    id: string;
    /** Free-text port name; trimmed, at most {@link MAX_FUNCTION_PORT_NAME_LENGTH} characters. */
    name: string;
    /** Allowed connector data types; never empty, `['any']` means "every type". */
    types: string[];
    /**
     * Default value of the parameter; present on every input port (synthesized when
     * absent) and never on an output port.
     */
    default?: FunctionPortDefault;
    /**
     * Free-form Markdown documentation of the port; trimmed, omitted when empty.
     *
     * Shown as rendered Markdown in the settings row and carried into the generated
     * node definition's connector description (palette node-info view). Inner line
     * breaks are preserved; only surrounding whitespace is removed.
     */
    documentation?: string;
}

/**
 * How one port list moved during a signature edit.
 *
 * Port ids are index-derived, so they cannot identify a port across a reorder or a
 * removal. Only the mutation that changed the list knows where each old connector
 * went, which is why `NodeGraph` records the mapping in the signature-change
 * payload instead of leaving callers to guess from names.
 */
export interface FunctionPortIndexMapping {
    /** Which port list the mapping describes. */
    kind: FunctionPortKind;
    /**
     * New index per old index, in the *old* declaration order.
     *
     * `fromOldToNew[3] === 1` means the port that used to sit at index 3 now sits at
     * index 1; `null` means that port was removed, so its wiring has no destination.
     */
    fromOldToNew: Array<number | null>;
}

/** The complete function interface of a graph. */
export interface FunctionSignature {
    /** Palette category of the generated node; defaults to {@link DEFAULT_FUNCTION_CATEGORY}. */
    category: string;
    /** Header icon of the generated call node; defaults to {@link DEFAULT_FUNCTION_ICON}. */
    icon: string;
    /**
     * Free-form Markdown description of what the function does; trimmed, omitted
     * when empty.
     *
     * Rendered as Markdown in the settings block and carried into the generated
     * node definition's `info` field so the palette node-info view can show it.
     * Inner line breaks are preserved; only surrounding whitespace is removed.
     */
    description?: string;
    /** Declared inputs, in emitted parameter order. */
    inputs: FunctionPort[];
    /** Declared outputs, in returned-tuple order. */
    outputs: FunctionPort[];
}

/** Maximum number of input ports and, separately, of output ports. */
export const MAX_FUNCTION_PORTS = 32;

/** Maximum length of a port name, in characters. */
export const MAX_FUNCTION_PORT_NAME_LENGTH = 64;

/** Category used when a function graph does not declare one. */
export const DEFAULT_FUNCTION_CATEGORY = 'function';

/**
 * Icon used when a function graph does not declare one.
 *
 * The value uses the semantic `<set>:<name>` form the view system resolves, never a
 * resolved `data:` URI, so it stays stable and user-editable in storage.
 */
export const DEFAULT_FUNCTION_ICON = 'mdi:function';

/**
 * Node color of generated call nodes and of the structural function nodes.
 *
 * This is the function-graph tab's broken-white ramp darker stop
 * (`rgba(131, 126, 115)`), which keeps the white node text readable. One shared
 * constant keeps call and structural nodes visually identical.
 */
export const FUNCTION_NODE_COLOR = '#837e73';

/** Prefix of the generated node type id of a function graph. */
export const FUNCTION_NODE_TYPE_PREFIX = 'function_graph.';

/**
 * Build the connector identifier of a port from its kind and position.
 *
 * The id is index-derived because connections address connectors by index; a
 * rename must therefore never move a connector.
 *
 * @param kind - Port side.
 * @param index - Zero-based position inside the port list.
 * @returns `in_<index>` or `out_<index>`.
 */
export function createFunctionPortId(kind: FunctionPortKind, index: number): string {
    const normalizedIndex = Number.isFinite(index) ? Math.max(0, Math.trunc(Number(index))) : 0;
    return `${kind === 'output' ? 'out' : 'in'}_${normalizedIndex}`;
}

/**
 * Normalize a port's declared data types.
 *
 * Delegates the per-type validation to {@link normalizeAllowedTypes} and then
 * applies the union rules: duplicates are dropped, an empty selection becomes
 * `['any']`, and `'any'` collapses the whole selection to `['any']` because
 * `any` already accepts every concrete type. Unusable entries are ignored rather
 * than thrown, so a stale serialized graph still loads.
 *
 * @param types - Raw type ids from storage or the settings view.
 * @returns Non-empty, de-duplicated type ids in declaration order.
 */
export function normalizeFunctionPortTypes(types: unknown): string[] {
    if (!Array.isArray(types)) {
        return ['any'];
    }

    const normalized: string[] = [];
    for (const value of types) {
        if (typeof value !== 'string') {
            continue;
        }
        let validated: string[];
        try {
            validated = normalizeAllowedTypes([value]);
        } catch {
            continue;
        }
        for (const typeId of validated) {
            if (!normalized.includes(typeId)) {
                normalized.push(typeId);
            }
        }
    }

    if (normalized.length === 0 || normalized.includes('any')) {
        return ['any'];
    }
    return normalized;
}

/** Data type ids that accept numeric bounds and use a `number` default control. */
export const NUMERIC_FUNCTION_PORT_TYPES: readonly string[] = ['int', 'float', 'double'];

/**
 * Whether a data type id accepts numeric bounds.
 * @param type - Candidate data type id.
 * @returns True for `int`, `float` and `double`.
 */
export function isNumericFunctionPortType(type: unknown): boolean {
    return (
        typeof type === 'string' &&
        (NUMERIC_FUNCTION_PORT_TYPES as readonly string[]).includes(type)
    );
}

/**
 * Resolve the control type a port default uses on the generated call node.
 *
 * Mirrors the node-package convention: numeric types use a `number` editor (with the
 * port's min/max/step), `bool` a `checkbox`, and every other type a `text` editor.
 *
 * @param type - Data type of the default value.
 * @returns `'number'`, `'checkbox'` or `'text'`.
 */
export function resolveFunctionPortDefaultControlType(
    type: unknown
): 'number' | 'checkbox' | 'text' {
    if (isNumericFunctionPortType(type)) {
        return 'number';
    }
    if (type === 'bool') {
        return 'checkbox';
    }
    return 'text';
}

/**
 * Coerce a stored default value into the shape its data type requires.
 *
 * @param type - Data type of the default.
 * @param value - Raw stored value.
 * @param min - Optional lower bound; numeric values are clamped to it.
 * @param max - Optional upper bound; numeric values are clamped to it.
 * @returns A value of the matching family: number, boolean or string.
 */
function coerceFunctionPortDefaultValue(
    type: string,
    value: unknown,
    min?: number,
    max?: number
): unknown {
    if (isNumericFunctionPortType(type)) {
        let numeric = typeof value === 'number' && Number.isFinite(value) ? value : Number(value);
        if (!Number.isFinite(numeric)) {
            numeric = 0;
        }
        if (type === 'int') {
            numeric = Math.trunc(numeric);
        }
        if (typeof min === 'number' && Number.isFinite(min)) {
            numeric = Math.max(numeric, min);
        }
        if (typeof max === 'number' && Number.isFinite(max)) {
            numeric = Math.min(numeric, max);
        }
        return numeric;
    }
    if (type === 'bool') {
        if (typeof value === 'boolean') {
            return value;
        }
        if (typeof value === 'string') {
            return value === 'true' || value === '1';
        }
        if (typeof value === 'number') {
            return value !== 0;
        }
        return false;
    }
    return value === undefined || value === null ? '' : String(value);
}

/**
 * Normalize the default value of one port.
 *
 * The default type must be one of the port's declared types, otherwise it falls back to
 * the first declared type. The value is re-coerced to that type, and — for numeric
 * types — bounds are kept only when finite, `step` only when positive, and an inverted
 * `min`/`max` pair is dropped.
 *
 * @param value - Raw `default` object from storage or the settings view.
 * @param types - Normalized type ids the port declares.
 * @returns The normalized default, or `undefined` when the port declares no usable type.
 */
export function normalizeFunctionPortDefault(
    value: unknown,
    types: readonly string[]
): FunctionPortDefault | undefined {
    if (!Array.isArray(types) || types.length === 0) {
        return undefined;
    }
    const record = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
    const chosenType =
        typeof record.type === 'string' && types.includes(record.type) ? record.type : types[0];

    let min: number | undefined;
    let max: number | undefined;
    let step: number | undefined;
    if (isNumericFunctionPortType(chosenType)) {
        const finite = (entry: unknown): number | undefined =>
            typeof entry === 'number' && Number.isFinite(entry) ? entry : undefined;
        min = finite(record.min);
        max = finite(record.max);
        step = finite(record.step);
        if (step !== undefined && step <= 0) {
            step = undefined;
        }
        if (min !== undefined && max !== undefined && min > max) {
            min = undefined;
            max = undefined;
        }
    }

    return {
        type: chosenType,
        value: coerceFunctionPortDefaultValue(chosenType, record.value, min, max),
        ...(min !== undefined ? { min } : {}),
        ...(max !== undefined ? { max } : {}),
        ...(step !== undefined ? { step } : {}),
    };
}

/**
 * Resolve the effective default of a port, synthesizing the type's zero value when none
 * is stored.
 *
 * Normalized input ports always carry a default, but builders may also be handed raw
 * ports, so this keeps them independent of the normalizer.
 *
 * @param port - Declared port.
 * @returns The stored default or a synthesized one.
 */
export function resolveFunctionPortDefault(port: FunctionPort): FunctionPortDefault {
    if (port.default && typeof port.default === 'object') {
        return port.default;
    }
    const types = port.types.length > 0 ? port.types : ['any'];
    return normalizeFunctionPortDefault({ type: types[0] }, types) ?? { type: 'any', value: '' };
}

/**
 * Order a port's allowed types so the default type is first.
 *
 * The first `allowedTypes` entry is the connector's representative type, so this is how
 * the signature's default type becomes the connector's initial type without narrowing the
 * accepted types.
 *
 * @param port - Declared port.
 * @returns Non-empty type list with the default type leading.
 */
export function buildFunctionPortAllowedTypes(port: FunctionPort): string[] {
    const types = port.types.length > 0 ? port.types : ['any'];
    const primary = resolveFunctionPortDefault(port).type;
    const remaining = types.filter((type) => type !== primary);
    return [primary, ...remaining];
}

/** The shape of a generated input default control, matching node-package `defaultControl`. */
export interface FunctionInputDefaultControl {
    /** Control type: `number`, `checkbox` or `text`. */
    type: string;
    /** Port name shown next to the value editor; omitted for unnamed ports. */
    label?: string;
    /** Default value emitted when the input is not wired. */
    default: unknown;
    /** Numeric lower bound. */
    min?: number;
    /** Numeric upper bound. */
    max?: number;
    /** Numeric increment. */
    step?: number;
}

/**
 * Build the input default control the generated call node mirrors for one port.
 *
 * @param port - Declared input port.
 * @returns A `defaultControl` payload ready for a node definition.
 */
export function buildFunctionInputDefaultControl(port: FunctionPort): FunctionInputDefaultControl {
    const defaultValue = resolveFunctionPortDefault(port);
    const controlType = resolveFunctionPortDefaultControlType(defaultValue.type);
    const control: FunctionInputDefaultControl = {
        type: controlType,
        default: defaultValue.value,
    };
    if (port.name) {
        control.label = port.name;
    }
    if (controlType === 'number') {
        if (defaultValue.min !== undefined) {
            control.min = defaultValue.min;
        }
        if (defaultValue.max !== undefined) {
            control.max = defaultValue.max;
        }
        if (defaultValue.step !== undefined) {
            control.step = defaultValue.step;
        }
    }
    return control;
}

/**
 * Normalize a port name for storage.
 *
 * Trims surrounding whitespace, collapses inner runs of whitespace to one space
 * and truncates to {@link MAX_FUNCTION_PORT_NAME_LENGTH}. The name is display
 * text, so case and inner characters are preserved.
 *
 * @param name - Raw name from storage or user input.
 * @returns The trimmed, length-limited name; `''` when nothing is left.
 */
export function normalizeFunctionPortName(name: unknown): string {
    if (typeof name !== 'string') {
        return '';
    }
    const collapsed = name.replace(/\s+/g, ' ').trim();
    return collapsed.slice(0, MAX_FUNCTION_PORT_NAME_LENGTH);
}

/**
 * Turn a port name into the identifier fragment used in emitted parameter names.
 *
 * Mirrors `sanitizeGraphFunctionName` in `proc/transpiler-helpers.ts`: lower case,
 * everything outside `[a-z0-9_]` collapses to `_`, leading/trailing `_` are
 * dropped. Umlauts and other non-ASCII characters are therefore removed instead
 * of being transliterated — the emitted name only has to be stable and legal.
 *
 * @param name - Port name, normalized or raw.
 * @returns Lower-case identifier fragment; `''` when the name has no usable characters.
 */
export function sanitizeFunctionPortName(name: unknown): string {
    const base = normalizeFunctionPortName(name);
    return base
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, '_')
        .replace(/^_+/, '')
        .replace(/_+$/, '');
}

/**
 * Normalize one declared port.
 *
 * The id is always re-derived from the position instead of being copied from the
 * payload: the list is positional, so inserting, moving or removing a port
 * renumbers the connectors behind it and the caller repairs the affected
 * connections (D6). Unknown shapes degrade to an empty, `any`-typed port.
 *
 * @param value - Raw port from storage or the settings view.
 * @param kind - Port side the port belongs to.
 * @param index - Zero-based position inside the port list.
 * @returns A port with an index-derived id, a normalized name and non-empty types.
 */
export function normalizeFunctionPort(
    value: unknown,
    kind: FunctionPortKind,
    index: number
): FunctionPort {
    const data = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
    const port: FunctionPort = {
        id: createFunctionPortId(kind, index),
        name: normalizeFunctionPortName(data.name),
        types: normalizeFunctionPortTypes(data.types),
    };

    // Inputs carry a default so the generated call node offers an inline value editor;
    // outputs are results and never carry one.
    if (kind === 'input') {
        const defaultValue = normalizeFunctionPortDefault(data.default, port.types);
        if (defaultValue) {
            port.default = defaultValue;
        }
    }

    // Port documentation is free-form Markdown; only a non-empty, trimmed value is stored.
    const documentation = normalizeFunctionDescription(data.documentation);
    if (documentation) {
        port.documentation = documentation;
    }

    return port;
}

/**
 * Normalize one port list and truncate it to {@link MAX_FUNCTION_PORTS}.
 *
 * @param value - Raw port list from storage or the settings view.
 * @param kind - Port side the list describes.
 * @returns The normalized ports in their declared order; `[]` for non-arrays.
 */
export function normalizeFunctionPorts(value: unknown, kind: FunctionPortKind): FunctionPort[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .slice(0, MAX_FUNCTION_PORTS)
        .map((port, index) => normalizeFunctionPort(port, kind, index));
}

/**
 * Normalize the palette category of a function node.
 *
 * Reuses the port-name normalization (trim, collapse whitespace, length limit)
 * and falls back to {@link DEFAULT_FUNCTION_CATEGORY} when nothing remains.
 *
 * @param value - Raw category from storage or the settings view.
 * @returns A non-empty category name.
 */
export function normalizeFunctionCategory(value: unknown): string {
    return normalizeFunctionPortName(value) || DEFAULT_FUNCTION_CATEGORY;
}

/**
 * Normalize the header icon of a function node.
 *
 * Mirrors `IconControlUi`'s never-reject rule: the value is trimmed and every
 * non-empty string is kept, so foreign icon sets (`ph:`, `hue:`, …) stay usable.
 * Only missing or blank values fall back to {@link DEFAULT_FUNCTION_ICON}.
 *
 * @param value - Raw icon from storage or the settings view.
 * @returns A non-empty semantic icon string (`<set>:<name>`).
 */
export function normalizeFunctionIcon(value: unknown): string {
    return String(value ?? '').trim() || DEFAULT_FUNCTION_ICON;
}

/**
 * Normalize free-form Markdown documentation for storage.
 *
 * Unlike {@link normalizeFunctionPortName}, this only trims surrounding
 * whitespace: Markdown line breaks and inner spacing are significant and must
 * be preserved. Non-string or blank values normalize to `''`.
 *
 * @param value - Raw documentation from storage or the settings view.
 * @returns The trimmed documentation; `''` when nothing remains.
 */
export function normalizeFunctionDescription(value: unknown): string {
    return String(value ?? '').trim();
}

/**
 * Create the signature of a graph that declares no ports.
 * @returns A signature with the default category, the default icon and two empty port lists.
 */
export function createEmptyFunctionSignature(): FunctionSignature {
    return {
        category: DEFAULT_FUNCTION_CATEGORY,
        icon: DEFAULT_FUNCTION_ICON,
        inputs: [],
        outputs: [],
    };
}

/**
 * Normalize a stored signature.
 *
 * Values come from collection storage, so unknown shapes must not throw: anything
 * unusable degrades to {@link createEmptyFunctionSignature} defaults.
 *
 * @param value - Raw signature from storage.
 * @returns A signature whose category and icon are non-empty and whose ports are normalized.
 */
export function normalizeFunctionSignature(value: unknown): FunctionSignature {
    const data = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
    const signature: FunctionSignature = {
        category: normalizeFunctionCategory(data.category),
        icon: normalizeFunctionIcon(data.icon),
        inputs: normalizeFunctionPorts(data.inputs, 'input'),
        outputs: normalizeFunctionPorts(data.outputs, 'output'),
    };
    const description = normalizeFunctionDescription(data.description);
    if (description) {
        signature.description = description;
    }
    return signature;
}

/**
 * Test whether a signature declares nothing a user could notice.
 *
 * A signature counts as non-empty as soon as a port is declared, the category
 * differs from the default, the icon differs from the default or a description is
 * present, so a customized category, icon or description is never dropped on
 * serialization.
 *
 * @param value - Raw or normalized signature.
 * @returns True when the signature carries only defaults.
 */
export function isEmptyFunctionSignature(value: unknown): boolean {
    const signature = normalizeFunctionSignature(value);
    return (
        signature.category === DEFAULT_FUNCTION_CATEGORY &&
        signature.icon === DEFAULT_FUNCTION_ICON &&
        normalizeFunctionDescription(signature.description) === '' &&
        signature.inputs.length === 0 &&
        signature.outputs.length === 0
    );
}

/**
 * Build the Python parameter list of a function graph.
 *
 * Names are positional (`_in<index>_<fragment>`) so a rename can never change
 * the call signature of an already transpiled caller, and the index keeps
 * duplicate display names distinct. Ports whose name has no identifier
 * characters fall back to `_in<index>`. Output ports are never parameters, so
 * only the input list is accepted here.
 *
 * @param inputs - Raw or normalized input ports.
 * @returns One parameter name per input port, in declaration order.
 */
export function buildFunctionParameterNames(inputs: unknown): string[] {
    const ports = normalizeFunctionPorts(inputs, 'input');
    const usedNames = new Set<string>();

    return ports.map((port, index) => {
        const fragment = sanitizeFunctionPortName(port.name);
        const baseName = fragment ? `_in${index}_${fragment}` : `_in${index}`;
        let name = baseName;
        let suffix = 2;
        while (usedNames.has(name)) {
            name = `${baseName}_${suffix}`;
            suffix += 1;
        }
        usedNames.add(name);
        return name;
    });
}

/**
 * Build the generated node type id of a function graph.
 *
 * @param graphId - Id of the graph that owns the function.
 * @returns `function_graph.<graphId>`.
 * @throws {TypeError} When the graph id is missing or blank.
 */
export function buildFunctionNodeTypeId(graphId: unknown): string {
    if (typeof graphId !== 'string' || graphId.trim().length === 0) {
        throw new TypeError('A function node type id requires a non-empty graph id.');
    }
    return `${FUNCTION_NODE_TYPE_PREFIX}${graphId.trim()}`;
}
