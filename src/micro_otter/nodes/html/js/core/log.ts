// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

type LogLevel = 'debug' | 'info' | 'warn' | 'error';
type LazyLogValue = () => unknown;
type LogData = unknown | LazyLogValue;
type BoundLogger = (reason: string, level?: LogLevel, ...data: LogData[]) => void;

declare const __MIN_LOG_LEVEL__: LogLevel | undefined;

/**
 * Singleton logger with simple string-based registration system.
 *
 * Usage:
 * ```javascript
 * import { logger } from './log.js';
 *
 * // Enable logging globally
 * logger.setEnabled(true);
 *
 * // Register class names you want to log
 * logger.register('SplitView');
 * logger.register('TabbedView', ['attach', 'detach']); // Only specific reasons
 * logger.register('GraphPanelView', null, 'warn'); // Minimum warn level
 *
 * // In your class
 * import { createLogger } from './log.js';
 * const log = createLogger('SplitView');
 * log('attach', 'info', { container });
 * ```
 */
class Logger {
    enabled: boolean;
    globalMinLevel: LogLevel;
    classes: Set<string>;
    classReasons: Map<string, Set<string>>;
    classLevels: Map<string, LogLevel>;
    defaultMinLevel: LogLevel;
    levelPriority: Record<LogLevel, number>;

    constructor() {
        this.enabled = false;

        this.globalMinLevel =
            typeof __MIN_LOG_LEVEL__ !== 'undefined' ? __MIN_LOG_LEVEL__ : 'debug';

        this.classes = new Set();

        this.classReasons = new Map();

        this.classLevels = new Map();

        this.defaultMinLevel = 'debug';

        this.levelPriority = {
            debug: 0,
            info: 1,
            warn: 2,
            error: 3,
        };
    }

    /**
     * Enable/disable logging globally.
     * @param {boolean} enabled - True to enable logging
     */
    setEnabled(enabled: boolean): void {
        this.enabled = enabled;
    }

    /**
     * Register a class name for logging.
     * @param {string} className - Class name to enable
     * @param {string[]} [reasons] - Optional specific reasons to enable
     * @param {string} [minLevel] - Optional minimum log level for this class
     */
    register(
        className: string,
        reasons: string[] | null = null,
        minLevel: LogLevel | null = null
    ): void {
        this.classes.add(className);

        if (reasons && reasons.length > 0) {
            this.classReasons.set(className, new Set(reasons));
        }

        if (minLevel) {
            this.classLevels.set(className, minLevel);
        }
    }

    /**
     * Unregister a class name.
     * @param {string} className - Class name to disable
     */
    unregister(className: string): void {
        this.classes.delete(className);
        this.classReasons.delete(className);
        this.classLevels.delete(className);
    }

    /**
     * Clear all registrations.
     */
    clear(): void {
        this.classes.clear();
        this.classReasons.clear();
        this.classLevels.clear();
    }

    /**
     * Check if logging is enabled for a specific class/reason/level combination.
     * @param {string} className - Class name
     * @param {string} reason - Reason/event identifier
     * @param {string} level - Log level
     * @returns {boolean}
     */
    isEnabled(className: string, reason: string, level: LogLevel = 'debug'): boolean {
        if (!this.enabled) {
            return false;
        }

        const globalMinPriority = this.levelPriority[this.globalMinLevel] || 0;
        const currentPriority = this.levelPriority[level] || 0;
        if (currentPriority < globalMinPriority) {
            return false;
        }

        if (this.classes.size === 0) {
            return false;
        }

        if (!this.classes.has(className)) {
            return false;
        }

        const minLevel = this.classLevels.get(className) || this.defaultMinLevel;
        const minPriority = this.levelPriority[minLevel] || 0;

        if (currentPriority < minPriority) {
            return false;
        }

        const reasons = this.classReasons.get(className);
        if (reasons) {
            return reasons.has(reason);
        }

        return true;
    }

    /**
     * Log a message.
     * Supports lazy evaluation: pass functions that return data to defer computation
     * until logging is enabled.
     *
     * @param {string} className - Class name
     * @param {string} reason - Reason/event identifier
     * @param {string} level - Log level
     * @param {...any} data - Data to log (functions are evaluated lazily)
     * @example
     * // Simple values - passed directly
     * logger.log('MyClass', 'event', 'info', 'message');
     *
     * // Lazy evaluation - function only called when logging enabled
     * logger.log('MyClass', 'event', 'debug', () => ({
     *   expensive: computeExpensiveData()
     * }));
     */
    log(className: string, reason: string, level: LogLevel = 'debug', ...data: LogData[]): void {
        if (!this.isEnabled(className, reason, level)) {
            return;
        }

        const evaluatedData = data.map((item) =>
            typeof item === 'function' ? (item as LazyLogValue)() : item
        );

        const prefix = `[${className}]`;

        const logMethod = {
            debug: console.debug || console.log,
            info: console.info || console.log,
            warn: console.warn,
            error: console.error,
        }[level] as (...args: unknown[]) => void;

        logMethod(prefix, reason, ...evaluatedData);
    }
}

// Create singleton instance
const logger = new Logger();

// Export singleton and convenience functions
export { logger };

/**
 * Log a message (convenience function).
 * @param {string} className - Class name
 * @param {string} reason - Reason/event identifier
 * @param {string} [level='debug'] - Log level: 'debug' | 'info' | 'warn' | 'error'
 * @param {...any} data - Data to log
 */
export function log(
    className: string,
    reason: string,
    level: LogLevel = 'debug',
    ...data: LogData[]
): void {
    logger.log(className, reason, level, ...data);
}

/**
 * Check if logging is enabled (convenience function).
 * @param {string} className - Class name
 * @param {string} reason - Reason/event identifier
 * @param {string} [level='debug'] - Log level
 * @returns {boolean}
 */
export function logEnabled(className: string, reason: string, level: LogLevel = 'debug'): boolean {
    return logger.isEnabled(className, reason, level);
}

/**
 * Create a logging wrapper for a specific class.
 * @param {string} className - Class name
 * @param {string|function} [instanceId] - Optional instance ID or function that returns it
 * @returns {function} Logging function with bound class name
 */
export function createLogger(
    className: string,
    instanceId: string | (() => string) | null = null
): BoundLogger {
    return function (reason: string, level: LogLevel = 'debug', ...data: LogData[]): void {
        const fullClassName = instanceId
            ? `${className}:${typeof instanceId === 'function' ? instanceId() : instanceId}`
            : className;
        logger.log(fullClassName, reason, level, ...data);
    };
}

// Expose to globalThis for runtime debugging
if (typeof globalThis !== 'undefined') {
    const globalLogTarget = globalThis as typeof globalThis & {
        __microOtterLog?: {
            logger: Logger;
            log: typeof log;
            logEnabled: typeof logEnabled;
            createLogger: typeof createLogger;
        };
    };

    globalLogTarget.__microOtterLog = {
        logger: logger,
        log: log,
        logEnabled: logEnabled,
        createLogger: createLogger,
    };
}
