import { resolveNodeWidth } from './node-width.js';
import { resolveDeclaredInputSources } from './type-conversions.js';

type LocalizedValue = string | Record<string, string>;

type RuntimeNodeTypeInput = {
    id: string;
    name: LocalizedValue;
    icon?: string;
    defaultControl?: unknown;
    allowedTypes?: string[];
    initialTypes?: string[];
};

type RuntimeNodeTypeOutput = {
    id: string;
    name: LocalizedValue;
    icon?: string;
    outputType?: string;
    outputTypeControl?: string;
    outputTypeByControlValue?: Record<string, unknown>;
    initialTypes?: string[];
};

type RuntimeControlValueMigration = {
    fromControl?: string;
    entry?: unknown;
};

type RuntimeNodeTypeControl = {
    id: string;
    type: string;
    layout?: unknown;
    label: LocalizedValue;
    defaultValue?: unknown;
    /**
     * Value used for a node saved before this control existed (see
     * `buildControlValuesForRuntimeSnapshot`). A scalar control's `default` would
     * otherwise rewrite the meaning of every node that never had the control.
     */
    legacyDefault?: unknown;
    min?: number;
    max?: number;
    step?: number;
    options?: unknown[];
    getOptions?: () => unknown[];
    affectsControls?: unknown;
    affectsInputs?: unknown;
    affectsOutputs?: unknown;
    dynamicOptions?: unknown;
    maxVisibleItems?: number;
    valueMigration?: RuntimeControlValueMigration;
    definition?: {
        valueMigration?: RuntimeControlValueMigration;
        legacyDefault?: unknown;
    } & Record<string, unknown>;
};

type RuntimeNodeType = {
    title?: LocalizedValue;
    icon?: string;
    color?: string;
    defaultWidth?: number;
    minWidth?: number;
    maxWidth?: number;
    inputs?: RuntimeNodeTypeInput[];
    outputs?: RuntimeNodeTypeOutput[];
    controls?: RuntimeNodeTypeControl[];
};

type RuntimeNode = {
    id?: unknown;
    type?: unknown;
    width?: unknown;
    icon?: unknown;
    color?: unknown;
    typeName?: unknown;
    controls?: unknown;
    inputs?: unknown;
    outputs?: unknown;
    controlValues?: unknown;
    inputDefaults?: unknown;
};

type RuntimeNodePatch = {
    nodeId: string;
    patch: {
        typeName: LocalizedValue;
        icon?: string;
        color?: string;
        inputs: unknown[];
        outputs: unknown[];
        controls: unknown[];
        controlValues: Record<string, unknown>;
        inputDefaults: Record<string, unknown>;
        width: number;
    };
};

type RuntimeNodePatchDiagnostic = {
    nodeId: string;
    typeId: string;
    changedFields: string[];
    details: Record<string, unknown>;
};

function toStableValue(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map((item) => toStableValue(item));
    }
    if (value && typeof value === 'object') {
        const source = value as Record<string, unknown>;
        const result: Record<string, unknown> = {};
        Object.keys(source)
            .sort()
            .forEach((key) => {
                result[key] = toStableValue(source[key]);
            });
        return result;
    }
    return value;
}

function normalizeOutputsForComparison(outputs: unknown): unknown[] {

    if (!Array.isArray(outputs)) {
        return [];
    }

    return outputs.map((output) => {
        const source = output && typeof output === 'object' ? (output as Record<string, unknown>) : {};

        const normalized: Record<string, unknown> = {
            id: source.id,
            name: cloneLocalizedValue(source.name),
            icon: normalizeLegacyRuntimePath(source.icon),
        };

        if (Array.isArray(source.initialTypes)) {
            normalized.initialTypes = [...source.initialTypes];
        }

        if (typeof source.outputTypeControl === 'string' && source.outputTypeControl.trim()) {
            normalized.outputTypeControl = source.outputTypeControl;
        }

        if (
            source.outputTypeByControlValue &&
            typeof source.outputTypeByControlValue === 'object'
        ) {
            normalized.outputTypeByControlValue = toStableValue(source.outputTypeByControlValue);
        }

        const typeInputSources = resolveDeclaredInputSources(source);
        if (typeInputSources.length > 0) {
            normalized.typeInputSources = typeInputSources;
        }

        const hasControlDrivenTyping =
            typeof normalized.outputTypeControl === 'string' ||
            Boolean(normalized.outputTypeByControlValue);
        const hasUnionTyping = Array.isArray(normalized.typeInputSources);

        // A union output keeps its declared representative outputType. Dynamic
        // control-driven outputs resolve theirs from the selected option instead.
        if (
            (!hasControlDrivenTyping || hasUnionTyping) &&
            typeof source.outputType === 'string' &&
            source.outputType.trim()
        ) {
            normalized.outputType = source.outputType;
        }

        return toStableValue(normalized);
    });
}

function normalizeLegacyRuntimePath(value: unknown): unknown {
    if (typeof value !== 'string') {
        return value;
    }
    if (value.startsWith('/runtime/')) {
        return `/device${value}`;
    }
    if (value.startsWith('runtime/')) {
        return `/device/${value}`;
    }
    return value;
}

function normalizeNodeId(value: unknown): string | null {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed || null;
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value);
    }

    return null;
}

function cloneLocalizedValue(value: unknown): unknown {
    if (typeof value === 'string') {
        return value;
    }
    if (typeof value === 'object' && value !== null) {
        return { ...value };
    }
    return String(value);
}

export function buildRuntimeNodeTypeSnapshot(nodeType: RuntimeNodeType, typeId: string) {
    const controls =
        nodeType.controls?.map((control) => ({
            id: control.id,
            type: control.type,
            layout: control.layout,
            label: cloneLocalizedValue(control.label),
            default: control.defaultValue,
            min: control.min,
            max: control.max,
            step: control.step,
            options: control.getOptions ? control.getOptions() : control.options,
            affectsControls: control.affectsControls,
            affectsInputs: control.affectsInputs,
            affectsOutputs: control.affectsOutputs,
            dynamicOptions: control.dynamicOptions,
            maxVisibleItems: control.maxVisibleItems,
            valueMigration: control.definition?.valueMigration ?? control.valueMigration,
            legacyDefault: control.definition?.legacyDefault ?? control.legacyDefault,
        })) || [];

    return {
        typeName: (nodeType.title || typeId) as LocalizedValue,
        icon: normalizeLegacyRuntimePath(nodeType.icon) as string | undefined,
        color: nodeType.color,
        inputs:
            nodeType.inputs?.map((input) => {
                const mappedInput: {
                    id: string;
                    name: unknown;
                    icon?: string;
                    allowedTypes?: string[];
                    initialTypes?: string[];
                    defaultControl?: unknown;
                } = {
                    id: input.id,
                    name: cloneLocalizedValue(input.name),
                    icon: normalizeLegacyRuntimePath(input.icon) as string | undefined,
                };
                if (Array.isArray((input as RuntimeNodeTypeInput).allowedTypes)) {
                    mappedInput.allowedTypes = [...(input as RuntimeNodeTypeInput).allowedTypes!];
                }
                if (Array.isArray((input as RuntimeNodeTypeInput).initialTypes)) {
                    mappedInput.initialTypes = [...(input as RuntimeNodeTypeInput).initialTypes!];
                }
                if (input.defaultControl) {
                    mappedInput.defaultControl = input.defaultControl;
                }
                return mappedInput;
            }) || [],
        outputs:
            nodeType.outputs?.map((output) => {
                const mappedOutput: {
                    id: string;
                    name: unknown;
                    icon?: string;
                    outputType?: string;
                    outputTypeControl?: string;
                    outputTypeByControlValue?: Record<string, unknown>;
                    typeInputSources?: string[];
                    initialTypes?: string[];
                } = {
                    id: output.id,
                    name: cloneLocalizedValue(output.name),
                    icon: normalizeLegacyRuntimePath(output.icon) as string | undefined,
                };

                if (typeof output.outputType === 'string') {
                    mappedOutput.outputType = output.outputType;
                }
                if (Array.isArray(output.initialTypes)) {
                    mappedOutput.initialTypes = [...output.initialTypes];
                }
                if (typeof output.outputTypeControl === 'string') {
                    mappedOutput.outputTypeControl = output.outputTypeControl;
                }
                if (
                    output.outputTypeByControlValue &&
                    typeof output.outputTypeByControlValue === 'object'
                ) {
                    mappedOutput.outputTypeByControlValue = {
                        ...output.outputTypeByControlValue,
                    };
                }
                const typeInputSources = resolveDeclaredInputSources(output);
                if (typeInputSources.length > 0) {
                    mappedOutput.typeInputSources = typeInputSources;
                }

                return mappedOutput;
            }) || [],
        controls,
    };
}

function normalizeControlValueList(value: unknown): string[] {
    const raw = Array.isArray(value)
        ? value
        : typeof value === 'string'
          ? value.split(',')
          : value === undefined || value === null
            ? []
            : [value];
    const ids: string[] = [];

    raw.forEach((entry) => {
        const id = String(entry ?? '').trim();
        if (id && !ids.includes(id)) {
            ids.push(id);
        }
    });

    return ids;
}

function cloneControlDefault(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map((entry) => cloneControlDefault(entry));
    }
    if (value && typeof value === 'object') {
        return { ...(value as Record<string, unknown>) };
    }
    return value;
}

/**
 * Build the control values for one node of a runtime definition snapshot.
 *
 * A control may declare `valueMigration: { fromControl, entry }` to absorb a legacy
 * boolean control into a list control. The legacy key is dropped because only ids that
 * still exist in the definition survive.
 *
 * A control may also declare `legacyDefault` for the case where the control is **new to
 * this node type**: a node saved before the control existed gets that value instead of
 * `default`, so loading an old collection cannot silently change its behaviour. The
 * snapshot of the node's saved controls (`existingControls`) is what tells the two
 * cases apart — omit it and every control falls back to `default`, which is the
 * node-creation path.
 *
 * Precedence: a stored value always wins, then `legacyDefault`, then `default`.
 *
 * @param controls - Controls of the current definition snapshot.
 * @param existingControlValues - Values stored on the node.
 * @param existingControls - Controls the node was saved with (its own snapshot), or
 *   `undefined` when the node is being created from the current definition.
 * @returns Values limited to the current controls, with legacy controls migrated.
 */
export function buildControlValuesForRuntimeSnapshot(
    controls: Array<{
        id: string;
        default?: unknown;
        legacyDefault?: unknown;
        valueMigration?: RuntimeControlValueMigration;
    }>,
    existingControlValues: unknown = {},
    existingControls?: unknown
): Record<string, unknown> {
    const sourceValues =
        existingControlValues && typeof existingControlValues === 'object'
            ? (existingControlValues as Record<string, unknown>)
            : {};
    const migratedValues: Record<string, unknown> = { ...sourceValues };
    const savedControlIds = Array.isArray(existingControls)
        ? new Set(
              existingControls
                  .map((control: unknown) =>
                      control && typeof control === 'object'
                          ? (control as { id?: unknown }).id
                          : undefined
                  )
                  .filter((id): id is string => typeof id === 'string' && id.length > 0)
          )
        : null;

    controls.forEach((control) => {
        const migration = control.valueMigration;
        const fromControl = migration?.fromControl;
        if (!fromControl || !Object.prototype.hasOwnProperty.call(sourceValues, fromControl)) {
            return;
        }

        const entry =
            migration?.entry === undefined || migration?.entry === null
                ? ''
                : String(migration.entry);
        const current = normalizeControlValueList(migratedValues[control.id]);
        const withoutEntry = entry ? current.filter((value) => value !== entry) : current;
        migratedValues[control.id] = sourceValues[fromControl]
            ? entry
                ? [entry, ...withoutEntry]
                : withoutEntry
            : withoutEntry;
    });

    const nextControlValues: Record<string, unknown> = {};

    controls.forEach((control) => {
        if (Object.prototype.hasOwnProperty.call(migratedValues, control.id)) {
            nextControlValues[control.id] = migratedValues[control.id];
            return;
        }

        // The node was saved before this control existed: seed `legacyDefault` so the new
        // control keeps the behaviour the node had without it.
        const seedLegacyDefault =
            savedControlIds !== null &&
            !savedControlIds.has(control.id) &&
            control.legacyDefault !== undefined &&
            control.legacyDefault !== null;
        const fallback = seedLegacyDefault ? control.legacyDefault : control.default;

        if (fallback !== undefined && fallback !== null) {
            nextControlValues[control.id] = cloneControlDefault(fallback);
        }
    });

    return nextControlValues;
}

export function filterRuntimeInputDefaults(
    inputs: Array<{ id: string }>,
    existingInputDefaults: unknown = {}
): Record<string, unknown> {
    const nextInputDefaults: Record<string, unknown> = {};
    const sourceDefaults =
        existingInputDefaults && typeof existingInputDefaults === 'object'
            ? (existingInputDefaults as Record<string, unknown>)
            : {};
    const allowedInputIds = new Set(inputs.map((input) => input.id));

    Object.keys(sourceDefaults).forEach((inputId) => {
        if (allowedInputIds.has(inputId)) {
            nextInputDefaults[inputId] = sourceDefaults[inputId];
        }
    });

    return nextInputDefaults;
}

export function collectRuntimeDefinitionNodePatches({
    nodes,
    getNodeType,
}: {
    nodes: RuntimeNode[];
    getNodeType: (typeId: string) => RuntimeNodeType | null;
}): {
    patches: RuntimeNodePatch[];
    updatedNodeIds: string[];
    diagnostics: RuntimeNodePatchDiagnostic[];
} {
    const patches: RuntimeNodePatch[] = [];
    const updatedNodeIds: string[] = [];
    const diagnostics: RuntimeNodePatchDiagnostic[] = [];

    nodes.forEach((node) => {
        const nodeId = normalizeNodeId(node?.id);
        const typeId = typeof node?.type === 'string' ? node.type : '';
        if (!nodeId || !typeId) {
            return;
        }

        const nodeType = getNodeType(typeId);
        if (!nodeType) {
            return;
        }

        const snapshot = buildRuntimeNodeTypeSnapshot(nodeType, typeId);
        const currentControls = Array.isArray(node.controls) ? node.controls : [];
        const nextControlValues = buildControlValuesForRuntimeSnapshot(
            snapshot.controls,
            node.controlValues,
            currentControls
        );
        const nextInputDefaults = filterRuntimeInputDefaults(snapshot.inputs, node.inputDefaults);

        const currentInputs = Array.isArray(node.inputs) ? node.inputs : [];

        const currentOutputs = Array.isArray(node.outputs) ? node.outputs : [];
        const currentControlValues =
            node.controlValues && typeof node.controlValues === 'object' ? node.controlValues : {};
        const currentInputDefaults =
            node.inputDefaults && typeof node.inputDefaults === 'object' ? node.inputDefaults : {};
        const resolvedWidth = resolveNodeWidth({
            instanceWidth: node.width as number,
            defaultWidth: nodeType.defaultWidth,
            minWidth: nodeType.minWidth,
            maxWidth: nodeType.maxWidth,
        });

        const controlsChanged =
            JSON.stringify(currentControls) !== JSON.stringify(snapshot.controls);
        const inputsChanged = JSON.stringify(currentInputs) !== JSON.stringify(snapshot.inputs);
        const currentOutputsComparable = normalizeOutputsForComparison(currentOutputs);
        const snapshotOutputsComparable = normalizeOutputsForComparison(snapshot.outputs);
        const outputsChanged =
            JSON.stringify(currentOutputsComparable) !== JSON.stringify(snapshotOutputsComparable);
        const controlValuesChanged =
            JSON.stringify(currentControlValues) !== JSON.stringify(nextControlValues);
        const inputDefaultsChanged =
            JSON.stringify(currentInputDefaults) !== JSON.stringify(nextInputDefaults);
        const typeNameChanged = JSON.stringify(node.typeName) !== JSON.stringify(snapshot.typeName);
        const iconChanged = (node.icon || null) !== (snapshot.icon || null);
        const colorChanged = (node.color || '') !== (snapshot.color || '');
        const widthChanged = node.width !== resolvedWidth;

        if (
            !controlsChanged &&
            !inputsChanged &&
            !outputsChanged &&
            !controlValuesChanged &&
            !inputDefaultsChanged &&
            !typeNameChanged &&
            !iconChanged &&
            !colorChanged &&
            !widthChanged
        ) {
            return;
        }

        const changedFields: string[] = [];
        if (controlsChanged) {
            changedFields.push('controls');
        }
        if (inputsChanged) {
            changedFields.push('inputs');
        }
        if (outputsChanged) {
            changedFields.push('outputs');
        }
        if (controlValuesChanged) {
            changedFields.push('controlValues');
        }
        if (inputDefaultsChanged) {
            changedFields.push('inputDefaults');
        }
        if (typeNameChanged) {
            changedFields.push('typeName');
        }
        if (iconChanged) {
            changedFields.push('icon');
        }
        if (colorChanged) {
            changedFields.push('color');
        }
        if (widthChanged) {
            changedFields.push('width');
        }

        diagnostics.push({
            nodeId,
            typeId,
            changedFields,
            details: {
                currentTypeName: node.typeName,
                snapshotTypeName: snapshot.typeName,
                currentIcon: node.icon,
                snapshotIcon: snapshot.icon,
                currentColor: node.color,
                snapshotColor: snapshot.color,
                currentWidth: node.width,
                snapshotWidth: resolvedWidth,
            },
        });

        patches.push({
            nodeId,
            patch: {
                typeName: snapshot.typeName,
                icon: snapshot.icon,
                color: snapshot.color,
                inputs: snapshot.inputs,
                outputs: snapshot.outputs,
                controls: snapshot.controls,
                controlValues: nextControlValues,
                inputDefaults: nextInputDefaults,
                width: resolvedWidth,
            },
        });
        updatedNodeIds.push(nodeId);
    });

    return { patches, updatedNodeIds, diagnostics };
}
