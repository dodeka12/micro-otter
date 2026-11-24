// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { createPackageCapabilityContext } from '../core/capability-requirements.js';
import type { PackageVariantInfo } from '../data/package-resolver.js';

/**
 * Shared structural types for the firmware build view and its packages panel.
 *
 * These stay structural (never class-based) so the view and the panel can accept
 * any object that satisfies the shape, which is what keeps the suites injectable.
 */

/** A control the registry can enable/disable via `setDisabled()`. */
export interface DisableableControl {
    setDisabled(disabled: boolean): void;
}

/** An i18n service shaped like the view base's, for shared view controls. */
export interface FirmwareI18nService {
    t: (key: string, params?: Record<string, unknown>) => string;
    addEventListener: (type: 'languagechange', handler: (event: Event) => void) => void;
    removeEventListener: (type: 'languagechange', handler: (event: Event) => void) => void;
    /** Active locale code, used to pick a localized manifest text; absent means `en`. */
    readonly currentLocale?: string;
}

/** A logger function shaped like the view base's default logger. */
export type FirmwareLogger = (message: string, level?: unknown, ...data: unknown[]) => void;

/**
 * Structural subset of `ViewManager` that the firmware tab calls.
 *
 * The signature mirrors the real `ViewManager.showConfirmation` so the view
 * stays decoupled from the concrete manager and is testable with a fake. Only
 * the members the tab actually calls are included; a running build or deploy is
 * shown in the section's own `ProgressBarView`, not in a whole-app overlay.
 */
export interface FirmwareViewManagerLike {
    showConfirmation(options: Record<string, unknown>): Promise<boolean>;
    showModal(dialog: unknown, options?: Record<string, unknown>): void;
    showFormDialog(options: Record<string, unknown>): Promise<{
        confirmed: boolean;
        formData: unknown;
    }>;
}

/** Structural subset of a node package, for the checklist. */
export interface FirmwareNodePackageLike {
    id: string | null;
    name: string | null;
    version: string | null;
    requiredCapabilities: unknown;
}

/** Structural subset of a device target, for capability gating. */
export interface FirmwareTargetLike {
    id: string | null;
    displayName: string | null;
    generalCapabilities: Record<string, unknown>;
    resources: Record<string, unknown>;
    capabilityRegistry: {
        getDomain(id: string): 'pin' | 'general';
        get(id: string): { limitKey?: string | null } | null;
    };
}

/** Structural subset of a device runtime, for target and package rendering. */
export interface FirmwareRuntimeLike {
    id: string | null;
    version: string | null;
    nodePackages: FirmwareNodePackageLike[];
    nodePackagesGlobal: string[];
    nodePackagesLocal: string[];
    nodePackagesAddons: string[];
    nodePackagesOptional: string[];
    defaultDeviceTargetId: string | null;
    isOptionalPackage(packageId: string): boolean;
    packageProvenance(packageId: string): 'builtin' | 'addon';
    getCompileTarget(targetId: string): { board: string; port: string } | null;
    getAvailableTargets(): FirmwareTargetLike[];
    getTargetBuildBaseId?(targetId: string): string | null;
    listOnboardingTargets?(): FirmwareTargetLike[];
    getPackageVariants?(packageId: string): PackageVariantInfo[];
}

/** Capability-evaluation context built from the selected target. */
export type PackageCapabilityContext = ReturnType<typeof createPackageCapabilityContext>;
