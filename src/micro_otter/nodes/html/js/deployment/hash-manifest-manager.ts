// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { calculateFileHash } from './deployment-utils.js';

const MANIFEST_PATH = '/.micro-otter-sync-manifest';
const MANIFEST_VERSION = '1.0.0';

export type ManifestSection = 'runtime' | 'tools' | 'collection';

export type HashManifestRecord = Record<string, string>;

export interface RuntimeHashMetadata {
    runtimeId?: string;
    version?: string;
    [key: string]: unknown;
}

export interface ToolsHashMetadata {
    [key: string]: unknown;
}

export interface CollectionHashMetadata {
    collectionId?: string;
    collectionName?: string;
    [key: string]: unknown;
}

export interface HashMetadataBySection {
    runtime: RuntimeHashMetadata;
    tools: ToolsHashMetadata;
    collection: CollectionHashMetadata;
}

export interface HashManifestSection {
    files: HashManifestRecord;
    [key: string]: unknown;
}

export interface HashManifest {
    version: string;
    created: string;
    updated: string;
    runtime?: HashManifestSection;
    tools?: HashManifestSection;
    collection?: HashManifestSection;
}

export interface PreparedFileResult {
    needsUpload: boolean;
    hash: string;
}

export interface DeviceConnection {
    readTextFile(path: string): Promise<string>;
    writeTextFile(path: string, content: string): Promise<void>;
}

/**
 * Manages the centralized hash manifest on device.
 * Provides atomic operations for loading, saving, and comparing file hashes.
 */
export class HashManifestManager {
    private _deviceConnection: DeviceConnection;
    private _manifest: HashManifest | null;
    private _dirty: boolean;
    private _stagedHashes: Record<ManifestSection, HashManifestRecord>;

    constructor(deviceConnection: DeviceConnection) {
        if (!deviceConnection) {
            throw new Error('DeviceConnection is required');
        }

        this._deviceConnection = deviceConnection;
        this._manifest = null;
        this._dirty = false;
        this._stagedHashes = {
            runtime: {},
            tools: {},
            collection: {},
        };
    }

    async load(): Promise<void> {
        try {
            const content = await this._deviceConnection.readTextFile(MANIFEST_PATH);
            this._manifest = this.parseManifestContent(content);
            this._dirty = false;
        } catch (error) {
            if (this.isFileNotFoundError(error)) {
                this._manifest = null;
                this._dirty = false;
                return;
            }
            if (this.isLowMemoryReadError(error)) {
                // Recover when device cannot allocate enough memory to read manifest.
                this._manifest = null;
                this._dirty = false;
                return;
            }
            if (this.isManifestParseError(error)) {
                // Recover from corrupted device manifest by treating it as missing.
                this._manifest = null;
                this._dirty = false;
                return;
            }
            throw new Error(`Failed to load hash manifest: ${this.getErrorMessage(error)}`);
        }
    }

    async save(): Promise<void> {
        if (!this._manifest) {
            throw new Error('Cannot save null manifest (use createEmpty() first)');
        }

        if (!this._dirty) {
            return;
        }

        this._manifest.updated = new Date().toISOString();

        const content = JSON.stringify(this._manifest, null, 2);
        await this._deviceConnection.writeTextFile(MANIFEST_PATH, content);

        this._dirty = false;
    }

    async exists(): Promise<boolean> {
        try {
            await this._deviceConnection.readTextFile(MANIFEST_PATH);
            return true;
        } catch (error) {
            if (this.isFileNotFoundError(error)) {
                return false;
            }
            throw new Error(
                `Failed to check hash manifest existence: ${this.getErrorMessage(error)}`
            );
        }
    }

    createEmpty(): void {
        const now = new Date().toISOString();
        this._manifest = {
            version: MANIFEST_VERSION,
            created: now,
            updated: now,
        };
        this._dirty = true;
    }

    reset(): void {
        this._manifest = null;
        this._dirty = false;
    }

    needsUpload(section: ManifestSection, devicePath: string, localHash: string): boolean {
        if (!this._manifest || !this._manifest[section]) {
            return true;
        }

        const deviceHash = this._manifest[section]?.files?.[devicePath];
        return deviceHash !== localHash;
    }

    getHash(section: ManifestSection, devicePath: string): string | null {
        return this._manifest?.[section]?.files?.[devicePath] ?? null;
    }

    getFiles(section: ManifestSection): HashManifestRecord {
        return this._manifest?.[section]?.files ?? {};
    }

    updateHashes<TSection extends ManifestSection>(
        section: TSection,
        pathHashMap: HashManifestRecord,
        metadata: HashMetadataBySection[TSection] = {} as HashMetadataBySection[TSection]
    ): void {
        const manifest = this.ensureManifest();

        if (!manifest[section]) {
            manifest[section] = { files: {} };
        }

        const sectionManifest = manifest[section] as HashManifestSection;
        Object.assign(sectionManifest, metadata);
        Object.assign(sectionManifest.files, pathHashMap);

        this._dirty = true;
    }

    removeSection(section: ManifestSection): void {
        if (this._manifest?.[section]) {
            delete this._manifest[section];
            this._dirty = true;
        }
    }

    removeFile(section: ManifestSection, devicePath: string): void {
        if (this._manifest?.[section]?.files?.[devicePath]) {
            delete this._manifest[section]?.files?.[devicePath];
            this._dirty = true;
        }
    }

    isLoaded(): boolean {
        return this._manifest !== null;
    }

    isDirty(): boolean {
        return this._dirty;
    }

    getVersion(): string | null {
        return this._manifest?.version ?? null;
    }

    getCreated(): string | null {
        return this._manifest?.created ?? null;
    }

    getUpdated(): string | null {
        return this._manifest?.updated ?? null;
    }

    async prepareFile(
        section: ManifestSection,
        devicePath: string,
        content: string | Uint8Array
    ): Promise<PreparedFileResult> {
        const hash = await calculateFileHash(content);

        this._stagedHashes[section][devicePath] = hash;

        const needsUpload = this.needsUpload(section, devicePath, hash);

        return { needsUpload, hash };
    }

    getFilesToUpload(section: ManifestSection): string[] {
        const staged = this._stagedHashes[section] || {};
        return Object.keys(staged).filter((path) => this.needsUpload(section, path, staged[path]));
    }

    getStagedHash(section: ManifestSection, devicePath: string): string | null {
        return this._stagedHashes[section]?.[devicePath] ?? null;
    }

    getAllStagedHashes(section: ManifestSection): HashManifestRecord {
        return { ...this._stagedHashes[section] };
    }

    commitStaging<TSection extends ManifestSection>(
        section: TSection,
        metadata: HashMetadataBySection[TSection] = {} as HashMetadataBySection[TSection]
    ): void {
        const staged = this._stagedHashes[section] || {};
        if (Object.keys(staged).length > 0) {
            this.updateHashes(section, staged, metadata);
            this._stagedHashes[section] = {};
        }
    }

    clearStaging(section: ManifestSection | null = null): void {
        if (section) {
            this._stagedHashes[section] = {};
            return;
        }

        this._stagedHashes = {
            runtime: {},
            tools: {},
            collection: {},
        };
    }

    private ensureManifest(): HashManifest {
        if (!this._manifest) {
            this.createEmpty();
        }

        return this._manifest as HashManifest;
    }

    private isFileNotFoundError(error: unknown): boolean {
        const message = this.getErrorMessage(error);
        return (
            message.includes('ENOENT') ||
            message.includes('not found') ||
            message.includes('Not found')
        );
    }

    private getErrorMessage(error: unknown): string {
        if (error instanceof Error && typeof error.message === 'string') {
            return error.message;
        }
        return String(error);
    }

    private isManifestParseError(error: unknown): boolean {
        if (error instanceof SyntaxError) {
            return true;
        }

        const message = this.getErrorMessage(error).toLowerCase();
        return (
            message.includes('json') ||
            message.includes('expected') ||
            message.includes('unexpected token')
        );
    }

    private isLowMemoryReadError(error: unknown): boolean {
        const message = this.getErrorMessage(error).toLowerCase();
        return message.includes('memory allocation failed');
    }

    private parseManifestContent(content: string): HashManifest {
        const normalized = String(content ?? '').trim();

        // Fast path: clean JSON payload.
        try {
            return JSON.parse(normalized) as HashManifest;
        } catch {
            // Continue with tolerant parsing below.
        }

        // Handle Python bytes literal form: b'...json...' / b"...json..."
        const isSingleBytesLiteral = normalized.startsWith("b'") && normalized.endsWith("'");
        const isDoubleBytesLiteral = normalized.startsWith('b"') && normalized.endsWith('"');
        if (isSingleBytesLiteral || isDoubleBytesLiteral) {
            const inner = normalized.slice(2, -1);
            const unescaped = inner
                .replace(/\\n/g, '\n')
                .replace(/\\r/g, '\r')
                .replace(/\\t/g, '\t')
                .replace(/\\'/g, "'")
                .replace(/\\"/g, '"')
                .replace(/\\\\/g, '\\')
                .trim();
            return JSON.parse(unescaped) as HashManifest;
        }

        // Handle protocol/boot noise around JSON payload by extracting
        // from first '{' to last '}'.
        const start = normalized.indexOf('{');
        const end = normalized.lastIndexOf('}');
        if (start !== -1 && end !== -1 && end > start) {
            const extracted = normalized.slice(start, end + 1);
            return JSON.parse(extracted) as HashManifest;
        }

        return JSON.parse(normalized) as HashManifest;
    }
}
