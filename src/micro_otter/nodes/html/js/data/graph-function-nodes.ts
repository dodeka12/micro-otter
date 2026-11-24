// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file Structural input/output node descriptors for function graphs.
 *
 * A function graph may contain two optional structural nodes: an **input** node
 * whose output connectors are the declared inputs, and an **output** node whose
 * input connectors are the declared outputs. Neither is a runtime node type —
 * they never reach `DeviceRuntime.getNodeType`, the transpiler's runtime lookup
 * or the capability validators — they exist only to mirror the signature stored
 * on the graph onto the canvas.
 *
 * Connector descriptors are derived from the signature on every call, so the
 * node payload and the connector patch used for synchronization cannot drift
 * apart. The descriptor id is the port id (`in_0`, `out_0`, …), so renaming a
 * port never moves a connector.
 *
 * @module data/graph-function-nodes
 */

import NodeData from './node-data.js';
import { resolveNodeWidth } from './node-width.js';
import { isFunctionNodeTypeId } from './function-node-definition.js';
import { IconProvider } from '../views/icon-provider.js';
import {
    FUNCTION_NODE_COLOR,
    buildFunctionInputDefaultControl,
    buildFunctionPortAllowedTypes,
    createFunctionPortId,
} from './graph-function-signature.js';
import type {
    FunctionInputDefaultControl,
    FunctionPort,
    FunctionPortKind,
    FunctionSignature,
} from './graph-function-signature.js';

/** Node type id of the structural input node (signature inputs as outputs). */
export const FUNCTION_INPUT_NODE_TYPE = 'graph.function.input';

/** Node type id of the structural output node (signature outputs as inputs). */
export const FUNCTION_OUTPUT_NODE_TYPE = 'graph.function.output';

/** Both structural node type ids, in palette order. */
export const FUNCTION_STRUCTURAL_NODE_TYPES: readonly string[] = [
    FUNCTION_INPUT_NODE_TYPE,
    FUNCTION_OUTPUT_NODE_TYPE,
];

/** Gap between a structural node and the nearest regular node, in world units. */
export const FUNCTION_STRUCTURAL_NODE_GAP = 40;

/** Fixed placement used when the graph has no other nodes yet. */
const FUNCTION_STRUCTURAL_EMPTY_ORIGIN = { x: 0, y: 0 };

/** Static presentation data of one structural node type. */
export interface FunctionStructuralNodeMeta {
    /** Node type id written into `NodeData`. */
    typeId: string;
    /** Which side of the signature the node mirrors. */
    kind: FunctionPortKind;
    /** Default node title per locale; the palette adds the localized i18n keys. */
    title: { en: string; de: string };
    /** `IconProvider` registry name of an icon that already ships with the app. */
    icon: string;
    /** Node color: {@link FUNCTION_NODE_COLOR}, shared with generated call nodes. */
    color: string;
    /** Node width in world units. */
    width: number;
}

/**
 * Presentation data per structural node type.
 *
 * Colors and width reuse the ordinary node defaults instead of inventing a new
 * visual style; the icons come from the existing `IconProvider` registry. The color
 * is {@link FUNCTION_NODE_COLOR}, the same broken-white stop the generated call
 * nodes use.
 */
export const FUNCTION_STRUCTURAL_NODE_META: Record<string, FunctionStructuralNodeMeta> = {
    [FUNCTION_INPUT_NODE_TYPE]: {
        typeId: FUNCTION_INPUT_NODE_TYPE,
        kind: 'input',
        title: { en: 'Function Input', de: 'Funktionseingang' },
        icon: 'input',
        color: FUNCTION_NODE_COLOR,
        width: resolveNodeWidth({}),
    },
    [FUNCTION_OUTPUT_NODE_TYPE]: {
        typeId: FUNCTION_OUTPUT_NODE_TYPE,
        kind: 'output',
        title: { en: 'Function Output', de: 'Funktionsausgang' },
        icon: 'output',
        color: FUNCTION_NODE_COLOR,
        width: resolveNodeWidth({}),
    },
};

/**
 * Whether a type id is one of the two structural function node types.
 * @param typeId - Candidate node type id.
 * @returns True for the structural input or output node type.
 */
export function isFunctionStructuralNodeType(typeId: unknown): boolean {
    return typeId === FUNCTION_INPUT_NODE_TYPE || typeId === FUNCTION_OUTPUT_NODE_TYPE;
}

/**
 * Whether a type id is the structural function input node type.
 * @param typeId - Candidate node type id.
 * @returns True for `graph.function.input`.
 */
export function isFunctionInputNodeType(typeId: unknown): boolean {
    return typeId === FUNCTION_INPUT_NODE_TYPE;
}

/**
 * Whether a type id is provided by the function-graph feature instead of a node package.
 *
 * Two id families never resolve through a runtime node package: the structural signature nodes
 * (`graph.function.input` / `graph.function.output`) and the generated call nodes
 * (`function_graph.<graphId>`). The app builds both from the owning collection, so a deploy
 * validator, a package-usage resolver or a palette lookup that cannot find them must treat them as
 * app-provided instead of reporting a missing node type or package.
 *
 * @param typeId - Candidate node type id.
 * @returns True for both function-graph-managed type id families.
 */
export function isFunctionGraphManagedNodeType(typeId: unknown): boolean {
    return isFunctionStructuralNodeType(typeId) || isFunctionNodeTypeId(typeId);
}

/** One connector descriptor as `NodeData` stores it. */
export interface FunctionConnectorDescriptor {
    /** Port id of the mirrored port (`in_0`, `out_0`, …). */
    id: string;
    /** Free-text port name; display only, never a wiring key. */
    name: string;
    /** Non-empty allowed data types; `['any']` accepts everything. */
    allowedTypes: string[];
    /** Inline editor shown next to an unwired call-node input; structural nodes omit it. */
    defaultControl?: FunctionInputDefaultControl;
}

/**
 * Build connector descriptors for one signature port list.
 *
 * The descriptor id stays the port id so a reconnect after rename keeps working;
 * an id that does not match the requested side is re-derived from the index
 * instead of being trusted. `allowedTypes` is always non-empty because
 * `NodeData.getInputAllowedTypes()` throws otherwise. With `withDefaults`, call-node
 * inputs additionally carry the port's `defaultControl` and order `allowedTypes` so the
 * default type leads; structural nodes never set it.
 *
 * @param ports - Signature ports to mirror onto a node.
 * @param kind - Side the connectors describe.
 * @param options - `withDefaults` enables default controls for call-node inputs.
 * @returns One descriptor per port, in declaration order.
 */
export function buildFunctionConnectorDescriptors(
    ports: readonly FunctionPort[],
    kind: FunctionPortKind,
    { withDefaults = false }: { withDefaults?: boolean } = {}
): FunctionConnectorDescriptor[] {
    const prefix = kind === 'input' ? 'in_' : 'out_';

    return ports.map((port, index) => {
        const descriptor: FunctionConnectorDescriptor = {
            id:
                typeof port.id === 'string' && port.id.startsWith(prefix)
                    ? port.id
                    : createFunctionPortId(kind, index),
            name: port.name,
            allowedTypes: withDefaults
                ? buildFunctionPortAllowedTypes(port)
                : port.types.length > 0
                  ? port.types.slice()
                  : ['any'],
        };
        if (withDefaults && kind === 'input') {
            descriptor.defaultControl = buildFunctionInputDefaultControl(port);
        }
        return descriptor;
    });
}

/**
 * Build the `NodeData` payload of a structural node.
 *
 * The input node mirrors the declared inputs as **outputs**, the output node
 * mirrors the declared outputs as **inputs**; the opposite list is always empty.
 * The id is assigned by `NodeGraph.addNode()`, never here.
 *
 * @param typeId - Structural node type id.
 * @param signature - Current signature of the graph.
 * @param position - World position of the node's top-left corner.
 * @returns A payload for `new NodeData(payload)` or `graph.addNode(payload)`.
 * @throws {TypeError} When the type id is not a structural node type.
 */
export function buildFunctionStructuralNodePayload(
    typeId: string,
    signature: FunctionSignature,
    position: { x: number; y: number }
): ConstructorParameters<typeof NodeData>[0] {
    const meta = FUNCTION_STRUCTURAL_NODE_META[typeId];
    if (!meta) {
        throw new TypeError(`'${typeId}' is not a function structural node type.`);
    }

    const isInput = meta.kind === 'input';

    return {
        type: meta.typeId,
        typeName: { ...meta.title },
        userName: null,
        x: position.x,
        y: position.y,
        width: meta.width,
        icon: IconProvider.get(meta.icon),
        color: meta.color,
        inputs: isInput ? [] : buildFunctionConnectorDescriptors(signature.outputs, 'output'),
        outputs: isInput ? buildFunctionConnectorDescriptors(signature.inputs, 'input') : [],
        controls: [],
        controlValues: {},
        inputDefaults: {},
    };
}

/**
 * Build the connector patch that re-synchronizes a structural node.
 *
 * Uses the same mapping as {@link buildFunctionStructuralNodePayload}, so an
 * update can never produce a different connector layout than a fresh node.
 *
 * @param typeId - Structural node type id.
 * @param signature - Current signature of the graph.
 * @returns `{ outputs }` for the input node, `{ inputs }` for the output node.
 * @throws {TypeError} When the type id is not a structural node type.
 */
export function buildFunctionStructuralConnectorPatch(
    typeId: string,
    signature: FunctionSignature
): Record<string, FunctionConnectorDescriptor[]> {
    const meta = FUNCTION_STRUCTURAL_NODE_META[typeId];
    if (!meta) {
        throw new TypeError(`'${typeId}' is not a function structural node type.`);
    }

    if (meta.kind === 'input') {
        return { outputs: buildFunctionConnectorDescriptors(signature.inputs, 'input') };
    }
    return { inputs: buildFunctionConnectorDescriptors(signature.outputs, 'output') };
}

/**
 * Resolve a free, deterministic placement for a structural node.
 *
 * The input node goes left of the left-most existing node, the output node right
 * of the right-most one, each with a fixed gap. Ties resolve to the first node in
 * graph order, so repeated calls with the same graph produce the same position.
 *
 * @param nodes - Nodes already present in the graph.
 * @param typeId - Structural node type id.
 * @returns World position for the new node's top-left corner.
 * @throws {TypeError} When the type id is not a structural node type.
 */
export function resolveFunctionStructuralNodePosition(
    nodes: readonly { x?: number; y?: number; width?: number }[],
    typeId: string
): { x: number; y: number } {
    const meta = FUNCTION_STRUCTURAL_NODE_META[typeId];
    if (!meta) {
        throw new TypeError(`'${typeId}' is not a function structural node type.`);
    }

    const placed = (Array.isArray(nodes) ? nodes : []).filter(
        (node) => node && Number.isFinite(node.x) && Number.isFinite(node.y)
    );
    if (placed.length === 0) {
        return {
            x:
                meta.kind === 'input'
                    ? FUNCTION_STRUCTURAL_EMPTY_ORIGIN.x
                    : meta.width + FUNCTION_STRUCTURAL_NODE_GAP,
            y: FUNCTION_STRUCTURAL_EMPTY_ORIGIN.y,
        };
    }

    const widthOf = (node: { width?: number }): number =>
        Number.isFinite(node.width) && (node.width as number) > 0
            ? (node.width as number)
            : meta.width;

    if (meta.kind === 'input') {
        const anchor = placed.reduce((left, node) =>
            (node.x as number) < (left.x as number) ? node : left
        );
        return {
            x: (anchor.x as number) - FUNCTION_STRUCTURAL_NODE_GAP - meta.width,
            y: anchor.y as number,
        };
    }

    const anchor = placed.reduce((right, node) =>
        (node.x as number) + widthOf(node) > (right.x as number) + widthOf(right) ? node : right
    );
    return {
        x: (anchor.x as number) + widthOf(anchor) + FUNCTION_STRUCTURAL_NODE_GAP,
        y: anchor.y as number,
    };
}
