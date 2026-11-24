// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { DataTableView } from './data-table-view.js';
import { ToolbarView } from './toolbar-view.js';
import { IconProvider } from './icon-provider.js';
import { ButtonControl } from './controls/custom-runtime-controls.js';
import {
    classifyFirmwareCompatibility,
    firmwareChannelBadge,
    firmwarePackageCoverage,
    firmwarePackageLabel,
    firmwareTooltipLines,
    firmwareVersionParts,
    isImportedFirmware,
} from '../firmware/firmware-inventory.js';
import { formatBytes } from '../firmware/firmware-requests.js';
import type {
    FirmwareInventoryEntry,
    FirmwareCompatibility,
    FirmwareCompatibilityContext,
} from '../firmware/firmware-inventory.js';
import type {
    DisableableControl,
    FirmwareI18nService,
    FirmwareLogger,
} from './firmware-build-types.js';

/**
 * Icon per compatibility status that renders a marker.
 *
 * `compatible` is a tick — the image embeds every package the user ticked, so it
 * is usable for the current selection. `unknown` is a question mark: the image
 * has no sidecar, so its contents cannot be checked. `incomplete` is
 * deliberately absent: the list answers "is this image usable for what I
 * ticked?", and a missing package is reported in the Build Firmware group
 * instead of as a third, easily confused glyph. `otherTarget` is absent too —
 * those rows are filtered out of the list, and the words carry that meaning
 * whenever the status is rendered elsewhere.
 */
const COMPATIBILITY_ICONS: Partial<Record<FirmwareCompatibility, string>> = {
    compatible: IconProvider.check,
    unknown: IconProvider.progressQuestion,
};

/** Options wiring the panel into its owning view. */
export interface FirmwareInventoryPanelOptions {
    i18nService: FirmwareI18nService | null;
    logger: FirmwareLogger | null;
    getEntries(): FirmwareInventoryEntry[];
    getContext(): FirmwareCompatibilityContext;
    /**
     * Return every *built-in* package id the current target could embed.
     *
     * The baseline for the `complete` / `partial` badges: an image is complete
     * only when its sidecar embeds every id from here. Add-ons are not part of it
     * — the row's own add-ons badge already reports them. An empty answer means
     * "not known yet" and shows neither badge.
     */
    availablePackageIds(): string[];
    hasFeature(id: string): boolean;
    isBusy(): boolean;
    isRefreshing(): boolean;
    /**
     * Report whether a package id is an installed add-on.
     *
     * The inventory payload carries no provenance, so the panel asks the view,
     * which reads `DeviceRuntime.packageProvenance()`. The answer only decides
     * the cosmetic add-ons badge; an id the view cannot classify answers
     * `false` and simply shows no badge.
     */
    isAddonPackage(packageId: string): boolean;
    registerControl(
        control: DisableableControl,
        gate?: (snapshot: unknown) => boolean
    ): void;
    onSelect(entry: FirmwareInventoryEntry | null): void;
    onRefresh(): void;
    onDelete(entry: FirmwareInventoryEntry): void;
    onRequestImport(): void;
    onRequestImportUrl(): void;
    onExport(entry: FirmwareInventoryEntry): void;
}

/**
 * Owns the Local firmware section: the toolbar (Refresh / Delete), the count
 * line, the `DataTableView`, and the selected-image path.
 *
 * The panel renders the server's inventory and the client-side compatibility
 * classification; it knows nothing about the job client or the capability store,
 * which the view injects as callbacks. Delete is destructive and confirmed.
 */
export class FirmwareInventoryPanel {
    private _i18nService: FirmwareI18nService | null;
    private _logger: FirmwareLogger | null;
    private _options: FirmwareInventoryPanelOptions;

    private _table: DataTableView | null = null;
    private _detailsTable: DataTableView | null = null;
    private _packagesTable: DataTableView | null = null;
    private _detailsHintEl: HTMLElement | null = null;
    private _countEl: HTMLElement | null = null;
    private _progressEl: HTMLElement | null = null;
    private _refreshButton: ButtonControl | null = null;
    private _deleteButton: ButtonControl | null = null;
    private _importButton: ButtonControl | null = null;
    private _importUrlButton: ButtonControl | null = null;
    private _exportButton: ButtonControl | null = null;
    private _selectedPath: string | null = null;
    private _refreshFailed = false;
    private _newPaths = new Set<string>();

    constructor(options: FirmwareInventoryPanelOptions) {
        this._i18nService = options.i18nService;
        this._logger = options.logger;
        this._options = options;
    }

    /** Translate a key, falling back to the key itself when no i18n service is set. */
    private _t(key: string, params: Record<string, unknown> = {}): string {
        return this._i18nService ? this._i18nService.t(key, params) : key;
    }

    /** Return the selected image path, or `null`. */
    selectedPath(): string | null {
        return this._selectedPath;
    }

    /** Clear the selected image and re-render. */
    clearSelection(): void {
        this.selectPath(null);
    }

    /** Set the selected image path (used by the view for programmatic selection). */
    selectPath(path: string | null): void {
        this._selectedPath = path;
        this.renderInventorySection();
    }

    /** Mark the refresh-failed state, re-rendering the empty/error row. */
    setRefreshFailed(failed: boolean): void {
        this._refreshFailed = failed;
        this.renderInventorySection();
    }

    /** Mark freshly built image paths with the "new" badge, then re-render. */
    setNewPaths(paths: Set<string>): void {
        this._newPaths = paths;
        this.renderInventorySection();
    }

    /** Build the Local firmware section root: toolbar, count, and list. */
    buildInventorySection(): HTMLElement {
        const section = document.createElement('div');
        section.className = 'firmware-build-view__inventory';

        const toolbarHost = document.createElement('div');
        toolbarHost.className = 'firmware-inventory__toolbar';
        section.appendChild(toolbarHost);

        const toolbar = new ToolbarView({
            i18nService: this._i18nService,
            logger: this._logger,
        });

        this._refreshButton = new ButtonControl({
            label: this._t('firmwareBuild.inventory.refresh'),
            style: 'secondary',
            icon: IconProvider.refresh,
            iconOnly: true,
        });
        this._refreshButton.onClick(() => {
            this._options.onRefresh();
        });
        this._options.registerControl(this._refreshButton);
        toolbar.addControl(this._refreshButton, { className: 'firmware-build-view__action' });

        this._deleteButton = new ButtonControl({
            label: this._t('firmwareBuild.inventory.delete'),
            style: 'secondary',
            icon: IconProvider.deleteImage,
            iconOnly: true,
        });
        this._deleteButton.onClick(() => {
            const entry = this._selectedEntry();
            if (entry) {
                this._options.onDelete(entry);
            }
        });
        this._options.registerControl(this._deleteButton, () =>
            this._options.hasFeature('firmware-compile')
        );
        toolbar.addControl(this._deleteButton, { className: 'firmware-build-view__action' });

        this._importButton = new ButtonControl({
            label: this._t('firmwareBuild.inventory.import'),
            style: 'secondary',
            icon: IconProvider.download,
            iconOnly: true,
        });
        this._importButton.onClick(() => {
            this._options.onRequestImport();
        });
        this._options.registerControl(this._importButton, () =>
            this._options.hasFeature('firmware-compile')
        );
        toolbar.addControl(this._importButton, { className: 'firmware-build-view__action' });

        this._importUrlButton = new ButtonControl({
            label: this._t('firmwareBuild.inventory.importFromUrl'),
            style: 'secondary',
            icon: IconProvider.cloudDownload,
            iconOnly: true,
        });
        this._importUrlButton.onClick(() => {
            this._options.onRequestImportUrl();
        });
        this._options.registerControl(this._importUrlButton, () =>
            this._options.hasFeature('firmware-compile')
        );
        toolbar.addControl(this._importUrlButton, { className: 'firmware-build-view__action' });

        this._exportButton = new ButtonControl({
            label: this._t('firmwareBuild.inventory.export'),
            style: 'secondary',
            icon: IconProvider.upload,
            iconOnly: true,
        });
        this._exportButton.onClick(() => {
            const entry = this._selectedEntry();
            if (entry) {
                this._options.onExport(entry);
            }
        });
        this._options.registerControl(
            this._exportButton,
            () =>
                this._options.hasFeature('firmware-compile') &&
                this._options.hasFeature('local-file-access')
        );
        toolbar.addControl(this._exportButton, { className: 'firmware-build-view__action' });

        toolbar.attachTo(toolbarHost);

        this._countEl = document.createElement('div');
        this._countEl.className = 'firmware-inventory__count';
        section.appendChild(this._countEl);

        this._progressEl = document.createElement('div');
        this._progressEl.className = 'firmware-inventory__progress';
        this._progressEl.hidden = true;
        const bar = document.createElement('div');
        bar.className = 'firmware-inventory__progress-bar';
        this._progressEl.appendChild(bar);
        section.appendChild(this._progressEl);

        const listEl = document.createElement('div');
        listEl.className = 'firmware-inventory__list';
        section.appendChild(listEl);

        this._table = new DataTableView({
            columns: this._tableColumns(true),
            header: true,
            dense: true,
            striped: true,
            title: 'Local firmware',
            logger: this._logger,
        });
        this._table.attachTo(listEl);

        const detailsHost = document.createElement('div');
        detailsHost.className = 'firmware-inventory__details';
        section.appendChild(detailsHost);

        this._detailsTable = new DataTableView({
            columns: [{ label: '' }, { label: '' }],
            dense: true,
            header: false,
            title: this._t('firmwareBuild.inventory.detailsTitle'),
            logger: this._logger,
        });
        this._detailsTable.attachTo(detailsHost);

        const packagesHost = document.createElement('div');
        packagesHost.className = 'firmware-inventory__packages';
        section.appendChild(packagesHost);

        this._packagesTable = new DataTableView({
            columns: [
                { key: 'package', label: this._t('firmwareBuild.inventory.detailsPackage') },
                { key: 'version', label: this._t('firmwareBuild.inventory.detailsVersionLabel') },
                { key: 'packagesVariant', label: this._t('firmwareBuild.inventory.detailsVariant') },
            ],
            dense: true,
            header: true,
            title: this._t('firmwareBuild.inventory.detailsPackages'),
            logger: this._logger,
        });
        this._packagesTable.attachTo(packagesHost);

        this._detailsHintEl = document.createElement('div');
        this._detailsHintEl.className = 'firmware-inventory__details-hint';
        this._detailsHintEl.hidden = true;
        section.appendChild(this._detailsHintEl);

        return section;
    }

    /** Re-render the rows from `getEntries()` filtered to the current target. */
    renderInventorySection(): void {
        if (!this._table) {
            return;
        }
        const refreshing = this._options.isRefreshing();
        if (this._progressEl) {
            this._progressEl.hidden = !refreshing;
        }
        if (refreshing) {
            this._table.setRows([]);
            this._updateButtons();
            return;
        }
        const context = this._options.getContext();
        const entries = this._options
            .getEntries()
            .filter(
                (entry) =>
                    // An imported image is listed for its board because its
                    // `imported` runtime is not a Micro Otter runtime.
                    entry.boardId === context.boardId &&
                    (entry.runtimeId === context.runtimeId || isImportedFirmware(entry))
            );

        // The table is already filtered to one board + runtime, so the runtime
        // column is redundant unless more than one runtime is shown. Keep the
        // column only when the entries actually disagree.
        const showRuntimeColumn = new Set(entries.map((entry) => entry.runtimeId)).size > 1;
        this._table.setColumns(this._tableColumns(showRuntimeColumn));

        if (entries.length === 0) {
            const message = this._refreshFailed
                ? this._t('firmwareBuild.inventory.refreshFailed')
                : this._t('firmwareBuild.inventory.empty');
            this._table.setRows([{ cells: [{ text: message }] }]);
        } else {
            // Read the selectable catalog once per render: it is the baseline the
            // complete/partial badges compare every row's contents against.
            const availablePackageIds = this._options.availablePackageIds();
            this._table.setRows(
                entries.map((entry) =>
                    this._entryRow(entry, context, showRuntimeColumn, availablePackageIds)
                )
            );
        }
        this._setCount(entries.length);
        this._updateButtons();
        this._renderDetails();
    }

    /** Return the inventory-list columns, hiding the runtime column when redundant. */
    private _tableColumns(showRuntime: boolean): Array<{ key: string; label: string }> {
        const columns = [
            { key: 'firmwareVersion', label: this._t('firmwareBuild.inventory.firmwareVersion') },
            { key: 'micropython', label: this._t('firmwareBuild.inventory.micropython') },
        ];
        if (showRuntime) {
            columns.push({ key: 'runtime', label: this._t('firmwareBuild.inventory.runtime') });
        }
        return columns;
    }

    /** Render the details view below the table from the selected entry. */
    private _renderDetails(): void {
        if (!this._detailsTable) {
            return;
        }
        const entry = this._selectedEntry();
        if (!entry) {
            this._detailsTable.setRows([
                { cells: [{ text: this._t('firmwareBuild.inventory.detailsNoneSelected') }] },
            ]);
            this._packagesTable?.setRows([]);
            if (this._detailsHintEl) {
                this._detailsHintEl.hidden = true;
            }
            return;
        }

        const hashLabel = entry.contentHash ?? this._t('firmwareBuild.inventory.notAvailable');
        const rows: Array<{ cells: Array<{ text: string }> }> = [
            {
                cells: [
                    { text: this._t('firmwareBuild.inventory.detailsImage') },
                    { text: entry.filename },
                ],
            },
            ...(isImportedFirmware(entry)
                ? [
                      {
                          cells: [
                              { text: this._t('firmwareBuild.inventory.detailsOriginalFile') },
                              {
                                  text:
                                      entry.originalFilename ??
                                      this._t('firmwareBuild.inventory.notAvailable'),
                              },
                          ],
                      },
                      {
                          cells: [
                              { text: this._t('firmwareBuild.inventory.detailsImportTarget') },
                              {
                                  text:
                                      entry.targetId ??
                                      this._t('firmwareBuild.inventory.notAvailable'),
                              },
                          ],
                      },
                  ]
                : []),
            {
                cells: [
                    { text: this._t('firmwareBuild.inventory.firmwareVersion') },
                    { text: entry.runtimeFirmwareVersion },
                ],
            },
            {
                cells: [
                    { text: this._t('firmwareBuild.inventory.channel') },
                    {
                        text:
                            entry.channel ||
                            this._t('firmwareBuild.inventory.notAvailable'),
                    },
                ],
            },
            {
                cells: [
                    { text: this._t('firmwareBuild.inventory.versionSource') },
                    { text: entry.versionSource ?? this._t('firmwareBuild.inventory.notAvailable') },
                ],
            },
            {
                cells: [
                    { text: this._t('firmwareBuild.inventory.micropython') },
                    { text: entry.micropythonVersion },
                ],
            },
            {
                cells: [
                    { text: this._t('firmwareBuild.inventory.runtime') },
                    { text: entry.runtimeId },
                ],
            },
            {
                cells: [
                    { text: this._t('firmwareBuild.inventory.target') },
                    { text: entry.boardId },
                ],
            },
            {
                cells: [
                    { text: this._t('firmwareBuild.inventory.hash') },
                    { text: hashLabel },
                ],
            },
            {
                cells: [
                    { text: this._t('firmwareBuild.inventory.detailsSize') },
                    { text: formatBytes(entry.sizeBytes) },
                ],
            },
            {
                cells: [
                    { text: this._t('firmwareBuild.inventory.detailsModified') },
                    { text: entry.modifiedAt },
                ],
            },
        ];
        if (entry.notEmbedded.length > 0) {
            rows.push({
                cells: [
                    { text: this._t('firmwareBuild.inventory.detailsNotEmbedded') },
                    { text: entry.notEmbedded.join('\n') },
                ],
            });
        }
        if (Object.keys(entry.addonPackages).length > 0) {
            rows.push({
                cells: [
                    { text: this._t('firmwareBuild.inventory.detailsAddons') },
                    {
                        text: Object.entries(entry.addonPackages)
                            .map(([id, version]) => firmwarePackageLabel(entry, id, version))
                            .join('\n'),
                    },
                ],
            });
        }
        this._detailsTable.setRows(rows);

        const packageIds = Object.keys(entry.embeddedPackages);
        if (packageIds.length === 0) {
            this._packagesTable?.setRows([
                { cells: [{ text: this._t('firmwareBuild.inventory.notAvailable') }] },
            ]);
        } else {
            this._packagesTable?.setRows(
                packageIds.map((id) => ({
                    cells: [
                        { text: id },
                        { text: entry.embeddedPackages[id] },
                        { text: entry.packageVariants[id] ?? '' },
                    ],
                }))
            );
        }

        if (this._detailsHintEl) {
            this._detailsHintEl.hidden = false;
            this._detailsHintEl.textContent = this._t(
                'firmwareBuild.inventory.detailsDeployHint'
            );
        }
    }

    /**
     * Build one inventory row: a firmware-version button (latest/new/add-ons/
     * complete-or-partial badges + compatibility marker), the MicroPython
     * version, and the runtime (only when the column is shown).
     *
     * The compatibility marker judges the image against `context`, which carries
     * what the active collection needs — not which packages are ticked for the next
     * build. When the collection needs no package, no marker is drawn at all.
     *
     * Badges and the marker are glyphs, so each carries its translated label as
     * `title` and `aria-label`; the row's `aria-label` also names the
     * compatibility status when a marker is drawn, which is otherwise only encoded
     * in the marker image.
     *
     * `availablePackageIds` is the target's selectable catalog, passed in so the
     * coverage badge does not recompute it per row.
     */
    private _entryRow(
        entry: FirmwareInventoryEntry,
        context: FirmwareCompatibilityContext,
        showRuntimeColumn: boolean,
        availablePackageIds: readonly string[]
    ): { className?: string; cells: Array<Record<string, unknown>> } {
        const classification = classifyFirmwareCompatibility(entry, context);

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'firmware-inventory__row-button';
        button.addEventListener('click', () => {
            this._select(entry);
        });
        button.setAttribute('aria-pressed', String(this._selectedPath === entry.path));

        const versionLabel = entry.runtimeFirmwareVersion;
        const parts = firmwareVersionParts(versionLabel);
        const name = document.createElement('span');
        name.className = 'firmware-inventory__name';
        name.textContent = parts.base;
        button.appendChild(name);

        if (parts.preRelease) {
            const suffix = document.createElement('span');
            suffix.className = 'firmware-inventory__version-suffix';
            suffix.textContent = parts.preRelease;
            button.appendChild(suffix);
        }

        if (entry.isLatest) {
            button.appendChild(
                this._badge(
                    'firmware-inventory__badge firmware-inventory__badge--latest',
                    IconProvider.arrowUpBold,
                    this._t('firmwareBuild.inventory.latest')
                )
            );
        }

        if (isImportedFirmware(entry)) {
            button.appendChild(
                this._badge(
                    'firmware-inventory__badge firmware-inventory__badge--imported',
                    IconProvider.download,
                    this._t('firmwareBuild.inventory.imported')
                )
            );
        }

        if (entry.isChannelLatest && !entry.isLatest) {
            button.appendChild(
                this._badge(
                    'firmware-inventory__badge firmware-inventory__badge--latest-channel',
                    IconProvider.arrowUpBold,
                    this._t('firmwareBuild.inventory.latestInChannel', { channel: entry.channel })
                )
            );
        }

        const channelBadge = firmwareChannelBadge(entry);
        if (channelBadge !== null) {
            const isDev = channelBadge === 'dev';
            const badgeKey = isDev
                ? 'firmwareBuild.inventory.badgeDev'
                : 'firmwareBuild.inventory.badgeRelease';
            button.appendChild(
                this._badge(
                    `firmware-inventory__badge firmware-inventory__badge--${channelBadge}`,
                    isDev ? IconProvider.codeGenerator : IconProvider.nodePackage,
                    this._t(badgeKey)
                )
            );
        }

        if (this._newPaths.has(entry.path)) {
            button.appendChild(
                this._badge(
                    'firmware-inventory__badge firmware-inventory__badge--new',
                    IconProvider.newBox,
                    this._t('firmwareBuild.inventory.badgeNew')
                )
            );
        }

        if (this._hasEmbeddedAddons(entry)) {
            button.appendChild(
                this._badge(
                    'firmware-inventory__badge firmware-inventory__badge--addons',
                    IconProvider.plusCircleOutline,
                    this._t('firmwareBuild.inventory.badgeAddons')
                )
            );
        }

        // Coverage is a single, mutually exclusive answer: an image either has
        // everything the target offers (filled circle) or it is a subset build
        // (half circle). Text labels ride along as `title` / `aria-label`.
        const coverage = firmwarePackageCoverage(entry, availablePackageIds);
        if (coverage === 'complete') {
            button.appendChild(
                this._badge(
                    'firmware-inventory__badge firmware-inventory__badge--complete',
                    IconProvider.moonFull,
                    this._t('firmwareBuild.inventory.complete')
                )
            );
        } else if (coverage === 'partial') {
            button.appendChild(
                this._badge(
                    'firmware-inventory__badge firmware-inventory__badge--partial',
                    IconProvider.circleHalfFull,
                    this._t('firmwareBuild.inventory.partial')
                )
            );
        }

        // The marker answers "can this image run my collection?". A collection
        // that needs no package gets no marker at all: every image would qualify,
        // so a tick on all of them would be noise, and a "?" on the manifest-less
        // ones would suggest a question that does not exist.
        const hasRequirement = context.requiredPackageIds.length > 0;
        const markerIcon = hasRequirement ? COMPATIBILITY_ICONS[classification.status] : undefined;
        if (hasRequirement && classification.status === 'otherTarget') {
            const marker = document.createElement('span');
            marker.className = `firmware-inventory__marker firmware-inventory__marker--${classification.status}`;
            marker.textContent = this._t(`firmwareBuild.inventory.${classification.status}`);
            button.appendChild(marker);
        } else if (markerIcon) {
            button.appendChild(
                this._badge(
                    `firmware-inventory__marker firmware-inventory__marker--${classification.status}`,
                    markerIcon,
                    this._t(`firmwareBuild.inventory.${classification.status}`)
                )
            );
        }

        const tooltip = firmwareTooltipLines(entry).join('\n');
        button.title = tooltip;
        button.setAttribute(
            'aria-label',
            hasRequirement
                ? `${versionLabel}: ${this._t(`firmwareBuild.inventory.${classification.status}`)}\n${tooltip}`
                : `${versionLabel}\n${tooltip}`
        );

        const cells: Array<Record<string, unknown>> = [
            { node: button },
            { text: entry.micropythonVersion },
        ];
        if (showRuntimeColumn) {
            cells.push({ text: entry.runtimeId });
        }

        return {
            className:
                this._selectedPath === entry.path ? 'firmware-inventory__row--selected' : undefined,
            cells,
        };
    }

    /**
     * Build one glyph badge whose meaning lives in its `title`/`aria-label`.
     *
     * The glyph is a plain `<img>`; the stylesheet tints it per badge/tone with
     * the app-wide filter idiom, so this panel keeps to `createElement` and
     * property writes only (no inline styles).
     */
    private _badge(className: string, iconUrl: string, label: string): HTMLElement {
        const badge = document.createElement('span');
        badge.className = className;
        badge.title = label;
        badge.setAttribute('role', 'img');
        badge.setAttribute('aria-label', label);

        const icon = document.createElement('img');
        icon.className = 'firmware-inventory__badge-icon';
        icon.src = iconUrl;
        icon.alt = '';
        badge.appendChild(icon);
        return badge;
    }

    /**
     * Report whether the image embeds an add-on package.
     *
     * A v2 sidecar splits its contents: `embeddedPackages` holds built-ins and
     * `addonPackages` holds add-ons, so that object is the authoritative signal.
     * An id the runtime still classifies as an add-on is honoured too, which
     * covers a legacy sidecar that recorded the add-on in `embeddedPackages`.
     */
    private _hasEmbeddedAddons(entry: FirmwareInventoryEntry): boolean {
        if (!entry.hasManifest) {
            return false;
        }
        if (Object.keys(entry.addonPackages).length > 0) {
            return true;
        }
        return Object.keys(entry.embeddedPackages).some((packageId) =>
            this._options.isAddonPackage(packageId)
        );
    }

    /** Select one image, notify the view, and re-render the selected row. */
    private _select(entry: FirmwareInventoryEntry): void {
        this._selectedPath = entry.path;
        this._options.onSelect(entry);
        this.renderInventorySection();
    }

    /** Return the currently selected entry, or `null`. */
    private _selectedEntry(): FirmwareInventoryEntry | null {
        if (!this._selectedPath) {
            return null;
        }
        return (
            this._options
                .getEntries()
                .find((entry) => entry.path === this._selectedPath) ?? null
        );
    }

    /** Set the count line text. */
    private _setCount(count: number): void {
        if (!this._countEl) {
            return;
        }
        this._countEl.textContent = this._t('firmwareBuild.inventory.count', { count });
    }

    /** Enable/disable the toolbar buttons from selection and job state. */
    private _updateButtons(): void {
        this._refreshButton?.setDisabled(this._options.isBusy());
        this._deleteButton?.setDisabled(
            this._options.isBusy() ||
                !this._selectedPath ||
                !this._options.hasFeature('firmware-compile')
        );
        this._importButton?.setDisabled(
            this._options.isBusy() || !this._options.hasFeature('firmware-compile')
        );
        this._importUrlButton?.setDisabled(
            this._options.isBusy() || !this._options.hasFeature('firmware-compile')
        );
        this._exportButton?.setDisabled(
            this._options.isBusy() ||
                !this._selectedPath ||
                !this._options.hasFeature('firmware-compile') ||
                !this._options.hasFeature('local-file-access')
        );
    }
}

