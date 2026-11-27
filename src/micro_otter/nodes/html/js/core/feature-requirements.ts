/**
 * Feature checker functions.
 * Each returns {available: boolean, reason?: string} or just boolean.
 */

type FeatureCheckResult = {
    available: boolean;
    reason?: string;
};

type FeatureChecker = () => FeatureCheckResult | boolean;

// ============================================================================
// REQUIRED FEATURES
// ============================================================================

const checkESModules: FeatureChecker = () => {
    // If this code is running, modules work (this file is a module)
    return { available: true };
};

const checkResizeObserver: FeatureChecker = () => {
    const available = typeof ResizeObserver === 'function';
    return {
        available,
        reason: !available ? 'ResizeObserver not supported' : undefined,
    };
};

const checkIndexedDB: FeatureChecker = () => {
    const available = 'indexedDB' in window && window.indexedDB !== null;
    return {
        available,
        reason: !available ? 'IndexedDB not supported or disabled' : undefined,
    };
};

const checkPromises: FeatureChecker = () => {
    const available = typeof Promise === 'function';
    return {
        available,
        reason: !available ? 'Promises not supported' : undefined,
    };
};

const checkFetch: FeatureChecker = () => {
    const available = typeof fetch === 'function';
    return {
        available,
        reason: !available ? 'Fetch API not supported' : undefined,
    };
};

const checkLocalStorage: FeatureChecker = () => {
    try {
        const test = '__storage_test__';
        localStorage.setItem(test, test);
        localStorage.removeItem(test);
        return { available: true };
    } catch {
        return {
            available: false,
            reason: 'LocalStorage not available or blocked',
        };
    }
};

const checkCustomElements: FeatureChecker = () => {
    return {
        available: 'customElements' in window,
        reason: !window.customElements ? 'Custom Elements not supported' : undefined,
    };
};

// These three probes date from the 2015 browser baseline, when a feature could be missing and a
// dynamically evaluated string was the only way to test it without breaking the module. Dynamic
// evaluation is forbidden by the hosted bundle's Content-Security-Policy (see
// `tools/vite-hosted-csp.mjs`), and a direct syntax check is the stronger test anyway: this module
// only parses and runs if the syntax it probes for is supported.
const checkAsyncAwait: FeatureChecker = () => {
    const probe = async () => {};
    const available = typeof probe === 'function';
    return {
        available,
        reason: !available ? 'Async/await not supported' : undefined,
    };
};

const checkES6Classes: FeatureChecker = () => {
    class ProbeClass {}
    const available = typeof ProbeClass === 'function';
    return {
        available,
        reason: !available ? 'ES6 classes not supported' : undefined,
    };
};

const checkArrowFunctions: FeatureChecker = () => {
    const probe = () => {};
    const available = typeof probe === 'function';
    return {
        available,
        reason: !available ? 'Arrow functions not supported' : undefined,
    };
};

// ============================================================================
// OPTIONAL FEATURES
// ============================================================================

const checkWebSerial: FeatureChecker = () => {
    const navigatorWithSerial = navigator as Navigator & { serial?: unknown };
    return {
        available: 'serial' in navigator,
        reason: !navigatorWithSerial.serial
            ? 'Web Serial API not supported (Chrome/Edge only)'
            : undefined,
    };
};

const checkClipboard: FeatureChecker = () => {
    return {
        available: 'clipboard' in navigator && typeof navigator.clipboard?.writeText === 'function',
        reason: !navigator.clipboard ? 'Clipboard API not supported' : undefined,
    };
};

/**
 * File System Access feature checker.
 *
 * Exported although no feature map registers it yet: the check is parked here so enabling it
 * later is a one-line change instead of a re-implementation.
 */
export const checkFileSystemAccess: FeatureChecker = () => {
    const windowWithFilePicker = window as Window & { showOpenFilePicker?: unknown };
    return {
        available: 'showOpenFilePicker' in window,
        reason: !windowWithFilePicker.showOpenFilePicker
            ? 'File System Access API not supported'
            : undefined,
    };
};

const checkWebWorkers: FeatureChecker = () => {
    const available = typeof Worker === 'function';
    return {
        available,
        reason: !available ? 'Web Workers not supported' : undefined,
    };
};

const checkNotifications: FeatureChecker = () => {
    const windowWithNotification = window as Window & { Notification?: unknown };
    return {
        available: 'Notification' in window,
        reason: !windowWithNotification.Notification ? 'Notifications API not supported' : undefined,
    };
};

// ============================================================================
// FEATURE MAPS
// ============================================================================

/**
 * Map of required features that must be available for the app to run.
 */
export const REQUIRED_FEATURES = new Map<string, FeatureChecker>([
    ['ES6 Modules', checkESModules],
    ['ResizeObserver', checkResizeObserver],
    ['IndexedDB', checkIndexedDB],
    ['Promises', checkPromises],
    ['Fetch API', checkFetch],
    ['LocalStorage', checkLocalStorage],
    ['Custom Elements', checkCustomElements],
    ['Async/Await', checkAsyncAwait],
    ['ES6 Classes', checkES6Classes],
    ['Arrow Functions', checkArrowFunctions],
]);

/**
 * Map of optional features that enhance the app but aren't required.
 */
export const OPTIONAL_FEATURES = new Map<string, FeatureChecker>([
    ['Web Serial API', checkWebSerial],
    ['Clipboard API', checkClipboard],
    // ['File System Access API', checkFileSystemAccess],
    ['Web Workers', checkWebWorkers],
    ['Notifications API', checkNotifications],
]);

/**
 * Get a user-friendly description of what a feature is used for.
 */
export function getFeatureDescription(featureName: string): string {
    const descriptions: Record<string, string> = {
        'ES6 Modules': 'Required for loading JavaScript modules',
        ResizeObserver: 'Required for responsive layout and view sizing',
        IndexedDB: 'Required for storing node graphs and workspace data',
        Promises: 'Required for asynchronous operations',
        'Fetch API': 'Required for loading configuration and device runtimes',
        LocalStorage: 'Required for storing user preferences',
        'Custom Elements': 'Required for custom UI components',
        'Async/Await': 'Required for modern asynchronous code',
        'ES6 Classes': 'Required for application architecture',
        'Arrow Functions': 'Required for modern JavaScript syntax',
        'Web Serial API':
            'Enables direct USB communication with ESP32 devices. For Firefox there exists a separate add-on to provide similar functionality.',
        'Clipboard API': 'Enables enhanced copy/paste functionality',
        'File System Access API': 'Enables direct file read/write operations',
        'Web Workers': 'Enables background processing for better performance',
        'Notifications API': 'Enables desktop notifications for device events',
    };
    return descriptions[featureName] || 'No description available';
}

/**
 * Get browser compatibility info for a feature.
 */
export function getFeatureCompatibility(featureName: string): string {
    const compatibility: Record<string, string> = {
        'ES6 Modules': 'Chrome 61+, Firefox 60+, Safari 11+, Edge 16+',
        ResizeObserver: 'Chrome 64+, Firefox 69+, Safari 13.1+, Edge 79+',
        IndexedDB: 'All modern browsers',
        Promises: 'All modern browsers',
        'Fetch API': 'All modern browsers',
        LocalStorage: 'All modern browsers',
        'Custom Elements': 'Chrome 54+, Firefox 63+, Safari 10.1+, Edge 79+',
        'Async/Await': 'Chrome 55+, Firefox 52+, Safari 10.1+, Edge 15+',
        'ES6 Classes': 'All modern browsers',
        'Arrow Functions': 'All modern browsers',
        'Web Serial API': 'Chrome 89+, Edge 89+ (not Firefox/Safari)',
        'Clipboard API': 'Chrome 63+, Firefox 53+, Safari 13.1+, Edge 79+',
        'File System Access API': 'Chrome 86+, Edge 86+ (not Firefox/Safari)',
        'Web Workers': 'All modern browsers',
        'Notifications API': 'All modern browsers',
    };
    return compatibility[featureName] || 'Unknown';
}
