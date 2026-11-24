import { JSDOM } from 'jsdom';

const DOM_GLOBAL_KEYS = [
    'window',
    'document',
    'Node',
    'HTMLElement',
    'HTMLInputElement',
    'HTMLDetailsElement',
    'HTMLDetailsElement',
    'Element',
    'CustomEvent',
    'Event',
    'MouseEvent',
    'KeyboardEvent',
    'navigator',
    'getComputedStyle',
    'requestAnimationFrame',
    'cancelAnimationFrame',
];

export function createDomHarness(html = '<!doctype html><html><body></body></html>') {
    const dom = new JSDOM(html, { url: 'http://localhost/' });
    const previousGlobals = [];

    function setGlobalValue(key, value) {
        const hadOwnProperty = Object.prototype.hasOwnProperty.call(globalThis, key);
        const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);

        previousGlobals.push({ key, hadOwnProperty, descriptor, value: globalThis[key] });

        if (descriptor?.writable === true || typeof descriptor?.set === 'function' || !descriptor) {
            try {
                globalThis[key] = value;
                return;
            } catch {
                // Non-writable global: fall through to defineProperty below.
            }
        }

        if (descriptor?.configurable === false) {
            return;
        }

        try {
            Object.defineProperty(globalThis, key, {
                configurable: true,
                enumerable: descriptor?.enumerable ?? true,
                writable: true,
                value,
            });
        } catch {
            // Locked-down global in this jsdom build: nothing sensible left to try.
        }
    }

    for (const key of DOM_GLOBAL_KEYS) {
        if (key in dom.window) {
            setGlobalValue(key, dom.window[key]);
        }
    }

    if (typeof globalThis.ResizeObserver === 'undefined' && 'ResizeObserver' in dom.window) {
        setGlobalValue('ResizeObserver', dom.window.ResizeObserver);
    }

    return {
        window: dom.window,
        document: dom.window.document,
        cleanup() {
            for (let index = previousGlobals.length - 1; index >= 0; index -= 1) {
                const entry = previousGlobals[index];
                try {
                    if (entry.hadOwnProperty) {
                        if (entry.descriptor) {
                            Object.defineProperty(globalThis, entry.key, entry.descriptor);
                        } else {
                            globalThis[entry.key] = entry.value;
                        }
                    } else {
                        delete globalThis[entry.key];
                    }
                } catch {
                    // Best-effort teardown: a global that refuses restoration must not
                    // fail the test run.
                }
            }
            dom.window.close();
        },
    };
}
