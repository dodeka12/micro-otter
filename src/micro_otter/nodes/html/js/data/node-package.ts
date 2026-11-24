// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import NodeType from './node-type.js';
import { registerGraphRule } from '../core/graph-rule-registry.js';
import type { GraphRule } from '../core/graph-rule-registry.js';
import type {
    DataTypeKind,
    DataTypeConnectionDirectionPolicy,
    DataTypeConnectionPolicy,
    DataTypeDefinition,
} from './data-type-registry.js';

type UnknownRecord = Record<string, unknown>;
type NodeTypeMap = Map<string, NodeType>;
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type GeneratorHandler = (...args: unknown[]) => unknown;
type CapabilityCheckHandler = (...args: unknown[]) => unknown;

interface NodePackageManifest extends UnknownRecord {
    id?: string;
    name?: string;
    description?: string;
    version?: string;
    author?: string;
    infoUrl?: string;
    assetsRoot?: string;
    nodeDefs?: string;
    generators?: unknown[];
    capabilityChecks?: string;
    requiredCapabilities?: unknown;
    requiredPackages?: unknown;
    mpAssets?: unknown;
    mpModuleRoots?: unknown[];
    dataTypes?: unknown;
}

interface RawDataTypeDefinition extends UnknownRecord {
    name?: unknown;
    description?: unknown;
    color?: unknown;
    icon?: unknown;
    kind?: unknown;
    connectionPolicy?: unknown;
}

interface DataTypeDeclarationFile extends UnknownRecord {
    types?: unknown;
}

interface GeneratorImplementationSet extends UnknownRecord {
    codeGenerator?: GeneratorHandler;
    initGenerator?: GeneratorHandler;
}

type GeneratorPerLanguage = Record<string, unknown>;
type RegisterGeneratorsFn = (
    register: (nodeTypeId: string, perLanguage?: GeneratorPerLanguage) => void
) => unknown | Promise<unknown>;
type RegisterCapabilityChecksFn = (
    register: (nodeTypeId: string, handler: unknown) => void
) => unknown | Promise<unknown>;

const DATA_TYPE_KIND_VALUES = new Set<DataTypeKind>(['value', 'structure']);

interface GeneratorModule extends UnknownRecord {
    registerGenerators?: RegisterGeneratorsFn;
}

interface CapabilityChecksModule extends UnknownRecord {
    registerCapabilityChecks?: RegisterCapabilityChecksFn;
    registerGraphRules?: (register: (rule: unknown) => void) => unknown | Promise<unknown>;
}

interface GeneratorRegistryEntry {
    codeGenerator?: GeneratorHandler;
    initGenerator?: GeneratorHandler;
}

function normalizeString(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
}

function ensureTrailingSlash(path: string | null): string {
    if (!path) {
        return '';
    }
    return path.endsWith('/') ? path : `${path}/`;
}

function isAbsolutePath(path: unknown): boolean {
    const normalized = normalizeString(path);
    if (!normalized) {
        return false;
    }
    return /^(?:[a-z]+:\/\/|\/|data:|blob:)/i.test(normalized);
}

function joinPath(base: unknown, relative: unknown): string | null {
    const normalizedRelative = normalizeString(relative);
    if (!normalizedRelative) {
        return normalizedRelative;
    }
    if (isAbsolutePath(normalizedRelative)) {
        return normalizedRelative;
    }
    const normalizedBase = ensureTrailingSlash(normalizeString(base) || '');
    return `${normalizedBase}${normalizedRelative.replace(/^\.\/+/, '').replace(/\\/g, '/')}`;
}

function deriveBasePath(resourcePath: unknown): string {
    const normalized = normalizeString(resourcePath);
    if (!normalized) {
        return '';
    }
    const idx = normalized.lastIndexOf('/');
    return idx === -1 ? '' : normalized.slice(0, idx + 1);
}

/**
 * Represents a node package on disk/HTTP. Fields mirror manifest.json keys.
 * Member functions (alphabetical):
 * - #consumeManifest: Parse and store manifest fields onto the instance.
 * - #loadPackageValidationHooks: Import capability registrar modules and apply registrations.
 * - #loadGenerators: Import generator registrar modules and apply registrations.
 * - #loadNodeDefinitions: Fetch node definition JSON and instantiate NodeType entries.
 * - #mergeVariantAssets: Merge every variant's mpAssets map into one map.
 * - #normalizeAssetList: Normalize a list of relative/absolute asset paths.
 * - #normalizeAssetMap: Normalize an object mapping node ids to asset lists.
 * - #resolveAsset: Resolve a single asset path against a base.
 * - #resolvePath: Resolve a path relative to the package root.
 * - #trackGenerator: Record registered generator handlers per node and language.
 * - getNodeType: Retrieve a NodeType by id.
 * - load: Load manifest, definitions, and registrations.
 * mpAssets: map of node type id -> list of Python files that must be present on the device.
 * requiredPackages: ids of packages whose MicroPython assets must ship whenever this package is in use.
 */
export class NodePackage {
    packageRoot: string;
    manifest: NodePackageManifest | null;
    id: string | null;
    name: string | null;
    description: string | null;
    version: string | null;
    author: string | null;
    assetsRoot: string;
    infoUrl: string | null;
    nodeDefsPath: string | null;
    generatorPaths: string[];
    capabilityChecksPath: string | null;
    requiredCapabilities: unknown;
    requiredPackages: string[];
    precedence: number;
    mpAssets: Record<string, string[]>;
    mpModuleRoots: string[];
    dataTypesPath: string | null;
    dataTypes: Record<string, DataTypeDefinition>;
    nodeTypes: NodeTypeMap;
    generatorRegistry: Map<string, Map<string, GeneratorRegistryEntry>>;
    capabilityRegistry: Map<string, CapabilityCheckHandler>;

    /**
     * Initialize a node package anchored at the given root path/URL.
     * @param packageRoot
     */
    constructor(packageRoot: string) {
        this.packageRoot = ensureTrailingSlash(normalizeString(packageRoot) || '');
        this.manifest = null;
        this.id = null;
        this.name = null;
        this.description = null;
        this.version = null;
        this.author = null;
        this.assetsRoot = this.packageRoot;
        this.infoUrl = null;
        this.nodeDefsPath = null;
        this.generatorPaths = [];
        this.capabilityChecksPath = null;
        this.requiredCapabilities = [];
        this.requiredPackages = [];
        this.precedence = 0;
        this.mpAssets = {}; // nodeTypeId -> array of micropython asset paths required on device
        this.mpModuleRoots = [];
        this.dataTypesPath = null;
        this.dataTypes = {};
        this.nodeTypes = new Map();
        this.generatorRegistry = new Map();
        this.capabilityRegistry = new Map();
    }

    /**
     * Load manifest, node definitions, generators, and capability checks.
     *
     * A v2 package always declares its one manifest as ``manifest.json``, whose
     * ``variants`` dict names each implementation; there is no per-variant manifest.
     * @param fetchImpl
     * @returns
     */
    async load(
        fetchImpl: FetchLike | null = typeof fetch !== 'undefined' ? fetch : null
    ): Promise<NodePackage> {
        if (!fetchImpl) {
            throw new Error('Fetch implementation is required to load a node package.');
        }

        const manifestName = 'manifest.json';
        const manifestUrl = this.#resolvePath(manifestName);
        const manifestResponse = await fetchImpl(manifestUrl, { cache: 'no-store' });
        if (!manifestResponse || !manifestResponse.ok) {
            throw new Error(`Failed to load ${manifestName} from ${manifestUrl}`);
        }
        this.manifest = (await manifestResponse.json()) as NodePackageManifest;
        this.#consumeManifest(this.manifest);

        await this.#loadNodeDefinitions(fetchImpl);
        await this.#loadDataTypes(fetchImpl);
        await this.#loadGenerators();
        await this.#loadPackageValidationHooks();
        return this;
    }

    /**
     * Get a node type by id.
     * @param typeId
     * @returns
     */
    getNodeType(typeId: string): NodeType | null {
        return this.nodeTypes.get(typeId) || null;
    }

    /**
     * Get normalized package-defined data types.
     * @returns
     */
    getDataTypes(): Record<string, DataTypeDefinition> {
        return { ...this.dataTypes };
    }

    /**
     * Resolve a path relative to the package root.
     * @param relativePath
     * @returns
     * @private
     */
    #resolvePath(relativePath: string): string {
        return joinPath(this.packageRoot, relativePath) as string;
    }

    /**
     * Parse and store manifest fields.
     * @param manifest
     * @returns
     * @private
     */
    #consumeManifest(manifest: NodePackageManifest): void {
        this.id = normalizeString(manifest?.id);
        this.name = normalizeString(manifest?.name);
        this.description = normalizeString(manifest?.description);
        this.version = normalizeString(manifest?.version);
        this.author = normalizeString(manifest?.author);
        this.infoUrl = normalizeString(manifest?.infoUrl);

        const assetsRoot = normalizeString(manifest?.assetsRoot) || './';
        this.assetsRoot = this.#resolvePath(assetsRoot);

        const nodeDefsPath = normalizeString(manifest?.nodeDefs);
        if (!nodeDefsPath) {
            throw new Error('manifest.json is missing "nodeDefs".');
        }
        this.nodeDefsPath = this.#resolvePath(nodeDefsPath);

        this.generatorPaths = Array.isArray(manifest?.generators)
            ? manifest.generators.map((entry) => this.#resolvePath(String(entry))).filter(Boolean)
            : [];

        const capabilityPath = normalizeString(manifest?.capabilityChecks);
        this.capabilityChecksPath = capabilityPath ? this.#resolvePath(capabilityPath) : null;

        this.requiredCapabilities = Array.isArray(manifest?.requiredCapabilities)
            ? manifest.requiredCapabilities
            : [];

        const rawRequiredPackages = manifest?.requiredPackages;
        this.requiredPackages = Array.isArray(rawRequiredPackages)
            ? rawRequiredPackages
                  .map((entry) => normalizeString(entry))
                  .filter((entry): entry is string => Boolean(entry))
            : [];

        const rawPrecedence = manifest?.precedence;
        this.precedence =
            typeof rawPrecedence === 'number' && Number.isFinite(rawPrecedence) && rawPrecedence >= 0
                ? Math.floor(rawPrecedence)
                : 0;

        this.mpAssets = this.#normalizeAssetMap(manifest?.mpAssets, this.assetsRoot);
        if (Object.keys(this.mpAssets).length === 0) {
            // v2 manifests store mpAssets per variant; only legacy manifests keep a
            // top-level mpAssets key. Merge the variants so the package still exposes
            // its device library files when no top-level key is present.
            this.mpAssets = this.#mergeVariantAssets(manifest);
        }
        this.mpModuleRoots = Array.isArray(manifest?.mpModuleRoots)
            ? manifest.mpModuleRoots
                  .map((entry) => this.#resolvePath(String(entry)))
                  .filter((entry) => !!entry)
            : [];

        this.dataTypes = {};
        this.dataTypesPath = null;
        if (typeof manifest?.dataTypes === 'string') {
            const declaredPath = normalizeString(manifest.dataTypes);
            this.dataTypesPath = declaredPath ? this.#resolvePath(declaredPath) : null;
        } else if (manifest?.dataTypes && typeof manifest.dataTypes === 'object') {
            this.dataTypes = this.#normalizeDataTypeMap(manifest.dataTypes);
        }
    }

    /**
     * Load package data type declarations and normalize them.
     * @param fetchImpl
     * @returns
     * @private
     */
    async #loadDataTypes(fetchImpl: FetchLike): Promise<void> {
        if (!this.dataTypesPath) {
            return;
        }

        const resolvedPath = this.dataTypesPath;
        const response = await fetchImpl(resolvedPath, { cache: 'no-store' });
        if (!response || !response.ok) {
            throw new Error(`Failed to load data types from ${resolvedPath}`);
        }

        const declaration = (await response.json()) as DataTypeDeclarationFile;
        const source =
            declaration && typeof declaration === 'object' && declaration.types
                ? declaration.types
                : declaration;
        this.dataTypes = this.#normalizeDataTypeMap(source);
    }

    /**
     * Load node definitions and instantiate NodeType entries.
     * @param fetchImpl
     * @returns
     * @private
     */
    async #loadNodeDefinitions(fetchImpl: FetchLike): Promise<void> {
        if (!this.nodeDefsPath) {
            throw new Error('manifest.json is missing "nodeDefs".');
        }
        const resolvedPath = this.nodeDefsPath;
        const response = await fetchImpl(resolvedPath, { cache: 'no-store' });
        if (!response || !response.ok) {
            throw new Error(`Failed to load node definitions from ${resolvedPath}`);
        }
        const definitions = (await response.json()) as UnknownRecord;
        const basePath = deriveBasePath(resolvedPath);
        const nodeTypes = ((definitions?.nodeTypes as UnknownRecord | undefined) ||
            {}) as UnknownRecord;
        Object.entries(nodeTypes).forEach(([typeId, definition]) => {
            const fullTypeId = `${this.id}.${typeId}`;
            if (this.nodeTypes.has(fullTypeId)) {
                throw new Error(
                    `Duplicate node type "${fullTypeId}" in package at ${this.packageRoot}`
                );
            }
            const nodeType = new NodeType(
                { ...(definition as UnknownRecord), type: fullTypeId },
                basePath
            );
            this.nodeTypes.set(fullTypeId, nodeType);
        });
    }

    /**
     * Import generator registrars and register handlers on NodeType instances.
     * @returns
     * @private
     */
    async #loadGenerators(): Promise<void> {
        const generators = Array.isArray(this.generatorPaths) ? this.generatorPaths : [];
        for (const generatorPath of generators) {
            const module = (await import(/* @vite-ignore */ generatorPath)) as GeneratorModule;
            if (module && typeof module.registerGenerators === 'function') {
                await module.registerGenerators((nodeTypeId, perLanguage = {}) => {
                    const nodeType = this.nodeTypes.get(nodeTypeId);
                    if (!nodeType) {
                        return;
                    }
                    Object.entries(perLanguage).forEach(([language, impls]) => {
                        if (!impls || typeof impls !== 'object') {
                            return;
                        }
                        const typedImpls = impls as GeneratorImplementationSet;
                        if (typeof typedImpls.codeGenerator === 'function') {
                            nodeType.setImplementation(language, {
                                type: 'code-generator',
                                handler: typedImpls.codeGenerator,
                            });
                            this.#trackGenerator(
                                nodeTypeId,
                                language,
                                'codeGenerator',
                                typedImpls.codeGenerator
                            );
                        }
                        if (typeof typedImpls.initGenerator === 'function') {
                            nodeType.setInitImplementation(language, {
                                type: 'code-generator',
                                handler: typedImpls.initGenerator,
                            });
                            this.#trackGenerator(
                                nodeTypeId,
                                language,
                                'initGenerator',
                                typedImpls.initGenerator
                            );
                        }
                    });
                });
            }
        }
    }

    /**
     * Import capability/rule registrars and register handlers and rules.
     * @returns
     * @private
     */
    async #loadPackageValidationHooks(): Promise<void> {
        if (!this.capabilityChecksPath) {
            return;
        }
        const module = (await import(
            /* @vite-ignore */ this.capabilityChecksPath
        )) as CapabilityChecksModule;
        if (module && typeof module.registerCapabilityChecks === 'function') {
            await module.registerCapabilityChecks((nodeTypeId, handler) => {
                const nodeType = this.nodeTypes.get(nodeTypeId);
                if (!nodeType || typeof handler !== 'function') {
                    return;
                }
                nodeType.setCapabilityCheck(handler as CapabilityCheckHandler);
                this.capabilityRegistry.set(nodeTypeId, handler as CapabilityCheckHandler);
            });
        }
        if (module && typeof module.registerGraphRules === 'function') {
            await module.registerGraphRules((rule) => registerGraphRule(rule as GraphRule));
        }
    }

    /**
     * Track generator handlers by node type and language.
     * @param nodeTypeId
     * @param language
     * @param kind
     * @param fn
     * @returns
     * @private
     */
    #trackGenerator(
        nodeTypeId: string,
        language: string,
        kind: keyof GeneratorRegistryEntry,
        fn: GeneratorHandler
    ): void {
        if (!this.generatorRegistry.has(nodeTypeId)) {
            this.generatorRegistry.set(nodeTypeId, new Map());
        }
        const languageMap = this.generatorRegistry.get(nodeTypeId) as Map<
            string,
            GeneratorRegistryEntry
        >;
        const entry = languageMap.get(language) || {};
        entry[kind] = fn;
        languageMap.set(language, entry);
    }

    /**
     * Normalize a list of asset paths.
     * @param rawList
     * @param basePath
     * @returns
     * @private
     */
    #normalizeAssetList(rawList: unknown, basePath: string): string[] {
        if (!Array.isArray(rawList)) {
            return [];
        }
        return rawList
            .map((entry) =>
                typeof entry === 'string' ? this.#resolveAsset(basePath, entry) : null
            )
            .filter((entry): entry is string => !!entry);
    }

    /**
     * Normalize an asset map keyed by node type id.
     * @param rawMap
     * @param basePath
     * @returns
     * @private
     */
    #normalizeAssetMap(rawMap: unknown, basePath: string): Record<string, string[]> {
        if (!rawMap || typeof rawMap !== 'object' || Array.isArray(rawMap)) {
            return {};
        }
        const normalized: Record<string, string[]> = {};
        Object.entries(rawMap as UnknownRecord).forEach(([key, value]) => {
            const trimmedKey = normalizeString(key);
            if (!trimmedKey) {
                return;
            }
            normalized[trimmedKey] = this.#normalizeAssetList(value, basePath);
        });
        return normalized;
    }

    /**
     * Merge every variant's ``mpAssets`` map into one map.
     *
     * v2 manifests store ``mpAssets`` under ``variants.<id>.mpAssets``; the top-level
     * ``mpAssets`` key only remains for legacy single-implementation manifests. Every
     * variant implements the same node ids, so the maps share keys and the merge
     * unions each key's file list.
     * @param {NodePackageManifest} manifest - Manifest whose variant assets are merged
     * @returns {Record<string, string[]>} Merged, normalized asset map (empty when the
     *          manifest declares no variant assets)
     * @private
     */
    #mergeVariantAssets(manifest: NodePackageManifest): Record<string, string[]> {
        const variants = manifest?.variants;
        if (!variants || typeof variants !== 'object' || Array.isArray(variants)) {
            return {};
        }

        const merged: Record<string, string[]> = {};
        for (const variant of Object.values(variants)) {
            if (!variant || typeof variant !== 'object' || Array.isArray(variant)) {
                continue;
            }
            const variantAssets = this.#normalizeAssetMap(
                (variant as UnknownRecord).mpAssets,
                this.assetsRoot
            );
            for (const [key, list] of Object.entries(variantAssets)) {
                const existing = merged[key] ?? [];
                merged[key] = Array.from(new Set([...existing, ...list]));
            }
        }
        return merged;
    }

    /**
     * Resolve a single asset path against a base path.
     * @param basePath
     * @param path
     * @returns
     * @private
     */
    #resolveAsset(basePath: string, path: unknown): string | null {
        const normalizedPath = normalizeString(path);
        if (!normalizedPath) {
            return null;
        }
        if (isAbsolutePath(normalizedPath)) {
            return normalizedPath;
        }
        return joinPath(basePath, normalizedPath);
    }

    /**
     * Normalize package-declared data type map.
     * @param rawMap
     * @returns
     * @private
     */
    #normalizeDataTypeMap(rawMap: unknown): Record<string, DataTypeDefinition> {
        if (!rawMap || typeof rawMap !== 'object' || Array.isArray(rawMap)) {
            return {};
        }

        const normalized: Record<string, DataTypeDefinition> = {};
        Object.entries(rawMap as UnknownRecord).forEach(([rawTypeId, rawDefinition]) => {
            const typeId = normalizeString(rawTypeId);
            if (!typeId || !rawDefinition || typeof rawDefinition !== 'object') {
                return;
            }

            const definition = this.#normalizeDataTypeDefinition(
                rawDefinition as RawDataTypeDefinition
            );
            if (!definition) {
                return;
            }

            normalized[typeId] = definition;
        });

        return normalized;
    }

    /**
     * Normalize package-declared data type definition.
     * @param rawDefinition
     * @returns
     * @private
     */
    #normalizeDataTypeDefinition(rawDefinition: RawDataTypeDefinition): DataTypeDefinition | null {
        const name = this.#normalizeLocalizedText(rawDefinition.name);
        if (!name) {
            return null;
        }

        const description = this.#normalizeLocalizedText(rawDefinition.description);
        const color = normalizeString(rawDefinition.color);
        const icon = normalizeString(rawDefinition.icon);
        const hasKind = Object.prototype.hasOwnProperty.call(rawDefinition, 'kind');
        const kind = this.#normalizeDataTypeKind(rawDefinition.kind);
        const hasConnectionPolicy = Object.prototype.hasOwnProperty.call(
            rawDefinition,
            'connectionPolicy'
        );
        const connectionPolicy = this.#normalizeDataTypeConnectionPolicy(
            rawDefinition.connectionPolicy
        );

        if (hasKind && !kind) {
            return null;
        }

        if (hasConnectionPolicy && !connectionPolicy) {
            return null;
        }

        const definition: DataTypeDefinition = {
            name,
            description,
            color,
            icon,
            kind,
        };

        if (connectionPolicy) {
            definition.connectionPolicy = connectionPolicy;
        }

        return definition;
    }

    /**
     * Normalize data type kind metadata.
     * @param value
     * @returns
     * @private
     */
    #normalizeDataTypeKind(value: unknown): DataTypeKind | null {
        if (typeof value !== 'string') {
            return 'value';
        }

        const normalizedKind = normalizeString(value);
        if (!normalizedKind) {
            return 'value';
        }

        if (!DATA_TYPE_KIND_VALUES.has(normalizedKind as DataTypeKind)) {
            return null;
        }

        return normalizedKind as DataTypeKind;
    }

    /**
     * Normalize an integer max-connection policy for one connector direction.
     * @param value
     * @returns
     * @private
     */
    #normalizeDataTypeConnectionDirectionPolicy(
        value: unknown
    ): DataTypeConnectionDirectionPolicy | null {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            return null;
        }

        const rawMaxConnections = (value as UnknownRecord).maxConnections;
        if (typeof rawMaxConnections !== 'number' || !Number.isInteger(rawMaxConnections)) {
            return null;
        }

        if (rawMaxConnections < 0) {
            return null;
        }

        return { maxConnections: rawMaxConnections };
    }

    /**
     * Normalize directional connector connection policy.
     * @param value
     * @returns
     * @private
     */
    #normalizeDataTypeConnectionPolicy(value: unknown): DataTypeConnectionPolicy | null {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            return null;
        }

        const record = value as UnknownRecord;
        const hasInput = Object.prototype.hasOwnProperty.call(record, 'input');
        const hasOutput = Object.prototype.hasOwnProperty.call(record, 'output');

        if (!hasInput && !hasOutput) {
            return null;
        }

        const input = hasInput
            ? this.#normalizeDataTypeConnectionDirectionPolicy(record.input)
            : undefined;
        const output = hasOutput
            ? this.#normalizeDataTypeConnectionDirectionPolicy(record.output)
            : undefined;

        if ((hasInput && !input) || (hasOutput && !output)) {
            return null;
        }

        const normalized: DataTypeConnectionPolicy = {};
        if (input) {
            normalized.input = input;
        }
        if (output) {
            normalized.output = output;
        }
        return normalized;
    }

    /**
     * Normalize a localized text value from string/object form.
     * @param value
     * @returns
     * @private
     */
    #normalizeLocalizedText(value: unknown): string | Record<string, string> | null {
        const direct = normalizeString(value);
        if (direct) {
            return direct;
        }

        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            return null;
        }

        const localizedEntries = Object.entries(value as UnknownRecord)
            .map(([locale, text]) => {
                const normalizedLocale = normalizeString(locale);
                const normalizedText = normalizeString(text);
                return normalizedLocale && normalizedText
                    ? [normalizedLocale, normalizedText]
                    : null;
            })
            .filter((entry): entry is [string, string] => Array.isArray(entry));

        if (!localizedEntries.length) {
            return null;
        }

        return Object.fromEntries(localizedEntries);
    }
}

export default NodePackage;
