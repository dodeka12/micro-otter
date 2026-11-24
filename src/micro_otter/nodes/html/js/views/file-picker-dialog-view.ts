// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { ModalDialogView } from './modal-dialog-view.js';
import { formatBytes } from '../firmware/firmware-requests.js';
import type { FsListEntry, FsListResult } from '../firmware/firmware-requests.js';
import type { FirmwareI18nService } from './firmware-build-types.js';

/**
 * A modal dialog that returns a **path on the server's machine**, never file contents.
 *
 * Two behaviours of one component: `mode: 'file'` picks a package/archive, and
 * `mode: 'directory'` picks a destination folder. It talks to the server only
 * through an injected `listDirectory` function, so it is testable in jsdom with
 * no socket, and it never uses `<input type="file">`, `FileReader`, `fetch`, or a
 * raw `WebSocket` — the browser cannot expose a path, which is the exact problem
 * this dialog exists to remove.
 */

type ModalDialogViewOptions = ConstructorParameters<typeof ModalDialogView>[0];
type LoggerLike = ModalDialogViewOptions extends { logger?: infer T } ? T : unknown;

/** Which behaviour the dialog runs in. */
export type FilePickerMode = 'file' | 'directory';

/** A function that lists one directory through the injected transport. */
export type FsListProvider = (request: {
    requestId: string;
    path?: string;
    extensions?: string[];
    showHidden?: boolean;
}) => Promise<FsListResult>;

export interface FilePickerDialogViewOptions {
    mode?: FilePickerMode;
    title?: string;
    hint?: string | null;
    confirmLabel?: string;
    cancelLabel?: string;
    extensions?: string[];
    path?: string | null;
    listDirectory?: FsListProvider;
    i18nService?: FirmwareI18nService | null;
    logger?: LoggerLike;
    id?: string | null;
}

export interface FilePickerDialogConfirmResult extends Record<string, unknown> {
    path: string;
    kind: FilePickerMode;
}

export interface FilePickerDialogSerialized extends Record<string, unknown> {
    type: 'FilePickerDialogView';
    mode: FilePickerMode;
    extensions: string[];
    path: string | null;
}

interface FilePickerDialogDeserializeData {
    title?: string;
    id?: string | null;
    mode?: FilePickerMode;
    hint?: string | null;
    confirmLabel?: string;
    cancelLabel?: string;
    extensions?: string[];
    path?: string | null;
}

/** The icon shown per entry kind. */
const KIND_ICONS: Record<FsListEntry['kind'], string> = {
    directory: '📁',
    file: '📄',
    symlink: '🔗',
};

export class FilePickerDialogView extends ModalDialogView {
    mode: FilePickerMode;
    hint: string | null;
    extensions: string[];
    path: string | null;

    private _listDirectory: FsListProvider;

    private _selectedPath: string | null = null;
    private _currentPath: string | null = null;
    private _messageEl: HTMLDivElement | null = null;
    private _locationEl: HTMLDivElement | null = null;
    private _listEl: HTMLDivElement | null = null;
    private _errorEl: HTMLDivElement | null = null;
    private _busy = false;
    private _latestRequestId: string | null = null;

    constructor({
        mode = 'file',
        title = 'Browse server files',
        hint = null,
        confirmLabel = 'Select',
        cancelLabel = 'Cancel',
        extensions = [],
        path = null,
        listDirectory,
        i18nService = null,
        logger = null,
        id = null,
    }: FilePickerDialogViewOptions = {}) {
        super({
            title,
            icon: mode === 'directory' ? '📁' : '📄',
            confirmLabel,
            cancelLabel,
            id,
            logger,
            i18nService,
        });
        this.mode = mode;
        this.extensions = extensions;
        this.path = path;
        this._listDirectory =
            listDirectory ??
            (async () => ({ path: '/', parent: null, roots: [], entries: [], truncated: false }));
        this.hint = hint;
    }

    /** Translate a key, falling back to the key itself when no i18n service is set. */
    private _t(key: string, params: Record<string, unknown> = {}): string {
        return this.t(key, params);
    }

    /** Return the explainer sentence, defaulted per mode (D12). */
    private _hintText(): string {
        if (this.hint !== null && this.hint !== undefined) {
            return this.hint;
        }
        return this.mode === 'directory'
            ? this._t('firmwareBuild.filePicker.hintDirectory')
            : this._t('firmwareBuild.filePicker.hint');
    }

    protected override _buildBody(): HTMLElement {
        const body = document.createElement('div');
        body.className = 'modal-dialog__body';

        this._messageEl = document.createElement('div');
        this._messageEl.className = 'file-picker-dialog__message';
        this._messageEl.textContent = this._hintText();
        body.appendChild(this._messageEl);

        this._locationEl = document.createElement('div');
        this._locationEl.className = 'file-picker-dialog__location';
        body.appendChild(this._locationEl);

        this._listEl = document.createElement('div');
        this._listEl.className = 'file-picker-dialog__list';
        this._listEl.setAttribute('role', 'listbox');
        this._listEl.setAttribute('tabindex', '0');
        body.appendChild(this._listEl);

        this._errorEl = document.createElement('div');
        this._errorEl.className = 'file-picker-dialog__error';
        this._errorEl.style.display = 'none';
        body.appendChild(this._errorEl);

        return body;
    }

    /** Render the location bar (current path, `..`, and the root shortcuts). */
    private _renderLocation(listing: FsListResult): void {
        if (!this._locationEl) {
            return;
        }
        this._locationEl.textContent = '';
        this._currentPath = listing.path;

        const pathEl = document.createElement('span');
        pathEl.className = 'file-picker-dialog__location-path';
        pathEl.textContent = listing.path;
        pathEl.title = listing.path;
        this._locationEl.appendChild(pathEl);

        if (listing.parent) {
            const parentBtn = document.createElement('button');
            parentBtn.type = 'button';
            parentBtn.className = 'file-picker-dialog__entry file-picker-dialog__entry--parent';
            parentBtn.textContent = this._t('firmwareBuild.filePicker.parentDirectory');
            parentBtn.addEventListener('click', () => void this._load(listing.parent as string));
            this._locationEl.appendChild(parentBtn);
        }

        for (const root of listing.roots) {
            const rootBtn = document.createElement('button');
            rootBtn.type = 'button';
            rootBtn.className = 'file-picker-dialog__entry file-picker-dialog__entry--root';
            rootBtn.textContent = this._t(`firmwareBuild.filePicker.roots.${root.id}`) || root.path;
            rootBtn.addEventListener('click', () => void this._load(root.path));
            this._locationEl.appendChild(rootBtn);
        }
    }

    /** Load one directory, guarding against stale responses. */
    private async _load(path: string | null): Promise<void> {
        const requestId = `fs-${Math.random().toString(36).slice(2)}`;
        this._latestRequestId = requestId;
        this._busy = true;
        this._clearError();
        this._showLoading();
        try {
            const listing = await this._listDirectory({
                requestId,
                ...(path ? { path } : {}),
                extensions: this.extensions,
            });
            if (this._latestRequestId !== requestId) {
                return;
            }
            this._busy = false;
            this._renderLocation(listing);
            this._renderEntries(listing);
        } catch (error) {
            if (this._latestRequestId !== requestId) {
                return;
            }
            this._busy = false;
            const code = (error as { code?: string }).code;
            const detail = (error as { message?: string }).message;
            const message = this._t('firmwareBuild.filePicker.listFailed');
            this._showError(code ? `${message} (${code})` : `${message}: ${detail ?? ''}`);
            this._renderEmpty();
        }
    }

    override afterAttach(): void {
        super.afterAttach();
        void this._load(this.path);
    }

    /** Show the loading row in the list. */
    private _showLoading(): void {
        if (!this._listEl) {
            return;
        }
        this._listEl.textContent = '';
        const row = document.createElement('div');
        row.className = 'file-picker-dialog__entry file-picker-dialog__entry--text';
        row.textContent = this._t('firmwareBuild.filePicker.loading');
        this._listEl.appendChild(row);
    }

    /** Show the empty row in the list. */
    private _renderEmpty(): void {
        if (!this._listEl) {
            return;
        }
        this._listEl.textContent = '';
        const row = document.createElement('div');
        row.className = 'file-picker-dialog__entry file-picker-dialog__entry--text';
        row.textContent = this._t('firmwareBuild.filePicker.empty');
        this._listEl.appendChild(row);
    }

    /** Render the entry list from one listing. */
    private _renderEntries(listing: FsListResult): void {
        if (!this._listEl) {
            return;
        }
        this._listEl.textContent = '';
        if (listing.entries.length === 0) {
            this._renderEmpty();
            return;
        }
        for (const entry of listing.entries) {
            this._listEl.appendChild(this._buildEntry(entry));
        }
    }

    /** Build one entry row. */
    private _buildEntry(entry: FsListEntry): HTMLElement {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'file-picker-dialog__entry';
        row.dataset.path = entry.path;
        row.dataset.kind = entry.kind;

        const icon = document.createElement('span');
        icon.className = 'file-picker-dialog__entry-icon';
        icon.textContent = KIND_ICONS[entry.kind];
        row.appendChild(icon);

        const name = document.createElement('span');
        name.className = 'file-picker-dialog__entry-name';
        name.textContent = entry.name;
        row.appendChild(name);

        if (entry.kind === 'file') {
            const size = document.createElement('span');
            size.className = 'file-picker-dialog__entry-size';
            size.textContent = formatBytes(entry.sizeBytes);
            row.appendChild(size);
        }

        if (entry.kind === 'symlink') {
            row.disabled = true;
            row.title = this._t('firmwareBuild.filePicker.symlinkNotSelectable');
        } else if (entry.kind === 'directory') {
            row.addEventListener('click', () => void this._load(entry.path));
        } else {
            row.addEventListener('click', () => this._select(entry));
        }
        return row;
    }


    /** Select one file entry. */
    private _select(entry: FsListEntry): void {
        this._selectedPath = entry.path;
        if (!this._listEl) {
            return;
        }
        for (const child of Array.from(this._listEl.children)) {
            const button = child as HTMLElement;
            const selected = button.dataset.path === entry.path;
            button.setAttribute('aria-selected', selected ? 'true' : 'false');
            button.classList.toggle('is-selected', selected);
        }
    }

    /** Show the error line. */
    private _showError(message: string): void {
        if (this._errorEl) {
            this._errorEl.textContent = message;
            this._errorEl.style.display = 'block';
        }
    }

    /** Clear the error line. */
    private _clearError(): void {
        if (this._errorEl) {
            this._errorEl.textContent = '';
            this._errorEl.style.display = 'none';
        }
    }

    protected override _onConfirm(): FilePickerDialogConfirmResult {
        if (this.mode === 'directory') {
            if (!this._currentPath) {
                throw new Error(this._t('firmwareBuild.filePicker.noSelection'));
            }
            return { path: this._currentPath, kind: 'directory' };
        }
        if (!this._selectedPath) {
            throw new Error(this._t('firmwareBuild.filePicker.noSelection'));
        }
        return { path: this._selectedPath, kind: 'file' };
    }

    override confirm(): void {
        try {
            super.confirm();
        } catch (error) {
            this._showError(
                error instanceof Error ? error.message : this._t('firmwareBuild.filePicker.noSelection')
            );
        }
    }

    override serialize(): FilePickerDialogSerialized {
        return {
            ...super.serialize(),
            type: 'FilePickerDialogView',
            mode: this.mode,
            extensions: this.extensions,
            path: this.path,
        };
    }

    static deserialize(
        data: FilePickerDialogDeserializeData,
        logger: LoggerLike = null
    ): FilePickerDialogView {
        return new FilePickerDialogView({
            title: data.title,
            id: data.id,
            mode: data.mode,
            hint: data.hint,
            confirmLabel: data.confirmLabel,
            cancelLabel: data.cancelLabel,
            extensions: data.extensions,
            path: data.path,
            logger,
        });
    }
}

