// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import DeviceTargetInfo, { type DeviceTargetPayload } from './device-target.js';
import NodePackage from './node-package.js';
import TargetResolver from './target-resolver.js';
import type { TargetConfigRecord } from './target-config-store.js';
import {
    listPackageVariants,
    parsePackageEntries,
    selectEditorManifest,
    type PackageIndexEntry,
    type PackageVariantInfo,
} from './package-resolver.js';
import type NodeType from './node-type.js';
import { ProgressTracker } from '../core/progress-events.js';

type Nullable<T> = T | null;
type UnknownRecord = Record<string, unknown>;
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface RuntimeManifest extends UnknownRecord {
    id?: unknown;
    name?: unknown;
    description?: unknown;
    version?: unknown;
    mainLoopPath?: unknown;
    nodePackagesPath?: unknown;
    nodePackages?: unknown;
    deviceTargetsPath?: unknown;
    deviceTargets?: {
        include?: unknown;
        exclude?: unknown;
    };
    filesystem?: unknown;
}

interface NodePackagesConfig {
    global?: unknown;
    local?: unknown;
    addons?: unknown;
    optional?: unknown;
}

interface NodePackagesIndexEntry {
    id?: unknown;
    manifest?: unknown;
}

interface NodePackagesIndex extends UnknownRecord {
    version?: unknown;
    packages?: unknown;
}

interface DeviceTargetsIndexEntry {
    id?: unknown;
    file?: unknown;
}

interface DeviceTargetsIndex extends UnknownRecord {
    version?: unknown;
    defaultTargetId?: unknown;
    targets?: unknown;
}

interface CompileTargetMappingRule {
    id?: unknown;
    webTargetId?: unknown;
    compile?: unknown;
}

interface CompileTargetMappings extends UnknownRecord {
    schemaVersion?: unknown;
    rules?: unknown;
}

interface ProgressTrackerLike {
    start(message: string, detail?: unknown): void;
    update(message: string, progress?: number, detail?: unknown): void;
    complete(message: string, detail?: unknown): void;
    error(message: string, detail?: unknown): void;
}

interface NodeTypeSummaryEntry {
    id: string;
    label: string;
    packageId: string | null;
}

const DEFAULT_FETCH: FetchLike | null = typeof fetch !== 'undefined' ? fetch : null;

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

function normalizeStringList(rawList: unknown): string[] {
    if (!Array.isArray(rawList)) {
        return [];
    }
    return rawList
        .map((entry) => normalizeString(entry))
        .filter((entry): entry is string => !!entry);
}

/**
 * Represents a device runtime manifest plus its resolved node packages and device targets.
 */
export class DeviceRuntime {
    runtimeRoot: string;
    manifest: RuntimeManifest | null;

    id: Nullable<string>;
    name: Nullable<string>;
    description: Nullable<string>;
    nodePackagesPath: Nullable<string>;
    nodePackagesRoot: Nullable<string>;
    nodePackagesGlobal: string[];
    nodePackagesLocal: string[];
    nodePackagesAddons: string[];
    nodePackagesOptional: string[];
    globalNodePackagesRoot: Nullable<string>;
    deviceTargetsPath: Nullable<string>;
    deviceTargetsRoot: Nullable<string>;
    deviceTargetsInclude: string[];
    deviceTargetsExclude: string[];
    mainLoopPath: Nullable<string>;
    mainLoopAbsolutePath: Nullable<string>;
    version: Nullable<string>;
    filesystem: string[];
    resolvedFilesystem: string[];

    nodePackagesIndexVersion: Nullable<string>;
    nodePackages: NodePackage[];
    nodePackagesById: Map<string, NodePackage>;
    deviceTargetsIndexVersion: Nullable<string>;
    defaultDeviceTargetId: Nullable<string>;
    deviceTargets: DeviceTargetInfo[];
    deviceTargetsById: Map<string, DeviceTargetInfo>;
    deviceTargetPayloadsById: Map<string, DeviceTargetPayload>;
    userTargetsById: Map<string, TargetConfigRecord>;
    targetResolver: TargetResolver;
    compileTargetsById: Map<string, { board: string; port: string }>;

    #packageVariants = new Map<string, PackageVariantInfo[]>();
    #indexEntries: PackageIndexEntry[] = [];
    #indexManifestLoader: ((manifestRel: string) => Promise<Record<string, unknown>>) | null = null;

    constructor(runtimeRoot: string) {
        this.runtimeRoot = ensureTrailingSlash(normalizeString(runtimeRoot) || '');
        this.manifest = null;

        this.id = null;
        this.name = null;
        this.description = null;
        this.nodePackagesPath = null;
        this.nodePackagesRoot = null;
        this.nodePackagesGlobal = [];
        this.nodePackagesLocal = [];
        this.nodePackagesAddons = [];
        this.nodePackagesOptional = [];
        this.globalNodePackagesRoot = null;
        this.deviceTargetsPath = null;
        this.deviceTargetsRoot = null;
        this.deviceTargetsInclude = [];
        this.deviceTargetsExclude = [];
        this.mainLoopPath = null;
        this.mainLoopAbsolutePath = null;
        this.version = null;
        this.filesystem = [];
        this.resolvedFilesystem = [];

        this.nodePackagesIndexVersion = null;
        this.nodePackages = [];
        this.nodePackagesById = new Map();
        this.deviceTargetsIndexVersion = null;
        this.defaultDeviceTargetId = null;
        this.deviceTargets = [];
        this.deviceTargetsById = new Map();
        this.deviceTargetPayloadsById = new Map();
        this.userTargetsById = new Map();
        this.targetResolver = new TargetResolver();
        this.compileTargetsById = new Map();
    }

    async load(
        fetchImpl: FetchLike | null = DEFAULT_FETCH,
        globalNodePackagesRoot: string | null = null,
        deviceTargetsRoot: string | null = null
    ): Promise<DeviceRuntime> {
        if (!fetchImpl) {
            throw new Error('Fetch implementation is required to load a device runtime.');
        }

        this.globalNodePackagesRoot = globalNodePackagesRoot;
        if (deviceTargetsRoot) {
            this.deviceTargetsRoot = deviceTargetsRoot;
        }

        const manifestUrl = this.#resolvePath('manifest.json');
        const manifestResponse = await fetchImpl(manifestUrl, { cache: 'no-store' });
        if (!manifestResponse || !manifestResponse.ok) {
            throw new Error(`Failed to load runtime manifest from ${manifestUrl}`);
        }
        const manifest = (await manifestResponse.json()) as RuntimeManifest;
        this.manifest = manifest;
        this.#consumeManifest(manifest);

        await this.#loadNodePackages(fetchImpl);
        await this.#loadDeviceTargets(fetchImpl);
        return this;
    }

    getDeviceTarget(targetId: string): DeviceTargetInfo | null {
        return this.deviceTargetsById.get(targetId) || null;
    }

    getAvailableTargets(): DeviceTargetInfo[] {
        return this.deviceTargets;
    }

    /**
     * Return the compile board/port a target maps to, for display only.
     *
     * A derived target (shipped or user) resolves through its terminal build
     * base id — the ``compile_target_mappings.json`` rule for that base; a
     * target with no base (or an unknown base) answers ``null`` exactly as
     * before. The server resolves the build board from ``targetId``; this read
     * feeds only the info row and capability gating, never the build/deploy
     * request.
     */
    getCompileTarget(targetId: string): { board: string; port: string } | null {
        const direct = this.compileTargetsById.get(targetId);
        if (direct) {
            return direct;
        }
        const baseTargetId = this.targetResolver.resolveBuildBaseId(targetId);
        if (baseTargetId) {
            return this.compileTargetsById.get(baseTargetId) || null;
        }
        return null;
    }

    /**
     * Replace the derived user-target records this runtime resolves.
     *
     * Records are keyed by id; a record without an id is ignored. Callers re-sync
     * after the workspace's user-target store changes.
     * @param {TargetConfigRecord[]} records - Derived user target records.
     */
    setUserTargets(records: TargetConfigRecord[]): void {
        this.userTargetsById.clear();
        for (const record of records) {
            if (record && record.id) {
                this.userTargetsById.set(record.id, record);
            }
        }
        this.targetResolver.setUserTargets(records);
    }

    /**
     * Return the terminal build base id a target resolves to, or ``null``.
     *
     * The base id is the chain's terminal id — the id whose mapping rule the
     * server builds against. A shipped target with no base answers its own id;
     * an unknown id answers ``null``, so the compile/deploy frame omits
     * ``baseTargetId`` for it.
     * @param {string} targetId - Target id to resolve.
     * @returns {string | null} The terminal build base id, or null.
     */
    getTargetBuildBaseId(targetId: string): string | null {
        return this.targetResolver.resolveBuildBaseId(targetId);
    }

    /**
     * Return the effective (fully merged) payload for *targetId*, or ``null``.
     *
     * A derived target's payload is resolved through its whole chain, so the
     * device upload and export paths can serialize a plain payload instead of a
     * ``DeviceTargetInfo`` instance.
     * @param {string} targetId - Target id to resolve.
     * @returns {DeviceTargetPayload | null} The effective payload, or null.
     */
    getEffectiveTargetPayload(targetId: string): DeviceTargetPayload | null {
        const effective = this.targetResolver.resolve(targetId);
        return effective ? effective.payload : null;
    }

    /**
     * Return the merged onboarding target list: every shipped target plus every
     * derived user target, resolved to its effective payload.
     *
     * A target whose base is unknown (or whose chain cannot be resolved) is
     * skipped, so the list never contains a half-resolved target.
     * @returns {DeviceTargetInfo[]} Shipped + resolved derived targets.
     */
    listOnboardingTargets(): DeviceTargetInfo[] {
        return this.targetResolver
            .listEffective()
            .map((effective) => new DeviceTargetInfo(effective.payload));
    }

    getNodePackage(packageId: string): NodePackage | null {
        return this.nodePackagesById.get(packageId) || null;
    }

    /**
     * Return where a node package came from, for palette badges.
     *
     * `'addon'` means the id was announced under `nodePackages.addons`, i.e. it is
     * installed in the user's add-ons folder. Everything else - a shipped package, an
     * unknown id, a manifest without the `addons` key - answers `'builtin'`, so the
     * method is total and never hands `undefined` to the UI. Provenance is cosmetic:
     * no execution, generation, deployment, or capability decision reads it.
     * @param {string} packageId - Node package id to classify.
     * @returns {'builtin' | 'addon'} Provenance of the package.
     */
    packageProvenance(packageId: string): 'builtin' | 'addon' {
        return this.nodePackagesAddons.includes(packageId) ? 'addon' : 'builtin';
    }

    /**
     * Return whether a package is declared optional by the runtime manifest.
     *
     * Optional is a cosmetic default only: it changes the checklist's default
     * checkbox state and nothing on the server. An unknown id (including an id
     * absent from `global`/`local`/`addons`) answers `false`, so the method is
     * total and never hands `undefined` to the UI.
     * @param {string} packageId - Node package id to classify.
     * @returns {boolean} True when the id is listed under `nodePackages.optional`.
     */
    isOptionalPackage(packageId: string): boolean {
        return this.nodePackagesOptional.includes(packageId);
    }

    getNodeTypesSummary(): NodeTypeSummaryEntry[] {
        const entries: NodeTypeSummaryEntry[] = [];
        for (const nodePackage of this.nodePackages) {
            nodePackage.nodeTypes.forEach((nodeType: NodeType, typeId: string) => {
                const label = this.#selectLabel(nodeType?.title as Record<string, string> | null) || typeId;
                entries.push({ id: typeId, label, packageId: nodePackage.id ?? null });
            });
        }
        return entries;
    }

    /** Return the variant metadata collected for a package (empty when unknown). */
    getPackageVariants(packageId: string): PackageVariantInfo[] {
        return this.#packageVariants.get(packageId) ?? [];
    }

    getNodeType(typeId: string): NodeType | null {
        if (!typeId) {
            return null;
        }
        for (const nodePackage of this.nodePackages) {
            const match = nodePackage.getNodeType(typeId);
            if (match) {
                return match;
            }
        }
        return null;
    }

    #resolvePath(relativePath: string): string {
        return joinPath(this.runtimeRoot, relativePath) as string;
    }

    #consumeManifest(manifest: RuntimeManifest): void {
        this.id = normalizeString(manifest?.id);
        this.name = normalizeString(manifest?.name);
        this.description = normalizeString(manifest?.description);
        this.version = normalizeString(manifest?.version);

        this.mainLoopPath = normalizeString(manifest?.mainLoopPath);
        this.mainLoopAbsolutePath = this.mainLoopPath ? this.#resolvePath(this.mainLoopPath) : null;

        const nodePackagesField = manifest?.nodePackages ?? manifest?.nodePackagesPath;

        if (typeof nodePackagesField === 'string') {
            const nodePackagesPath = normalizeString(nodePackagesField);
            if (!nodePackagesPath) {
                throw new Error('runtime manifest is missing "nodePackagesPath".');
            }
            this.nodePackagesPath = nodePackagesPath;
            this.nodePackagesRoot = ensureTrailingSlash(this.#resolvePath(nodePackagesPath));
            this.nodePackagesGlobal = [];
            this.nodePackagesLocal = [];
            this.nodePackagesAddons = [];
            this.nodePackagesOptional = [];
        } else if (nodePackagesField && typeof nodePackagesField === 'object') {
            this.nodePackagesPath = null;
            this.nodePackagesRoot = null;
            const config = nodePackagesField as NodePackagesConfig;
            this.nodePackagesGlobal = normalizeStringList(config.global);
            this.nodePackagesLocal = normalizeStringList(config.local);
            this.nodePackagesAddons = normalizeStringList(config.addons);
            this.nodePackagesOptional = normalizeStringList(config.optional);
        } else {
            throw new Error('runtime manifest is missing "nodePackages" or "nodePackagesPath".');
        }

        const deviceTargets = manifest?.deviceTargets ?? {};
        this.deviceTargetsInclude = normalizeStringList(deviceTargets.include);
        this.deviceTargetsExclude = normalizeStringList(deviceTargets.exclude);

        const deviceTargetsPath = normalizeString(manifest?.deviceTargetsPath);
        if (deviceTargetsPath) {
            this.deviceTargetsPath = deviceTargetsPath;
            if (!this.deviceTargetsRoot) {
                this.deviceTargetsRoot = ensureTrailingSlash(this.#resolvePath(deviceTargetsPath));
            }
        }

        this.filesystem = normalizeStringList(manifest?.filesystem);
        this.resolvedFilesystem = this.filesystem.map((entry) => this.#resolvePath(entry));
    }

    #selectLabel(titleObject: Record<string, string> | null | undefined): string | null {
        if (!titleObject || typeof titleObject !== 'object') {
            return null;
        }
        if (typeof titleObject.en === 'string' && titleObject.en.trim()) {
            return titleObject.en.trim();
        }
        const first = Object.values(titleObject).find(
            (val) => typeof val === 'string' && val.trim()
        );
        return first ? first.trim() : null;
    }

    async #loadNodePackages(fetchImpl: FetchLike): Promise<void> {
        try {
            const progress = new ProgressTracker('node-packages') as ProgressTrackerLike;
            progress.start('Loading node packages...');

            this.nodePackages = [];
            this.nodePackagesById.clear();
            // A reload answers every package question from the new index: stale variant records
            // (and the loader closure behind them) would otherwise describe uninstalled packages.
            this.#packageVariants.clear();
            this.#indexManifestLoader = null;

            if (this.nodePackagesPath) {
                if (!this.nodePackagesRoot) {
                    throw new Error('Node packages path was not configured on the runtime instance.');
                }
                await this.#loadNodePackagesFromIndex(this.nodePackagesRoot, fetchImpl, progress);
            } else {
                const totalCount =
                    this.nodePackagesGlobal.length +
                    this.nodePackagesAddons.length +
                    this.nodePackagesLocal.length;
                if (totalCount === 0) {
                    progress.complete('No node packages configured');
                    return;
                }

                progress.update(
                    `Loading ${totalCount} node package${totalCount !== 1 ? 's' : ''}...`,
                    0
                );

                let loadedCount = 0;

                if (this.nodePackagesGlobal.length > 0 || this.nodePackagesAddons.length > 0) {
                    if (!this.globalNodePackagesRoot) {
                        throw new Error('Global node packages root not provided by collection');
                    }

                    const indexUrl = joinPath(this.globalNodePackagesRoot, 'index.json') as string;
                    const indexResponse = await fetchImpl(indexUrl, { cache: 'no-store' });
                    if (!indexResponse || !indexResponse.ok) {
                        throw new Error(`Failed to load node packages index from ${indexUrl}`);
                    }
                    const indexData = (await indexResponse.json()) as NodePackagesIndex;
                    const entries = parsePackageEntries(indexData);

                    // Installed add-ons resolve through the very same merged index and the
                    // very same relative manifest path: the server maps
                    // /device/node_pkgs/<id>/… onto the add-ons folder.
                    const loadManifest = async (
                        manifestRel: string
                    ): Promise<Record<string, unknown>> => {
                        const manifestUrl = joinPath(
                            this.globalNodePackagesRoot,
                            manifestRel
                        ) as string;
                        const response = await fetchImpl(manifestUrl, { cache: 'no-store' });
                        if (!response || !response.ok) {
                            throw new Error(
                                `Failed to load node package manifest from ${manifestUrl}`
                            );
                        }
                        return (await response.json()) as Record<string, unknown>;
                    };
                    this.#indexEntries = entries;
                    this.#indexManifestLoader = loadManifest;

                    const indexDrivenIds = [...this.nodePackagesGlobal, ...this.nodePackagesAddons];
                    for (const packageId of indexDrivenIds) {
                        const packageKind = this.nodePackagesAddons.includes(packageId)
                            ? 'add-on'
                            : 'global';
                        const manifestRel = await selectEditorManifest(
                            entries,
                            packageId,
                            loadManifest
                        );
                        this.#packageVariants.set(
                            packageId,
                            await listPackageVariants(entries, packageId, loadManifest)
                        );
                        const manifestUrl = joinPath(
                            this.globalNodePackagesRoot,
                            manifestRel
                        ) as string;
                        const packageRoot = ensureTrailingSlash(deriveBasePath(manifestUrl));
                        const nodePackage = new NodePackage(packageRoot);
                        await nodePackage.load(fetchImpl);

                        if (this.nodePackagesById.has(packageId)) {
                            throw new Error(`Duplicate node package id "${packageId}" (${packageKind})`);
                        }

                        this.nodePackages.push(nodePackage);
                        this.nodePackagesById.set(packageId, nodePackage);
                        loadedCount++;

                        const percentage = Math.round((loadedCount / totalCount) * 100);
                        progress.update(
                            `Loaded ${packageKind} package ${packageId} (${loadedCount}/${totalCount})`,
                            percentage
                        );
                    }
                }

                const localPackagesRoot = ensureTrailingSlash(this.#resolvePath('node_pkgs'));
                for (const packageId of this.nodePackagesLocal) {
                    const packageRoot = ensureTrailingSlash(joinPath(localPackagesRoot, packageId));
                    const nodePackage = new NodePackage(packageRoot);
                    await nodePackage.load(fetchImpl);

                    if (this.nodePackagesById.has(packageId)) {
                        throw new Error(`Duplicate node package id "${packageId}" (local)`);
                    }

                    this.nodePackages.push(nodePackage);
                    this.nodePackagesById.set(packageId, nodePackage);
                    loadedCount++;

                    const percentage = Math.round((loadedCount / totalCount) * 100);
                    progress.update(
                        `Loaded local package ${packageId} (${loadedCount}/${totalCount})`,
                        percentage
                    );
                }
            }

            progress.complete(`Node packages ready (${this.nodePackages.length} loaded)`);
        } catch (error) {
            const errorProgress = new ProgressTracker('node-packages') as ProgressTrackerLike;
            errorProgress.start('Node package loading failed');
            errorProgress.error('Failed to load node packages', error);
            throw error;
        }
    }

    async #loadNodePackagesFromIndex(
        packagesRoot: string,
        fetchImpl: FetchLike,
        progress: ProgressTrackerLike
    ): Promise<void> {
        const indexUrl = joinPath(packagesRoot, 'index.json') as string;
        const indexResponse = await fetchImpl(indexUrl, { cache: 'no-store' });
        if (!indexResponse || !indexResponse.ok) {
            throw new Error(`Failed to load node packages index from ${indexUrl}`);
        }
        const indexData = (await indexResponse.json()) as NodePackagesIndex;
        this.nodePackagesIndexVersion = normalizeString(indexData?.version);

        const packages = Array.isArray(indexData?.packages)
            ? (indexData.packages as NodePackagesIndexEntry[])
            : [];
        const packageCount = packages.length;
        progress.update(
            `Loading ${packageCount} node package${packageCount !== 1 ? 's' : ''}...`,
            0
        );

        let loadedCount = 0;
        for (const entry of packages) {
            const packageId = normalizeString(entry?.id);
            const manifestRelative = normalizeString(entry?.manifest);
            if (!packageId || !manifestRelative) {
                continue;
            }
            if (this.nodePackagesById.has(packageId)) {
                throw new Error(`Duplicate node package id "${packageId}" in index at ${indexUrl}`);
            }

            const manifestUrl = joinPath(packagesRoot, manifestRelative);
            const packageRoot = ensureTrailingSlash(deriveBasePath(manifestUrl));
            const nodePackage = new NodePackage(packageRoot);
            await nodePackage.load(fetchImpl);
            this.nodePackages.push(nodePackage);
            this.nodePackagesById.set(packageId, nodePackage);
            loadedCount++;

            const percentage = packageCount > 0 ? Math.round((loadedCount / packageCount) * 100) : 0;
            progress.update(`Loaded package ${packageId} (${loadedCount}/${packageCount})`, percentage);
        }
    }

    async #loadDeviceTargets(fetchImpl: FetchLike): Promise<void> {
        this.deviceTargets = [];
        this.deviceTargetsById.clear();
        this.deviceTargetPayloadsById.clear();
        this.deviceTargetsIndexVersion = null;
        this.defaultDeviceTargetId = null;

        if (!this.deviceTargetsRoot) {
            return;
        }

        const indexUrl = joinPath(this.deviceTargetsRoot, 'index.json') as string;
        const indexResponse = await fetchImpl(indexUrl, { cache: 'no-store' });
        if (!indexResponse || !indexResponse.ok) {
            throw new Error(`Failed to load device targets index from ${indexUrl}`);
        }

        const indexData = (await indexResponse.json()) as DeviceTargetsIndex;
        this.deviceTargetsIndexVersion = normalizeString(indexData?.version);
        this.defaultDeviceTargetId = normalizeString(indexData?.defaultTargetId);

        const targets = Array.isArray(indexData?.targets)
            ? (indexData.targets as DeviceTargetsIndexEntry[])
            : [];

        // Fetch each raw payload once and register it with the resolver; the
        // effective targets are produced by the resolver, never read twice.
        const shippedEntries: Array<{ id: string; payload: DeviceTargetPayload }> = [];
        for (const entry of targets) {
            const entryId = normalizeString(entry?.id);
            const targetFile = normalizeString(entry?.file);
            if (!targetFile) {
                continue;
            }

            const targetUrl = joinPath(this.deviceTargetsRoot, targetFile) as string;
            let rawPayload: DeviceTargetPayload | null = null;
            try {
                const response = await fetchImpl(targetUrl, { cache: 'no-store' });
                if (response && response.ok) {
                    const parsed = (await response.json()) as DeviceTargetPayload;
                    if (parsed && typeof parsed === 'object') {
                        rawPayload = parsed;
                    }
                }
            } catch {
                // Payload read is best-effort; an unreadable file is skipped.
            }
            if (!rawPayload) {
                continue;
            }

            const resolvedId = entryId || normalizeString(rawPayload.targetId ?? rawPayload.id);
            if (!resolvedId) {
                continue;
            }
            this.deviceTargetPayloadsById.set(resolvedId, rawPayload);
            shippedEntries.push({ id: resolvedId, payload: rawPayload });
        }

        this.targetResolver.setShippedTargets(shippedEntries);

        const includeSet =
            this.deviceTargetsInclude.length > 0 ? new Set(this.deviceTargetsInclude) : null;
        const excludeSet =
            this.deviceTargetsExclude.length > 0 ? new Set(this.deviceTargetsExclude) : null;

        for (const effective of this.targetResolver.listEffective()) {
            if (includeSet && !includeSet.has(effective.targetId)) {
                continue;
            }
            if (excludeSet && excludeSet.has(effective.targetId)) {
                continue;
            }
            if (this.deviceTargetsById.has(effective.targetId)) {
                throw new Error(`Duplicate device target id "${effective.targetId}" after filtering`);
            }
            const target = new DeviceTargetInfo(effective.payload);
            this.deviceTargets.push(target);
            this.deviceTargetsById.set(effective.targetId, target);
        }

        if (this.defaultDeviceTargetId && !this.deviceTargetsById.has(this.defaultDeviceTargetId)) {
            this.defaultDeviceTargetId = null;
        }

        await this.#loadCompileTargetMappings(fetchImpl);
    }

    async #loadCompileTargetMappings(fetchImpl: FetchLike): Promise<void> {
        this.compileTargetsById.clear();
        if (!this.deviceTargetsRoot) {
            return;
        }

        const mappingUrl = joinPath(this.deviceTargetsRoot, 'compile_target_mappings.json') as string;
        try {
            const response = await fetchImpl(mappingUrl, { cache: 'no-store' });
            if (!response || !response.ok) {
                return;
            }
            const data = (await response.json()) as CompileTargetMappings;
            const rules = Array.isArray(data?.rules)
                ? (data.rules as CompileTargetMappingRule[])
                : [];
            for (const rule of rules) {
                const targetId = normalizeString(rule?.webTargetId);
                const compileSection = rule?.compile;
                if (!targetId || !compileSection || typeof compileSection !== 'object') {
                    continue;
                }
                const section = compileSection as Record<string, unknown>;
                const board = normalizeString(section.board);
                // The backend-typed compile section carries the port under
                // `params.port`; the legacy shape had a top-level `port`.
                const params = section.params;
                const port =
                    normalizeString(
                        params && typeof params === 'object'
                            ? (params as Record<string, unknown>).port
                            : undefined
                    ) ?? normalizeString(section.port);
                if (!board || board === '*' || !port || port === '*') {
                    continue;
                }
                this.compileTargetsById.set(targetId, { board, port });
            }
        } catch {
            // Mapping is optional; leave the map empty.
        }
    }
}

export default DeviceRuntime;
