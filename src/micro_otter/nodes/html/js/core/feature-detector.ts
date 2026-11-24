/**
 * Browser feature detection and validation system.
 * Checks for required and optional browser APIs before app initialization.
 */

import { OPTIONAL_FEATURES, REQUIRED_FEATURES } from './feature-requirements';
import { ProgressTracker } from './progress-events.js';

type FeatureResult = {
    available: boolean;
    reason?: string;
};

type FeatureCategory = 'required' | 'optional';

type FeatureDetails = FeatureResult & {
    category: FeatureCategory;
};

type FeatureCheckAllResult = {
    allRequiredAvailable: boolean;
    missingRequired: string[];
    missingOptional: string[];
    details: Map<string, FeatureResult>;
};

type FeatureCheckAllOptions = {
    emitProgress?: boolean;
};

type FeatureChecker = () => FeatureResult | boolean;

export class FeatureDetector {
    private readonly results: {
        required: Map<string, FeatureResult>;
        optional: Map<string, FeatureResult>;
    };

    private readonly customOverrides: Map<string, boolean>;

    constructor() {
        this.results = {
            required: new Map(),
            optional: new Map(),
        };
        this.customOverrides = new Map();
    }

    /**
     * Check all features and return results.
     */
    checkAll(options: FeatureCheckAllOptions = {}): FeatureCheckAllResult {
        const { emitProgress = true } = options;
        const progress = emitProgress ? new ProgressTracker('feature-detection') : null;

        if (progress) {
            progress.start('Checking browser capabilities...');
        }

        const missingRequired: string[] = [];
        const missingOptional: string[] = [];

        if (progress) {
            progress.update('Checking required features...', 33);
        }
        for (const [name, checker] of REQUIRED_FEATURES) {
            const result = this._checkFeature(name, checker as FeatureChecker);
            this.results.required.set(name, result);
            if (!result.available) {
                missingRequired.push(name);
            }
        }

        if (progress) {
            progress.update('Checking optional features...', 67);
        }
        for (const [name, checker] of OPTIONAL_FEATURES) {
            const result = this._checkFeature(name, checker as FeatureChecker);
            this.results.optional.set(name, result);
            if (!result.available) {
                missingOptional.push(name);
            }
        }

        if (progress) {
            const totalChecked = REQUIRED_FEATURES.size + OPTIONAL_FEATURES.size;
            const totalAvailable = totalChecked - missingRequired.length - missingOptional.length;
            progress.complete(
                `Feature checks complete (${totalAvailable}/${totalChecked} available)`
            );
        }

        return {
            allRequiredAvailable: missingRequired.length === 0,
            missingRequired,
            missingOptional,
            details: new Map([...this.results.required, ...this.results.optional]),
        };
    }

    /**
     * Check if a specific feature is available.
     */
    isAvailable(featureName: string): boolean {
        if (this.customOverrides.has(featureName)) {
            return this.customOverrides.get(featureName) as boolean;
        }

        const result =
            this.results.required.get(featureName) || this.results.optional.get(featureName);
        return result?.available ?? false;
    }

    /**
     * Override a feature's availability (for testing).
     */
    override(featureName: string, available: boolean): void {
        this.customOverrides.set(featureName, available);
    }

    /**
     * Clear all overrides (restore real detection).
     */
    clearOverrides(): void {
        this.customOverrides.clear();
    }

    /**
     * Get detailed information about a feature check.
     */
    getDetails(featureName: string): FeatureDetails | null {
        if (this.results.required.has(featureName)) {
            return {
                ...(this.results.required.get(featureName) as FeatureResult),
                category: 'required',
            };
        }
        if (this.results.optional.has(featureName)) {
            return {
                ...(this.results.optional.get(featureName) as FeatureResult),
                category: 'optional',
            };
        }
        return null;
    }

    /**
     * Internal method to execute a feature check.
     */
    private _checkFeature(name: string, checker: FeatureChecker): FeatureResult {
        if (this.customOverrides.has(name)) {
            const available = this.customOverrides.get(name) as boolean;
            return {
                available,
                reason: available ? undefined : 'Overridden for testing',
            };
        }

        try {
            const result = checker();
            if (typeof result === 'boolean') {
                return { available: result };
            }
            return result;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return {
                available: false,
                reason: `Check failed: ${message}`,
            };
        }
    }

    /**
     * Get a user-friendly report of all feature checks.
     */
    getReport(): string {
        const lines: string[] = [];
        lines.push('Browser Feature Detection Report');
        lines.push('='.repeat(50));
        lines.push('');

        lines.push('Required Features:');
        for (const [name, result] of this.results.required) {
            const status = result.available ? '✓' : '✗';
            const reason = result.reason ? ` (${result.reason})` : '';
            lines.push(`  ${status} ${name}${reason}`);
        }

        lines.push('');
        lines.push('Optional Features:');
        for (const [name, result] of this.results.optional) {
            const status = result.available ? '✓' : '✗';
            const reason = result.reason ? ` (${result.reason})` : '';
            lines.push(`  ${status} ${name}${reason}`);
        }

        return lines.join('\n');
    }
}
