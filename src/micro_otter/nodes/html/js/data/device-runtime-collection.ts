// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import DeviceRuntime from './device-runtime.js';
import { ProgressTracker } from '../core/progress-events.js';
import { AppPayload } from '../core/app-event.js';
import { AppEventEmitter } from '../core/app-event-emitter.js';

type FetchLike = typeof fetch;

/**
 * Event name emitted by {@link DeviceRuntimeCollection} once a load completed successfully.
 */
export const RUNTIMES_LOADED_EVENT = 'runtimesLoaded';

/**
 * Payload for runtime-collection reloads.
 *
 * A load runs at start-up and again after every add-on install or uninstall. Views that captured
 * a `DeviceRuntime` reference keep that reference valid (the collection reloads instances in
 * place when their root is unchanged), so the payload only has to announce that package data is
 * current again.
 */
export class RuntimeCollectionRuntimesLoadedPayload extends AppPayload {
    runtimeIds: string[];
    activeRuntimeId: string | null;

    /**
     * @param {string[]} runtimeIds - Ids of every runtime in the reloaded collection, in load order.
     * @param {string|null} activeRuntimeId - Runtime the collection marks active after the reload.
     */
    constructor(runtimeIds: string[], activeRuntimeId: string | null) {
        super('RuntimeCollection.RuntimesLoaded.v1');
        this.runtimeIds = [...runtimeIds];
        this.activeRuntimeId = activeRuntimeId;
    }
}

interface DeviceManifest {
    nodePackagesPath: string;
    deviceTargetsPath: string;
    runtimesPath: string;
}

interface RuntimeCollectionManifest {
    defaultRuntime?: unknown;
    runtimes?: Record<string, unknown> | null;
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

/**
 * Manages a collection of device runtimes defined by a manifest.json.
 *
 * Event model
 * ------------
 * Listeners registered via {@link AppEventEmitter.on} receive `AppEvent` envelopes:
 * - `runtimesLoaded` with `RuntimeCollection.RuntimesLoaded.v1`, emitted after every successful
 *   {@link DeviceRuntimeCollection.load} (start-up and after each add-on install/uninstall).
 *
 * Reloads are in place: a runtime whose id and root survive a reload is refilled through its own
 * `load()`, so views that captured the instance (node palette, graph panel) never hold a stale
 * copy of the node packages.
 */
export class DeviceRuntimeCollection extends AppEventEmitter {
    collectionRoot: string;
    manifest: RuntimeCollectionManifest | null;

    deviceRoot: string | null;
    deviceManifest: DeviceManifest | null;
    globalNodePackagesRoot: string | null;
    deviceTargetsRoot: string | null;

    defaultRuntimeId: string | null;
    runtimePaths: Map<string, string>;

    runtimesById: Map<string, DeviceRuntime>;
    activeRuntimeId: string | null;

    constructor(collectionRoot: string) {
        super();
        this.collectionRoot = ensureTrailingSlash(normalizeString(collectionRoot) || '');
        this.manifest = null;

        this.deviceRoot = null;
        this.deviceManifest = null;
        this.globalNodePackagesRoot = null;
        this.deviceTargetsRoot = null;

        this.defaultRuntimeId = null;
        this.runtimePaths = new Map();

        this.runtimesById = new Map();
        this.activeRuntimeId = null;
    }

    async load(fetchImpl: FetchLike | null = DEFAULT_FETCH): Promise<DeviceRuntimeCollection> {
        if (!fetchImpl) {
            throw new Error('Fetch implementation is required to load device runtimes.');
        }

        try {
            const progress = new ProgressTracker('device-runtime');
            progress.start('Loading device manifest...');

            await this.#loadDeviceManifest(fetchImpl);

            progress.update('Loading runtime collection manifest...');
            const manifestUrl = this.#resolvePath('manifest.json');
            const manifestResponse = await fetchImpl(manifestUrl, { cache: 'no-store' });
            if (!manifestResponse || !manifestResponse.ok) {
                throw new Error(`Failed to load runtime collection manifest from ${manifestUrl}`);
            }

            const manifest = (await manifestResponse.json()) as RuntimeCollectionManifest;
            this.manifest = manifest;
            this.#consumeManifest(manifest);

            this.globalNodePackagesRoot = this.#resolveDevicePath(this.deviceManifest.nodePackagesPath);
            this.deviceTargetsRoot = this.#resolveDevicePath(this.deviceManifest.deviceTargetsPath);

            const runtimeCount = this.runtimePaths.size;
            progress.update(
                `Loading ${runtimeCount} device runtime${runtimeCount !== 1 ? 's' : ''}...`,
                0
            );

            const previousRuntimes = new Map(this.runtimesById);
            this.runtimesById.clear();
            let loadedCount = 0;
            for (const [runtimeId, runtimePath] of this.runtimePaths) {
                const runtimeRoot = ensureTrailingSlash(this.#resolvePath(runtimePath));
                // Reuse, never replace: a view that captured this runtime must see the reloaded
                // packages after an add-on install/uninstall. A changed root gets a fresh instance.
                const previous = previousRuntimes.get(runtimeId);
                const runtime =
                    previous && previous.runtimeRoot === runtimeRoot
                        ? previous
                        : new DeviceRuntime(runtimeRoot);

                await runtime.load(fetchImpl, this.globalNodePackagesRoot, this.deviceTargetsRoot);

                this.runtimesById.set(runtimeId, runtime);
                loadedCount++;

                const percentage = Math.round((loadedCount / runtimeCount) * 100);
                progress.update(
                    `Loaded runtime ${runtimeId} (${loadedCount}/${runtimeCount})`,
                    percentage
                );
            }

            if (this.defaultRuntimeId && this.runtimesById.has(this.defaultRuntimeId)) {
                this.activeRuntimeId = this.defaultRuntimeId;
            } else {
                const first = this.runtimesById.keys().next();
                this.activeRuntimeId = first.done ? null : first.value;
            }

            progress.complete(`Device runtimes ready (${runtimeCount} loaded)`);

            // Announced only after a fully successful load, so a failed reload never empties the
            // palette or flags every node as unknown.
            this.emit(
                RUNTIMES_LOADED_EVENT,
                new RuntimeCollectionRuntimesLoadedPayload(
                    [...this.runtimesById.keys()],
                    this.activeRuntimeId
                )
            );

            return this;
        } catch (error) {
            const errorProgress = new ProgressTracker('device-runtime');
            errorProgress.start('Device runtime loading failed');
            errorProgress.error('Failed to load device runtimes', error);
            throw error;
        }
    }

    getRuntime(runtimeId: string): DeviceRuntime | null {
        return this.runtimesById.get(runtimeId) || null;
    }

    hasRuntime(runtimeId: string): boolean {
        return this.runtimesById.has(runtimeId);
    }

    getDefaultRuntimeId(): string | null {
        return this.defaultRuntimeId;
    }

    setActiveRuntime(runtimeId: string): boolean {
        if (!this.runtimesById.has(runtimeId)) {
            return false;
        }
        this.activeRuntimeId = runtimeId;
        return true;
    }

    getActiveRuntime(): DeviceRuntime | null {
        return this.activeRuntimeId ? this.getRuntime(this.activeRuntimeId) : null;
    }

    #resolvePath(relativePath: string): string {
        return joinPath(this.collectionRoot, relativePath) || '';
    }

    async #loadDeviceManifest(fetchImpl: FetchLike): Promise<void> {
        this.deviceRoot = this.collectionRoot.replace(/runtime\/?$/, '');

        const deviceManifestUrl = joinPath(this.deviceRoot, 'manifest.json');
        const response = await fetchImpl(deviceManifestUrl || '', { cache: 'no-store' });
        if (!response || !response.ok) {
            throw new Error(`Failed to load device manifest from ${deviceManifestUrl}`);
        }

        const rawManifest = (await response.json()) as Partial<DeviceManifest>;

        if (!rawManifest.nodePackagesPath) {
            throw new Error('Device manifest missing required field: nodePackagesPath');
        }
        if (!rawManifest.deviceTargetsPath) {
            throw new Error('Device manifest missing required field: deviceTargetsPath');
        }
        if (!rawManifest.runtimesPath) {
            throw new Error('Device manifest missing required field: runtimesPath');
        }

        this.deviceManifest = {
            nodePackagesPath: rawManifest.nodePackagesPath,
            deviceTargetsPath: rawManifest.deviceTargetsPath,
            runtimesPath: rawManifest.runtimesPath,
        };
    }

    #resolveDevicePath(relativePath: string): string {
        if (!this.deviceRoot) {
            throw new Error('Device root not initialized');
        }
        return ensureTrailingSlash(joinPath(this.deviceRoot, relativePath));
    }

    #consumeManifest(manifest: RuntimeCollectionManifest | null | undefined): void {
        this.defaultRuntimeId = normalizeString(manifest?.defaultRuntime);
        this.runtimePaths.clear();

        const rawRuntimes = manifest?.runtimes;
        if (!rawRuntimes || typeof rawRuntimes !== 'object') {
            return;
        }

        Object.entries(rawRuntimes).forEach(([rawId, rawPath]) => {
            const runtimeId = normalizeString(rawId);
            const runtimePath = normalizeString(rawPath);
            if (!runtimeId || !runtimePath) {
                return;
            }
            if (this.runtimePaths.has(runtimeId)) {
                throw new Error(
                    `Duplicate runtime id "${runtimeId}" in runtime collection manifest.`
                );
            }
            this.runtimePaths.set(runtimeId, runtimePath);
        });

        if (this.defaultRuntimeId && !this.runtimePaths.has(this.defaultRuntimeId)) {
            this.defaultRuntimeId = null;
        }
    }
}

export default DeviceRuntimeCollection;