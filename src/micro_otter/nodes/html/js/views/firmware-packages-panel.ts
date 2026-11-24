// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { DataTableView } from './data-table-view.js';
import { ToolbarView } from './toolbar-view.js';
import { IconProvider } from './icon-provider.js';
import { ButtonControl } from './controls/custom-runtime-controls.js';
import { DropdownControl } from './controls/dropdown-control.js';
import {
    createPackageCapabilityContext,
    evaluateRequiredCapabilities,
} from '../core/capability-requirements.js';
import {
    collectUsedPackageIds,
} from '../data/node-package-usage.js';
import {
    variantDescription,
    variantDisplayName,
} from '../data/package-resolver.js';
import type {
    DisableableControl,
    FirmwareI18nService,
    FirmwareLogger,
    FirmwareNodePackageLike,
    FirmwareRuntimeLike,
    FirmwareTargetLike,
    PackageCapabilityContext,
} from './firmware-build-types.js';

/** Options wiring the panel into its owning view. */
export interface FirmwarePackagesPanelOptions {
    i18nService: FirmwareI18nService | null;
    logger: FirmwareLogger | null;
    getRuntime(): FirmwareRuntimeLike | null;
    getTarget(): FirmwareTargetLike | null;
    hasFeature(id: string): boolean;
    registerControl(
        control: DisableableControl,
        gate?: (snapshot: unknown) => boolean
    ): void;
    onSelectionChange(): void;
    onRefreshLocalPackages(): void;
    onRefreshAddons(): void;
    /** Whether a `WS /firmware` job is running, so the add-on actions must wait. */
    isBusy(): boolean;
    /** Ask the view to open the server-side picker for a `.zip` add-on path. */
    onRequestInstallAddon(): void;
    /** Ask the view to open the *from URL…* dialog for an add-on archive. */
    onRequestInstallAddonUrl(): void;
    /** Remove the ticked add-on ids. */
    onRemoveAddons(packageIds: string[]): void;
    getUsedNodeTypeIds(): string[];
}

/** Per-row state computed by the renderer and passed to the row builder. */
interface PackageRowOptions {
    isAddon: boolean;
    isLocal: boolean;
    selectable: boolean;
    context: PackageCapabilityContext | null;
}

/**
 * Owns the built-in package checklist: the toolbar (Select all / Clear / Refresh),
 * the count line, the `DataTableView`, and the selected-package-id store.
 *
 * The panel knows nothing about the job client or the capability store; the view
 * injects those as callbacks so the panel stays a pure render/selection concern.
 */
export class FirmwarePackagesPanel {
    private _i18nService: FirmwareI18nService | null;
    private _logger: FirmwareLogger | null;
    private _options: FirmwarePackagesPanelOptions;

    private _packageTable: DataTableView | null = null;
    private _packageCountEl: HTMLElement | null = null;
    private _packageListEl: HTMLElement | null = null;
    private _packagesToolbar: ToolbarView | null = null;
    private _selectAllButton: ButtonControl | null = null;
    private _clearButton: ButtonControl | null = null;
    private _refreshButton: ButtonControl | null = null;
    private _minimalButton: ButtonControl | null = null;
    private _packageHintEl: HTMLElement | null = null;

    private _addonsTable: DataTableView | null = null;
    private _addonsCountEl: HTMLElement | null = null;
    private _addonsListEl: HTMLElement | null = null;
    private _addonsToolbar: ToolbarView | null = null;
    private _addonsSelectAllButton: ButtonControl | null = null;
    private _addonsClearButton: ButtonControl | null = null;
    private _addonsRefreshButton: ButtonControl | null = null;
    private _installAddonButton: ButtonControl | null = null;
    private _installAddonUrlButton: ButtonControl | null = null;
    private _removeAddonsButton: ButtonControl | null = null;
    private _addonsErrorEl: HTMLElement | null = null;

    private _selectedPackageIds = new Set<string>();
    private _packagesInitializedForRuntimeId: string | null = null;
    private _addonsInitializedForRuntimeId: string | null = null;
    private _variantChoices = new Map<string, string>();

    constructor(options: FirmwarePackagesPanelOptions) {
        this._i18nService = options.i18nService;
        this._logger = options.logger;
        this._options = options;
    }

    /** Translate a key, falling back to the key itself when no i18n service is set. */
    private _t(key: string, params: Record<string, unknown> = {}): string {
        return this._i18nService ? this._i18nService.t(key, params) : key;
    }

    /** Return the active locale code, defaulting to `en`. */
    private _locale(): string {
        return this._i18nService?.currentLocale || 'en';
    }

    /** Return the current selected-package-id set (read-only by convention). */
    selectedPackageIds(): Set<string> {
        return this._selectedPackageIds;
    }

    /** Return the explicit variant choices (packageId → variantId), omitting empty ones. */
    packageVariants(): Record<string, string> {
        const variants: Record<string, string> = {};
        for (const [packageId, variantId] of this._variantChoices) {
            if (variantId) {
                variants[packageId] = variantId;
            }
        }
        return variants;
    }

    /**
     * Return every *built-in* package id the current target could embed.
     *
     * The coverage baseline for the inventory list's `complete` / `partial`
     * badges. Installed add-ons are deliberately absent: a row already reports an
     * embedded add-on with its own badge, so folding them in would mark a build
     * `partial` merely because the user did not tick every installed add-on.
     *
     * An empty answer (no runtime or no target yet) means "cannot tell" rather
     * than "nothing is available".
     */
    availablePackageIds(): string[] {
        const runtime = this._options.getRuntime();
        if (!runtime) {
            return [];
        }
        const target = this._options.getTarget();
        const context = target ? createPackageCapabilityContext(target) : null;
        return this._selectablePackageIds(runtime, context);
    }

    /**
     * Return the package ids the active collection needs a firmware image to
     * supply.
     *
     * The single source of truth behind both the **Minimal** button and the
     * inventory list's compatibility tick, so the two can never disagree. Resolved
     * from the collection's node types through the same capability filter the
     * checklist uses, so an id that cannot be ticked is never demanded either.
     * Includes installed add-ons, because a collection using an add-on node needs
     * that add-on in the firmware.
     *
     * An empty array means "this collection needs no package from firmware" — the
     * inventory then shows no compatibility marker at all rather than claiming a
     * tick for every image. Called by the owning view when it builds the
     * inventory's compatibility context.
     */
    collectionPackageIds(): string[] {
        return [...this._resolveCollectionPackages().selectedIds];
    }

    /**
     * Resolve what the active collection needs, plus the bookkeeping the Minimal
     * button uses to explain a degenerate result. Called by `_applyMinimal()` and
     * `collectionPackageIds()`.
     *
     * *usedCount* is how many distinct packages the collection uses at all;
     * *unresolved* is `true` when at least one of them is not selectable for the
     * current target (capability or provenance), so the button can warn that the
     * result is partial. Without a runtime everything is empty.
     */
    private _resolveCollectionPackages(): {
        selectedIds: Set<string>;
        usedCount: number;
        unresolved: boolean;
    } {
        const runtime = this._options.getRuntime();
        if (!runtime) {
            return { selectedIds: new Set<string>(), usedCount: 0, unresolved: false };
        }
        const target = this._options.getTarget();
        const context = target ? createPackageCapabilityContext(target) : null;
        const usedIds = collectUsedPackageIds(
            this._options.getUsedNodeTypeIds(),
            runtime.nodePackages
        );
        const selectable = new Set([
            ...this._selectablePackageIds(runtime, context),
            ...this._selectableAddonIds(runtime, context),
        ]);
        const selectedIds = new Set<string>();
        let unresolved = false;
        for (const id of usedIds) {
            if (selectable.has(id)) {
                selectedIds.add(id);
            } else {
                unresolved = true;
            }
        }
        return { selectedIds, usedCount: usedIds.size, unresolved };
    }

    /** Build the Packages section root: toolbar buttons, count, and list. */
    buildPackagesSection(): HTMLElement {
        const section = document.createElement('div');
        section.className = 'firmware-build-view__packages';

        const toolbarHost = document.createElement('div');
        toolbarHost.className = 'firmware-build-view__packages-toolbar';
        section.appendChild(toolbarHost);

        this._packagesToolbar = new ToolbarView({
            i18nService: this._i18nService,
            logger: this._logger,
        });

        this._minimalButton = new ButtonControl({
            label: this._t('firmwareBuild.packages.minimal'),
            style: 'secondary',
            icon: IconProvider.filterMinusOutline,
            iconOnly: true,
        });
        this._minimalButton.onClick(() => this._applyMinimal());
        this._options.registerControl(this._minimalButton);
        this._packagesToolbar.addControl(this._minimalButton, { className: 'firmware-build-view__action' });

        this._selectAllButton = new ButtonControl({
            label: this._t('firmwareBuild.packages.selectAll'),
            style: 'secondary',
            icon: IconProvider.checkboxMultipleMarked,
            iconOnly: true,
        });
        this._selectAllButton.onClick(() => this._setAllPackages(true));
        this._options.registerControl(this._selectAllButton);
        this._packagesToolbar.addControl(this._selectAllButton, { className: 'firmware-build-view__action' });

        this._clearButton = new ButtonControl({
            label: this._t('firmwareBuild.packages.clear'),
            style: 'secondary',
            icon: IconProvider.checkboxMultipleBlankOutline,
            iconOnly: true,
        });
        this._clearButton.onClick(() => this._setAllPackages(false));
        this._options.registerControl(this._clearButton);
        this._packagesToolbar.addControl(this._clearButton, { className: 'firmware-build-view__action' });

        this._refreshButton = new ButtonControl({
            label: this._t('firmwareBuild.packages.refresh'),
            style: 'secondary',
            icon: IconProvider.refresh,
            iconOnly: true,
        });
        this._refreshButton.onClick(() => {
            void this._options.onRefreshLocalPackages();
        });
        this._options.registerControl(this._refreshButton, () =>
            this._options.hasFeature('local-package-scan')
        );
        this._packagesToolbar.addControl(this._refreshButton, { className: 'firmware-build-view__action' });

        this._packagesToolbar.attachTo(toolbarHost);

        this._packageCountEl = document.createElement('div');
        this._packageCountEl.className = 'firmware-build-view__package-count';
        section.appendChild(this._packageCountEl);

        this._packageHintEl = document.createElement('div');
        this._packageHintEl.className = 'firmware-build-view__package-hint';
        this._packageHintEl.setAttribute('role', 'status');
        this._packageHintEl.hidden = true;
        section.appendChild(this._packageHintEl);

        this._packageListEl = document.createElement('div');
        this._packageListEl.className = 'firmware-build-view__packages-list';
        section.appendChild(this._packageListEl);

        this._packageTable = new DataTableView({
            columns: [
                { key: 'select', label: '', align: 'center' },
                { key: 'name', label: this._t('firmwareBuild.packages.title') },
                { key: 'version', label: '', align: 'start' },
                { key: 'note', label: '', cellClassName: 'firmware-build-view__package-note' },
            ],
            header: true,
            dense: true,
            striped: true,
            title: 'Packages',
            logger: this._logger,
        });
        this._packageTable.attachTo(this._packageListEl);

        // One delegated change listener for the whole checklist. Rows are rebuilt
        // on every render, so per-row listeners are never attached.
        this._packageListEl.addEventListener('change', (event) => {
            const target = event.target;
            if (!(target instanceof HTMLInputElement) || !target.dataset.packageId) {
                return;
            }
            if (target.checked) {
                this._selectedPackageIds.add(target.dataset.packageId);
            } else {
                this._selectedPackageIds.delete(target.dataset.packageId);
            }
            this._refreshPackageCount();
            this._options.onSelectionChange();
        });

        return section;
    }

    /** Re-render the built-in package rows and count. */
    renderPackagesSection(): void {
        if (!this._packageTable) {
            return;
        }
        const runtime = this._options.getRuntime();
        if (!runtime) {
            this._packageTable.setRows([]);
            this._setPackageCount(0, 0);
            return;
        }

        if (runtime.id !== this._packagesInitializedForRuntimeId) {
            this._applyPackageDefaults(runtime);
        }

        const target = this._options.getTarget();
        const context = target ? createPackageCapabilityContext(target) : null;
        const selectableIds = this._selectablePackageIds(runtime, context);
        this._pruneSelection(runtime, context);

        const rows = [];
        for (const pkg of runtime.nodePackages) {
            const id = pkg.id;
            if (!id || runtime.packageProvenance(id) === 'addon') {
                continue;
            }
            const isLocal = runtime.nodePackagesLocal.includes(id);
            const capable = this._packageCapable(pkg, context);
            const selectable = !isLocal && capable;
            rows.push(
                this._packageRow(runtime, pkg, { isAddon: false, isLocal, selectable, context })
            );
        }
        if (rows.length === 0) {
            rows.push({ cells: [{ text: this._t('firmwareBuild.packages.empty') }] });
        }
        this._packageTable.setRows(rows);
        this._setPackageCount(this._selectedBuiltinCount(runtime), selectableIds.length);
    }

    /**
     * Return the ticked add-on ids in sorted order.
     *
     * Built-in ids are ignored: Remove only ever targets installed add-ons. Sorting
     * keeps the wire payload and the confirmation text stable whatever order the
     * user ticked the rows in. An absent runtime answers an empty list.
     */
    selectedAddonIds(): string[] {
        const runtime = this._options.getRuntime();
        if (!runtime) {
            return [];
        }
        return [...this._selectedPackageIds]
            .filter((id) => runtime.packageProvenance(id) === 'addon')
            .sort();
    }

    /** Re-render the installed add-on rows and count, then re-gate the actions. */
    renderAddonsSection(): void {
        this._renderAddonsBody();
        this.updateAddonsButtons();
    }

    /** Re-render the installed add-on rows and count. */
    private _renderAddonsBody(): void {
        if (!this._addonsTable) {
            return;
        }
        const runtime = this._options.getRuntime();
        if (!runtime) {
            this._addonsTable.setRows([]);
            this._setAddonsCount(0, 0);
            return;
        }

        if (runtime.id !== this._addonsInitializedForRuntimeId) {
            this._applyAddonsDefaults(runtime);
        }

        if (!this._options.hasFeature('node-package-addons')) {
            for (const id of [...this._selectedPackageIds]) {
                if (runtime.packageProvenance(id) === 'addon') {
                    this._selectedPackageIds.delete(id);
                }
            }
            this._addonsTable.setRows([]);
            this._setAddonsCount(0, 0);
            return;
        }

        const target = this._options.getTarget();
        const context = target ? createPackageCapabilityContext(target) : null;
        const selectableIds = this._selectableAddonIds(runtime, context);
        this._pruneSelection(runtime, context);

        const rows = [];
        for (const pkg of runtime.nodePackages) {
            const id = pkg.id;
            if (!id || runtime.packageProvenance(id) !== 'addon') {
                continue;
            }
            const isLocal = runtime.nodePackagesLocal.includes(id);
            const capable = this._packageCapable(pkg, context);
            const selectable = !isLocal && capable;
            rows.push(
                this._packageRow(runtime, pkg, { isAddon: true, isLocal, selectable, context })
            );
        }
        if (rows.length === 0) {
            rows.push({ cells: [{ text: this._t('firmwareBuild.addons.empty') }] });
        }
        this._addonsTable.setRows(rows);
        this._setAddonsCount(this._selectedAddonCount(runtime), selectableIds.length);
    }

    /** Build the Installed add-ons section root: scoped toolbar, count, and list. */
    buildAddonsSection(): HTMLElement {
        const section = document.createElement('div');
        section.className = 'firmware-build-view__addons';

        const toolbarHost = document.createElement('div');
        toolbarHost.className = 'firmware-build-view__addons-toolbar';
        section.appendChild(toolbarHost);
        this._addonsToolbar = new ToolbarView({
            i18nService: this._i18nService,
            logger: this._logger,
        });

        this._addonsSelectAllButton = new ButtonControl({
            label: this._t('firmwareBuild.addons.selectAll'),
            style: 'secondary',
            icon: IconProvider.checkboxMultipleMarked,
            iconOnly: true,
        });
        this._addonsSelectAllButton.onClick(() => this._setAllAddons(true));
        this._options.registerControl(this._addonsSelectAllButton);
        this._addonsToolbar.addControl(this._addonsSelectAllButton, { className: 'firmware-build-view__action' });

        this._addonsClearButton = new ButtonControl({
            label: this._t('firmwareBuild.addons.clear'),
            style: 'secondary',
            icon: IconProvider.checkboxMultipleBlankOutline,
            iconOnly: true,
        });
        this._addonsClearButton.onClick(() => this._setAllAddons(false));
        this._options.registerControl(this._addonsClearButton);
        this._addonsToolbar.addControl(this._addonsClearButton, { className: 'firmware-build-view__action' });

        this._addonsRefreshButton = new ButtonControl({
            label: this._t('firmwareBuild.addons.refresh'),
            style: 'secondary',
            icon: IconProvider.refresh,
            iconOnly: true,
        });
        this._addonsRefreshButton.onClick(() => {
            void this._options.onRefreshAddons();
        });
        this._options.registerControl(this._addonsRefreshButton, () =>
            this._options.hasFeature('node-package-addons')
        );
        this._addonsToolbar.addControl(this._addonsRefreshButton, { className: 'firmware-build-view__action' });

        this._installAddonButton = new ButtonControl({
            label: this._t('firmwareBuild.addons.install'),
            style: 'secondary',
            icon: IconProvider.uploadFile,
            iconOnly: true,
        });
        this._installAddonButton.onClick(() => {
            this._options.onRequestInstallAddon();
        });
        this._options.registerControl(
            this._installAddonButton,
            () => this._options.hasFeature('local-file-access')
        );
        this._addonsToolbar.addControl(this._installAddonButton, {
            className: 'firmware-build-view__action',
        });

        this._installAddonUrlButton = new ButtonControl({
            label: this._t('firmwareBuild.addons.installFromUrl'),
            style: 'secondary',
            icon: IconProvider.cloudDownload,
            iconOnly: true,
        });
        this._installAddonUrlButton.onClick(() => {
            this._options.onRequestInstallAddonUrl();
        });
        this._options.registerControl(this._installAddonUrlButton);
        this._addonsToolbar.addControl(this._installAddonUrlButton, {
            className: 'firmware-build-view__action',
        });

        this._removeAddonsButton = new ButtonControl({
            label: this._t('firmwareBuild.addons.remove'),
            style: 'secondary',
            icon: IconProvider.deleteImage,
            iconOnly: true,
        });
        this._removeAddonsButton.onClick(() => {
            const ids = this.selectedAddonIds();
            if (ids.length > 0) {
                this._options.onRemoveAddons(ids);
            }
        });
        this._options.registerControl(this._removeAddonsButton);
        this._addonsToolbar.addControl(this._removeAddonsButton, {
            className: 'firmware-build-view__action',
        });

        this._addonsToolbar.attachTo(toolbarHost);

        this._addonsCountEl = document.createElement('div');
        this._addonsCountEl.className = 'firmware-build-view__addons-count';
        section.appendChild(this._addonsCountEl);

        this._addonsErrorEl = document.createElement('div');
        this._addonsErrorEl.className = 'firmware-build-view__addons-error';
        this._addonsErrorEl.hidden = true;
        section.appendChild(this._addonsErrorEl);

        this._addonsListEl = document.createElement('div');
        this._addonsListEl.className = 'firmware-build-view__addons-list';
        section.appendChild(this._addonsListEl);

        this._addonsTable = new DataTableView({
            columns: [
                { key: 'select', label: '', align: 'center' },
                { key: 'name', label: this._t('firmwareBuild.addons.title') },
                { key: 'version', label: '', align: 'start' },
                { key: 'note', label: '', cellClassName: 'firmware-build-view__package-note' },
            ],
            header: true,
            dense: true,
            striped: true,
            title: 'Add-ons',
            logger: this._logger,
        });
        this._addonsTable.attachTo(this._addonsListEl);

        this._addonsListEl.addEventListener('change', (event) => {
            const target = event.target;
            if (!(target instanceof HTMLInputElement) || !target.dataset.packageId) {
                return;
            }
            if (target.checked) {
                this._selectedPackageIds.add(target.dataset.packageId);
            } else {
                this._selectedPackageIds.delete(target.dataset.packageId);
            }
            this._refreshAddonsCount();
            this._options.onSelectionChange();
        });

        return section;
    }

    /**
     * Compute the initial default selection for built-in packages: selectable,
     * capability-satisfied, and non-optional.
     */
    private _applyPackageDefaults(runtime: FirmwareRuntimeLike): void {
        const target = this._options.getTarget();
        const context = target ? createPackageCapabilityContext(target) : null;
        for (const pkg of runtime.nodePackages) {
            const id = pkg.id;
            if (!id || runtime.nodePackagesLocal.includes(id)) {
                continue;
            }
            if (runtime.packageProvenance(id) === 'addon') {
                continue;
            }
            if (runtime.isOptionalPackage(id)) {
                continue;
            }
            if (!this._packageCapable(pkg, context)) {
                continue;
            }
            this._selectedPackageIds.add(id);
        }
        this._packagesInitializedForRuntimeId = runtime.id;
    }

    /** Default-select every installed add-on that is capable and staged. */
    private _applyAddonsDefaults(runtime: FirmwareRuntimeLike): void {
        if (!this._options.hasFeature('node-package-addons')) {
            this._addonsInitializedForRuntimeId = runtime.id;
            return;
        }
        const target = this._options.getTarget();
        const context = target ? createPackageCapabilityContext(target) : null;
        for (const pkg of runtime.nodePackages) {
            const id = pkg.id;
            if (!id || runtime.packageProvenance(id) !== 'addon') {
                continue;
            }
            if (runtime.nodePackagesLocal.includes(id)) {
                continue;
            }
            if (!this._packageCapable(pkg, context)) {
                continue;
            }
            this._selectedPackageIds.add(id);
        }
        this._addonsInitializedForRuntimeId = runtime.id;
    }

    /** Return the ids of built-in packages the user may select. */
    private _selectablePackageIds(
        runtime: FirmwareRuntimeLike,
        context: PackageCapabilityContext | null
    ): string[] {
        const ids: string[] = [];
        for (const pkg of runtime.nodePackages) {
            const id = pkg.id;
            if (!id || runtime.nodePackagesLocal.includes(id)) {
                continue;
            }
            if (runtime.packageProvenance(id) === 'addon') {
                continue;
            }
            if (!this._packageCapable(pkg, context)) {
                continue;
            }
            ids.push(id);
        }
        return ids;
    }

    /** Return the ids of installed add-on packages the user may select. */
    private _selectableAddonIds(
        runtime: FirmwareRuntimeLike,
        context: PackageCapabilityContext | null
    ): string[] {
        if (!this._options.hasFeature('node-package-addons')) {
            return [];
        }
        const ids: string[] = [];
        for (const pkg of runtime.nodePackages) {
            const id = pkg.id;
            if (!id || runtime.nodePackagesLocal.includes(id)) {
                continue;
            }
            if (runtime.packageProvenance(id) !== 'addon') {
                continue;
            }
            if (!this._packageCapable(pkg, context)) {
                continue;
            }
            ids.push(id);
        }
        return ids;
    }

    /** Drop selected ids that are no longer selectable (built-in or add-on). */
    private _pruneSelection(
        runtime: FirmwareRuntimeLike,
        context: PackageCapabilityContext | null
    ): void {
        const selectable = new Set([
            ...this._selectablePackageIds(runtime, context),
            ...this._selectableAddonIds(runtime, context),
        ]);
        this._selectedPackageIds = new Set(
            [...this._selectedPackageIds].filter((id) => selectable.has(id))
        );
    }

    /** Count the selected built-in package ids. */
    private _selectedBuiltinCount(runtime: FirmwareRuntimeLike): number {
        return [...this._selectedPackageIds].filter(
            (id) => runtime.packageProvenance(id) !== 'addon'
        ).length;
    }

    /** Count the selected add-on package ids. */
    private _selectedAddonCount(runtime: FirmwareRuntimeLike): number {
        return [...this._selectedPackageIds].filter(
            (id) => runtime.packageProvenance(id) === 'addon'
        ).length;
    }

    /** Evaluate a package's capability requirements against the selected target. */
    private _packageCapable(
        pkg: FirmwareNodePackageLike,
        context: PackageCapabilityContext | null
    ): boolean {
        if (!context) {
            return true;
        }
        return evaluateRequiredCapabilities(pkg.requiredCapabilities, context).satisfied;
    }

    /** Return the missing-capability groups as a human label. */
    private _missingCapabilityLabel(
        pkg: FirmwareNodePackageLike,
        context: PackageCapabilityContext | null
    ): string {
        if (!context) {
            return '';
        }
        const result = evaluateRequiredCapabilities(pkg.requiredCapabilities, context);
        return result.missing.map((group) => group.join(' | ')).join(', ');
    }

    /** Build one package checklist row for the `DataTableView`. */
    private _packageRow(
        runtime: FirmwareRuntimeLike,
        pkg: FirmwareNodePackageLike,
        rowOptions: PackageRowOptions
    ): { cells: Array<Record<string, unknown>> } {
        const id = pkg.id ?? '';
        const note = this._packageNote(pkg, rowOptions);

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'firmware-build-view__package-checkbox';
        checkbox.dataset.packageId = id;
        checkbox.checked = this._selectedPackageIds.has(id);
        checkbox.disabled = !rowOptions.selectable;
        checkbox.setAttribute('aria-label', pkg.name ?? id);
        if (note) {
            checkbox.title = note;
        }

        const nameCell = document.createElement('span');
        nameCell.className = 'firmware-build-view__package-name';
        nameCell.appendChild(document.createTextNode(id));
        if (rowOptions.isAddon) {
            const badge = document.createElement('span');
            badge.className = 'firmware-build-view__package-badge';
            badge.textContent = this._t('firmwareBuild.packages.addon');
            nameCell.appendChild(badge);
        }
        if (runtime.isOptionalPackage(id)) {
            const optional = document.createElement('span');
            optional.className = 'firmware-build-view__package-badge';
            optional.textContent = this._t('firmwareBuild.packages.optional');
            nameCell.appendChild(optional);
        }

        this._appendVariantPicker(runtime, id, nameCell, rowOptions.context);

        return {
            cells: [
                { node: checkbox },
                { node: nameCell },
                { text: pkg.version ?? '' },
                { text: note },
            ],
        };
    }

    /** Append a variant badge (one implementation) or dropdown (several) to the name cell. */
    private _appendVariantPicker(
        runtime: FirmwareRuntimeLike,
        id: string,
        nameCell: HTMLElement,
        context: PackageCapabilityContext | null
    ): void {
        const variants = runtime.getPackageVariants?.(id) ?? [];
        if (variants.length === 0) {
            return;
        }

        const locale = this._locale();
        const chosen = this._variantChoices.get(id);
        const effective =
            variants.find((variant) => variant.variantId === chosen) ??
            variants.find((variant) =>
                context
                    ? evaluateRequiredCapabilities(variant.requiredCapabilities, context).satisfied
                    : true
            ) ??
            variants[0];

        const container = document.createElement('span');
        container.className = 'firmware-build-view__package-variant';

        if (variants.length === 1) {
            const [variant] = variants;
            const badge = document.createElement('span');
            badge.className =
                'firmware-build-view__package-badge firmware-build-view__package-badge--variant';
            badge.textContent = variantDisplayName(variant, locale);
            const description = variantDescription(variant, locale);
            if (description) {
                badge.title = description;
            }
            container.appendChild(badge);
            nameCell.appendChild(container);
            return;
        }

        const options = variants.map((variant) => ({
            value: variant.variantId,
            label: variantDisplayName(variant, locale),
            description: variantDescription(variant, locale) || undefined,
            disabled: context
                ? !evaluateRequiredCapabilities(variant.requiredCapabilities, context).satisfied
                : false,
        }));

        const selectedId = this._variantChoices.get(id) ?? effective.variantId;
        this._variantChoices.set(id, selectedId);

        const dropdown = new DropdownControl({
            options,
            value: selectedId,
            description: variantDescription(effective, locale) || undefined,
            onChange: (value) => {
                const variantId = typeof value === 'string' ? value : '';
                if (variantId) {
                    this._variantChoices.set(id, variantId);
                }
            },
            i18nService: this._i18nService,
            logger: this._logger,
        });
        dropdown.attachTo(container);
        nameCell.appendChild(container);
    }

    /**
     * Return the human note for a package (empty when it is selectable and
     * staged). Used for both the note cell and the checkbox tooltip.
     */
    private _packageNote(
        pkg: FirmwareNodePackageLike,
        rowOptions: PackageRowOptions
    ): string {
        if (rowOptions.isLocal) {
            return this._t('firmwareBuild.packages.localNotStaged');
        }
        if (!rowOptions.selectable) {
            return this._t('firmwareBuild.packages.missingCapabilities', {
                capabilities: this._missingCapabilityLabel(pkg, rowOptions.context),
            });
        }
        return '';
    }

    /** Refresh the built-in selected/total count from the current runtime. */
    private _refreshPackageCount(): void {
        const runtime = this._options.getRuntime();
        if (!runtime) {
            this._setPackageCount(0, 0);
            return;
        }
        const target = this._options.getTarget();
        const context = target ? createPackageCapabilityContext(target) : null;
        this._setPackageCount(
            this._selectedBuiltinCount(runtime),
            this._selectablePackageIds(runtime, context).length
        );
    }

    /** Update the built-in selected/total package count line. */
    private _setPackageCount(selected: number, total: number): void {
        if (!this._packageCountEl) {
            return;
        }
        this._packageCountEl.textContent = this._t('firmwareBuild.packages.count', {
            selected: String(selected),
            total: String(total),
        });
    }

    /** Refresh the add-on selected/total count from the current runtime. */
    private _refreshAddonsCount(): void {
        const runtime = this._options.getRuntime();
        if (!runtime) {
            this._setAddonsCount(0, 0);
            return;
        }
        const target = this._options.getTarget();
        const context = target ? createPackageCapabilityContext(target) : null;
        this._setAddonsCount(
            this._selectedAddonCount(runtime),
            this._selectableAddonIds(runtime, context).length
        );
    }

    /** Update the add-on selected/total count line. */
    private _setAddonsCount(selected: number, total: number): void {
        if (!this._addonsCountEl) {
            return;
        }
        this._addonsCountEl.textContent = this._t('firmwareBuild.addons.count', {
            selected: String(selected),
            total: String(total),
        });
    }

    /** Select or clear every selectable built-in package, then re-render. */
    private _setAllPackages(checked: boolean): void {
        const runtime = this._options.getRuntime();
        if (!runtime) {
            return;
        }
        const target = this._options.getTarget();
        const context = target ? createPackageCapabilityContext(target) : null;
        for (const pkg of runtime.nodePackages) {
            const id = pkg.id;
            if (!id || runtime.nodePackagesLocal.includes(id)) {
                continue;
            }
            if (runtime.packageProvenance(id) === 'addon') {
                continue;
            }
            if (!this._packageCapable(pkg, context)) {
                continue;
            }
            if (checked) {
                this._selectedPackageIds.add(id);
            } else {
                this._selectedPackageIds.delete(id);
            }
        }
        this.renderPackagesSection();
        this._options.onSelectionChange();
    }

    /** Select or clear every selectable add-on, then re-render. */
    private _setAllAddons(checked: boolean): void {
        const runtime = this._options.getRuntime();
        if (!runtime) {
            return;
        }
        const target = this._options.getTarget();
        const context = target ? createPackageCapabilityContext(target) : null;
        for (const pkg of runtime.nodePackages) {
            const id = pkg.id;
            if (!id || runtime.packageProvenance(id) !== 'addon') {
                continue;
            }
            if (runtime.nodePackagesLocal.includes(id)) {
                continue;
            }
            if (!this._packageCapable(pkg, context)) {
                continue;
            }
            if (checked) {
                this._selectedPackageIds.add(id);
            } else {
                this._selectedPackageIds.delete(id);
            }
        }
        this.renderAddonsSection();
        this._options.onSelectionChange();
    }

    /**
     * Replace the selection with exactly the packages the active collection uses.
     * Add-ons are included, so a collection that uses an add-on node keeps it.
     *
     * The id set comes from `_resolveCollectionPackages()`, the same resolver
     * behind `collectionPackageIds()`, so the button and the inventory's
     * compatibility tick always agree. An empty collection leaves the selection
     * untouched and only explains why.
     */
    private _applyMinimal(): void {
        if (!this._options.getRuntime()) {
            this._setHint(this._t('firmwareBuild.packages.selectNothingSelected'));
            return;
        }
        const { selectedIds, usedCount, unresolved } = this._resolveCollectionPackages();
        if (usedCount === 0) {
            this._setHint(this._t('firmwareBuild.packages.selectCollectionEmpty'));
            return;
        }

        this._selectedPackageIds = selectedIds;

        this.renderPackagesSection();
        this.renderAddonsSection();
        this._options.onSelectionChange();

        if (this._selectedPackageIds.size === 0) {
            this._setHint(this._t('firmwareBuild.packages.selectNothingSelected'));
        } else if (unresolved) {
            this._setHint(this._t('firmwareBuild.packages.minimalHint'));
        } else {
            this._clearHint();
        }
    }

    /**
     * Re-gate Install and Remove after every busy or selection transition.
     *
     * The `registerControl` gate only follows the capability snapshot, so the job
     * state and the selection are applied here, the same way
     * `FirmwareInventoryPanel._updateButtons()` combines them.
     */
    updateAddonsButtons(): void {
        this._installAddonButton?.setDisabled(
            this._options.isBusy() || !this._options.hasFeature('local-file-access')
        );
        this._installAddonUrlButton?.setDisabled(this._options.isBusy());
        this._removeAddonsButton?.setDisabled(
            this._options.isBusy() || this.selectedAddonIds().length === 0
        );
    }

    /** Show or clear the inline add-on refusal line. */
    private _setAddonsError(message: string | null): void {
        if (!this._addonsErrorEl) {
            return;
        }
        if (message) {
            this._addonsErrorEl.textContent = message;
            this._addonsErrorEl.hidden = false;
        } else {
            this._addonsErrorEl.textContent = '';
            this._addonsErrorEl.hidden = true;
        }
    }

    /** Show the package hint line with *text*. */
    private _setHint(text: string): void {
        if (!this._packageHintEl) {
            return;
        }
        this._packageHintEl.hidden = false;
        this._packageHintEl.textContent = text;
    }

    /** Hide the package hint line. */
    private _clearHint(): void {
        if (!this._packageHintEl) {
            return;
        }
        this._packageHintEl.hidden = true;
        this._packageHintEl.textContent = '';
    }
}
