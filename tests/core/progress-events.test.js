/**
 * Unit tests for progress event system (Steps 1.1, 1.2, and 1.3).
 *
 * Tests event creation, validation, and immutability for the ProgressEvent class.
 * Tests subscription, emission, and error handling for the ProgressEventBus.
 * Tests progress tracking and automatic calculation for the ProgressTracker.
 * @copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    ProgressEventType,
    ProgressEvent,
    ProgressEventBus,
    ProgressTracker,
} from '../../src/micro_otter/nodes/html/js/core/progress-events.js';

describe('ProgressEventType', () => {
    it('should define all required event types', () => {
        assert.equal(ProgressEventType.START, 'start');
        assert.equal(ProgressEventType.UPDATE, 'update');
        assert.equal(ProgressEventType.COMPLETE, 'complete');
        assert.equal(ProgressEventType.ERROR, 'error');
    });

    it('should be frozen (immutable)', () => {
        assert.throws(() => {
            ProgressEventType.INVALID = 'invalid';
        }, TypeError);
    });
});

describe('ProgressEvent - Valid Creation', () => {
    it('should create event with required fields only', () => {
        const event = new ProgressEvent({
            source: 'workspace',
            type: ProgressEventType.START,
            message: 'Starting initialization',
        });

        assert.equal(event.source, 'workspace');
        assert.equal(event.type, 'start');
        assert.equal(event.message, 'Starting initialization');
        assert.equal(event.progress, undefined);
        assert.equal(event.detail, undefined);
        assert.ok(typeof event.timestamp === 'number');
        assert.ok(event.timestamp > 0);
    });

    it('should create event with progress', () => {
        const event = new ProgressEvent({
            source: 'node-packages',
            type: ProgressEventType.UPDATE,
            message: 'Loading packages',
            progress: 50,
        });

        assert.equal(event.progress, 50);
    });

    it('should create event with detail metadata', () => {
        const detail = { packageId: 'core', version: '1.0.0' };
        const event = new ProgressEvent({
            source: 'node-packages',
            type: ProgressEventType.UPDATE,
            message: 'Loaded core package',
            detail,
        });

        assert.deepEqual(event.detail, detail);
    });

    it('should create event with custom timestamp', () => {
        const customTime = Date.now() - 5000;
        const event = new ProgressEvent({
            source: 'test',
            type: ProgressEventType.START,
            message: 'Test',
            timestamp: customTime,
        });

        assert.equal(event.timestamp, customTime);
    });

    it('should accept progress of 0', () => {
        const event = new ProgressEvent({
            source: 'test',
            type: ProgressEventType.START,
            message: 'Starting',
            progress: 0,
        });

        assert.equal(event.progress, 0);
    });

    it('should accept progress of 100', () => {
        const event = new ProgressEvent({
            source: 'test',
            type: ProgressEventType.COMPLETE,
            message: 'Complete',
            progress: 100,
        });

        assert.equal(event.progress, 100);
    });

    it('should trim whitespace from source and message', () => {
        const event = new ProgressEvent({
            source: '  workspace  ',
            type: ProgressEventType.START,
            message: '  Starting...  ',
        });

        assert.equal(event.source, 'workspace');
        assert.equal(event.message, 'Starting...');
    });
});

describe('ProgressEvent - Validation Errors', () => {
    it('should throw TypeError for missing source', () => {
        assert.throws(
            () => {
                new ProgressEvent({
                    type: ProgressEventType.START,
                    message: 'Test',
                });
            },
            {
                name: 'TypeError',
                message: /source must be a non-empty string/,
            }
        );
    });

    it('should throw TypeError for empty source', () => {
        assert.throws(
            () => {
                new ProgressEvent({
                    source: '   ',
                    type: ProgressEventType.START,
                    message: 'Test',
                });
            },
            {
                name: 'TypeError',
                message: /source must be a non-empty string/,
            }
        );
    });

    it('should throw TypeError for non-string source', () => {
        assert.throws(() => {
            new ProgressEvent({
                source: 123,
                type: ProgressEventType.START,
                message: 'Test',
            });
        }, TypeError);
    });

    it('should throw TypeError for invalid event type', () => {
        assert.throws(
            () => {
                new ProgressEvent({
                    source: 'test',
                    type: 'invalid-type',
                    message: 'Test',
                });
            },
            {
                name: 'TypeError',
                message: /type must be one of/,
            }
        );
    });

    it('should throw TypeError for missing message', () => {
        assert.throws(
            () => {
                new ProgressEvent({
                    source: 'test',
                    type: ProgressEventType.START,
                });
            },
            {
                name: 'TypeError',
                message: /message must be a non-empty string/,
            }
        );
    });

    it('should throw TypeError for empty message', () => {
        assert.throws(() => {
            new ProgressEvent({
                source: 'test',
                type: ProgressEventType.START,
                message: '   ',
            });
        }, TypeError);
    });

    it('should throw TypeError for non-number progress', () => {
        assert.throws(
            () => {
                new ProgressEvent({
                    source: 'test',
                    type: ProgressEventType.UPDATE,
                    message: 'Test',
                    progress: '50',
                });
            },
            {
                name: 'TypeError',
                message: /progress must be a number/,
            }
        );
    });

    it('should throw TypeError for NaN progress', () => {
        assert.throws(() => {
            new ProgressEvent({
                source: 'test',
                type: ProgressEventType.UPDATE,
                message: 'Test',
                progress: NaN,
            });
        }, TypeError);
    });

    it('should throw RangeError for negative progress', () => {
        assert.throws(
            () => {
                new ProgressEvent({
                    source: 'test',
                    type: ProgressEventType.UPDATE,
                    message: 'Test',
                    progress: -1,
                });
            },
            {
                name: 'RangeError',
                message: /progress must be between 0 and 100/,
            }
        );
    });

    it('should throw RangeError for progress > 100', () => {
        assert.throws(() => {
            new ProgressEvent({
                source: 'test',
                type: ProgressEventType.UPDATE,
                message: 'Test',
                progress: 101,
            });
        }, RangeError);
    });

    it('should throw TypeError for invalid timestamp', () => {
        assert.throws(() => {
            new ProgressEvent({
                source: 'test',
                type: ProgressEventType.START,
                message: 'Test',
                timestamp: 'not-a-number',
            });
        }, TypeError);
    });

    it('should throw TypeError for negative timestamp', () => {
        assert.throws(() => {
            new ProgressEvent({
                source: 'test',
                type: ProgressEventType.START,
                message: 'Test',
                timestamp: -1,
            });
        }, TypeError);
    });
});

describe('ProgressEvent - Immutability', () => {
    it('should be frozen after creation', () => {
        const event = new ProgressEvent({
            source: 'test',
            type: ProgressEventType.START,
            message: 'Test',
        });

        assert.ok(Object.isFrozen(event));
    });

    it('should not allow property modification', () => {
        const event = new ProgressEvent({
            source: 'test',
            type: ProgressEventType.START,
            message: 'Test',
        });

        // Attempting to modify should fail silently or throw in strict mode
        assert.throws(() => {
            'use strict';
            event.source = 'modified';
        }, TypeError);
    });

    it('should not allow adding new properties', () => {
        const event = new ProgressEvent({
            source: 'test',
            type: ProgressEventType.START,
            message: 'Test',
        });

        assert.throws(() => {
            'use strict';
            event.newProp = 'value';
        }, TypeError);
    });
});

describe('ProgressEvent - Serialization', () => {
    it('should convert to JSON correctly', () => {
        const event = new ProgressEvent({
            source: 'workspace',
            type: ProgressEventType.UPDATE,
            message: 'Loading',
            progress: 50,
            detail: { foo: 'bar' },
        });

        const json = event.toJSON();

        assert.equal(json.source, 'workspace');
        assert.equal(json.type, 'update');
        assert.equal(json.message, 'Loading');
        assert.equal(json.progress, 50);
        assert.deepEqual(json.detail, { foo: 'bar' });
        assert.equal(json.timestamp, event.timestamp);
    });

    it('should convert to string correctly', () => {
        const event = new ProgressEvent({
            source: 'node-packages',
            type: ProgressEventType.UPDATE,
            message: 'Loading package',
            progress: 75,
        });

        const str = event.toString();

        assert.ok(str.includes('UPDATE'));
        assert.ok(str.includes('node-packages'));
        assert.ok(str.includes('[75%]'));
        assert.ok(str.includes('Loading package'));
    });

    it('should format string without progress correctly', () => {
        const event = new ProgressEvent({
            source: 'workspace',
            type: ProgressEventType.START,
            message: 'Starting',
        });

        const str = event.toString();

        assert.ok(str.includes('START'));
        assert.ok(str.includes('workspace'));
        assert.ok(str.includes('Starting'));
        assert.ok(!str.includes('%'));
    });
});

describe('ProgressEvent - All Event Types', () => {
    it('should support START event', () => {
        const event = new ProgressEvent({
            source: 'test',
            type: ProgressEventType.START,
            message: 'Starting test',
        });

        assert.equal(event.type, 'start');
    });

    it('should support UPDATE event', () => {
        const event = new ProgressEvent({
            source: 'test',
            type: ProgressEventType.UPDATE,
            message: 'Updating test',
            progress: 50,
        });

        assert.equal(event.type, 'update');
    });

    it('should support COMPLETE event', () => {
        const event = new ProgressEvent({
            source: 'test',
            type: ProgressEventType.COMPLETE,
            message: 'Test complete',
            progress: 100,
        });

        assert.equal(event.type, 'complete');
    });

    it('should support ERROR event', () => {
        const error = new Error('Test error');
        const event = new ProgressEvent({
            source: 'test',
            type: ProgressEventType.ERROR,
            message: 'Test failed',
            detail: { error },
        });

        assert.equal(event.type, 'error');
        assert.equal(event.detail.error, error);
    });
});

// ============================================================================
// Step 1.2: ProgressEventBus Tests
// ============================================================================

describe('ProgressEventBus - Subscription', () => {
    // Clean up after each test to avoid cross-test contamination
    afterEach(() => {
        ProgressEventBus.clearAllListeners();
    });

    it('should start with no listeners', () => {
        assert.equal(ProgressEventBus.getListenerCount(), 0);
    });

    it('should add a listener via subscribe', () => {
        const listener = () => {};
        ProgressEventBus.subscribe(listener);

        assert.equal(ProgressEventBus.getListenerCount(), 1);
    });

    it('should add multiple different listeners', () => {
        const listener1 = () => {};
        const listener2 = () => {};
        const listener3 = () => {};

        ProgressEventBus.subscribe(listener1);
        ProgressEventBus.subscribe(listener2);
        ProgressEventBus.subscribe(listener3);

        assert.equal(ProgressEventBus.getListenerCount(), 3);
    });

    it('should not add duplicate listeners (idempotent)', () => {
        const listener = () => {};

        ProgressEventBus.subscribe(listener);
        ProgressEventBus.subscribe(listener);
        ProgressEventBus.subscribe(listener);

        assert.equal(ProgressEventBus.getListenerCount(), 1);
    });

    it('should throw TypeError for non-function listener', () => {
        assert.throws(
            () => {
                ProgressEventBus.subscribe('not-a-function');
            },
            {
                name: 'TypeError',
                message: /listener must be a function/,
            }
        );
    });

    it('should throw TypeError for null listener', () => {
        assert.throws(() => {
            ProgressEventBus.subscribe(null);
        }, TypeError);
    });

    it('should throw TypeError for undefined listener', () => {
        assert.throws(() => {
            ProgressEventBus.subscribe(undefined);
        }, TypeError);
    });
});

describe('ProgressEventBus - Unsubscription', () => {
    afterEach(() => {
        ProgressEventBus.clearAllListeners();
    });

    it('should remove a subscribed listener', () => {
        const listener = () => {};
        ProgressEventBus.subscribe(listener);

        const removed = ProgressEventBus.unsubscribe(listener);

        assert.equal(removed, true);
        assert.equal(ProgressEventBus.getListenerCount(), 0);
    });

    it('should return false when removing non-subscribed listener', () => {
        const listener = () => {};
        const removed = ProgressEventBus.unsubscribe(listener);

        assert.equal(removed, false);
    });

    it('should remove only the specified listener', () => {
        const listener1 = () => {};
        const listener2 = () => {};
        const listener3 = () => {};

        ProgressEventBus.subscribe(listener1);
        ProgressEventBus.subscribe(listener2);
        ProgressEventBus.subscribe(listener3);

        ProgressEventBus.unsubscribe(listener2);

        assert.equal(ProgressEventBus.getListenerCount(), 2);
    });

    it('should handle multiple unsubscribes of same listener', () => {
        const listener = () => {};
        ProgressEventBus.subscribe(listener);

        const removed1 = ProgressEventBus.unsubscribe(listener);
        const removed2 = ProgressEventBus.unsubscribe(listener);

        assert.equal(removed1, true);
        assert.equal(removed2, false);
    });
});

describe('ProgressEventBus - Event Emission', () => {
    afterEach(() => {
        ProgressEventBus.clearAllListeners();
    });

    it('should emit event to single listener', () => {
        let receivedEvent = null;
        const listener = (event) => {
            receivedEvent = event;
        };

        ProgressEventBus.subscribe(listener);

        const event = new ProgressEvent({
            source: 'test',
            type: ProgressEventType.START,
            message: 'Test event',
        });

        ProgressEventBus.emit(event);

        assert.equal(receivedEvent, event);
        assert.equal(receivedEvent.source, 'test');
        assert.equal(receivedEvent.message, 'Test event');
    });

    it('should emit event to multiple listeners', () => {
        const receivedEvents = [];
        const listener1 = (event) => receivedEvents.push({ id: 1, event });
        const listener2 = (event) => receivedEvents.push({ id: 2, event });
        const listener3 = (event) => receivedEvents.push({ id: 3, event });

        ProgressEventBus.subscribe(listener1);
        ProgressEventBus.subscribe(listener2);
        ProgressEventBus.subscribe(listener3);

        const event = new ProgressEvent({
            source: 'test',
            type: ProgressEventType.UPDATE,
            message: 'Broadcast event',
        });

        ProgressEventBus.emit(event);

        assert.equal(receivedEvents.length, 3);
        assert.equal(receivedEvents[0].event, event);
        assert.equal(receivedEvents[1].event, event);
        assert.equal(receivedEvents[2].event, event);
    });

    it('should not call listeners after they unsubscribe', () => {
        let callCount = 0;
        const listener = () => {
            callCount++;
        };

        ProgressEventBus.subscribe(listener);

        const event = new ProgressEvent({
            source: 'test',
            type: ProgressEventType.UPDATE,
            message: 'Event 1',
        });

        ProgressEventBus.emit(event);
        assert.equal(callCount, 1);

        ProgressEventBus.unsubscribe(listener);

        ProgressEventBus.emit(event);
        assert.equal(callCount, 1); // Should not increase
    });

    it('should throw TypeError for non-ProgressEvent object', () => {
        const listener = () => {};
        ProgressEventBus.subscribe(listener);

        assert.throws(
            () => {
                ProgressEventBus.emit({ type: 'start', message: 'Invalid' });
            },
            {
                name: 'TypeError',
                message: /event must be a ProgressEvent instance/,
            }
        );
    });

    it('should throw TypeError for null event', () => {
        assert.throws(() => {
            ProgressEventBus.emit(null);
        }, TypeError);
    });

    it('should handle emission with no listeners', () => {
        const event = new ProgressEvent({
            source: 'test',
            type: ProgressEventType.START,
            message: 'No listeners',
        });

        // Should not throw
        assert.doesNotThrow(() => {
            ProgressEventBus.emit(event);
        });
    });
});

describe('ProgressEventBus - Error Isolation', () => {
    let consoleErrors;
    let originalError;

    beforeEach(() => {
        // Capture console.error calls
        consoleErrors = [];
        originalError = console.error;
        console.error = (...args) => {
            consoleErrors.push(args);
            // Optionally call original for debugging: originalError(...args);
        };
    });

    afterEach(() => {
        // Restore console.error
        console.error = originalError;
        ProgressEventBus.clearAllListeners();
    });

    it('should isolate errors from failing listeners', () => {
        const receivedEvents = [];
        const listener1 = () => receivedEvents.push(1);
        const listener2 = () => {
            throw new Error('Listener 2 failed');
        };
        const listener3 = () => receivedEvents.push(3);

        ProgressEventBus.subscribe(listener1);
        ProgressEventBus.subscribe(listener2);
        ProgressEventBus.subscribe(listener3);

        const event = new ProgressEvent({
            source: 'test',
            type: ProgressEventType.UPDATE,
            message: 'Test error isolation',
        });

        // Should not throw despite listener2 failing
        assert.doesNotThrow(() => {
            ProgressEventBus.emit(event);
        });

        // Listeners 1 and 3 should still execute
        assert.deepEqual(receivedEvents, [1, 3]);

        // Error should be logged
        assert.equal(consoleErrors.length, 1);
        assert.ok(consoleErrors[0][0].includes('Listener error'));
    });

    it('should continue after multiple listener failures', () => {
        const receivedEvents = [];
        const listener1 = () => {
            throw new Error('Fail 1');
        };
        const listener2 = () => {
            throw new Error('Fail 2');
        };
        const listener3 = () => receivedEvents.push(3);

        ProgressEventBus.subscribe(listener1);
        ProgressEventBus.subscribe(listener2);
        ProgressEventBus.subscribe(listener3);

        const event = new ProgressEvent({
            source: 'test',
            type: ProgressEventType.ERROR,
            message: 'Multiple failures',
        });

        ProgressEventBus.emit(event);

        assert.deepEqual(receivedEvents, [3]);
        assert.equal(consoleErrors.length, 2);
    });
});

describe('ProgressEventBus - Listener Modification During Emission', () => {
    afterEach(() => {
        ProgressEventBus.clearAllListeners();
    });

    it('should handle listener unsubscribing itself during emission', () => {
        let callCount = 0;
        const listener = () => {
            callCount++;
            ProgressEventBus.unsubscribe(listener);
        };

        ProgressEventBus.subscribe(listener);

        const event = new ProgressEvent({
            source: 'test',
            type: ProgressEventType.UPDATE,
            message: 'Self-unsubscribe',
        });

        // First emission: listener runs and unsubscribes
        ProgressEventBus.emit(event);
        assert.equal(callCount, 1);

        // Second emission: listener should not run
        ProgressEventBus.emit(event);
        assert.equal(callCount, 1);
    });

    it('should handle new listener subscribing during emission', () => {
        const callCounts = { a: 0, b: 0 };

        const listenerB = () => {
            callCounts.b++;
        };

        const listenerA = () => {
            callCounts.a++;
            // Subscribe a new listener during emission
            ProgressEventBus.subscribe(listenerB);
        };

        ProgressEventBus.subscribe(listenerA);

        const event = new ProgressEvent({
            source: 'test',
            type: ProgressEventType.UPDATE,
            message: 'Mid-emission subscription',
        });

        // First emission: A subscribes B, but B shouldn't run yet (snapshot)
        ProgressEventBus.emit(event);
        assert.equal(callCounts.a, 1);
        assert.equal(callCounts.b, 0);

        // Second emission: B should run now
        ProgressEventBus.emit(event);
        assert.equal(callCounts.a, 2);
        assert.equal(callCounts.b, 1);
    });
});

describe('ProgressEventBus - Utility Methods', () => {
    afterEach(() => {
        ProgressEventBus.clearAllListeners();
    });

    it('should report correct listener count', () => {
        assert.equal(ProgressEventBus.getListenerCount(), 0);

        const listener1 = () => {};
        ProgressEventBus.subscribe(listener1);
        assert.equal(ProgressEventBus.getListenerCount(), 1);

        const listener2 = () => {};
        ProgressEventBus.subscribe(listener2);
        assert.equal(ProgressEventBus.getListenerCount(), 2);

        ProgressEventBus.unsubscribe(listener1);
        assert.equal(ProgressEventBus.getListenerCount(), 1);
    });

    it('should clear all listeners', () => {
        const listener1 = () => {};
        const listener2 = () => {};
        const listener3 = () => {};

        ProgressEventBus.subscribe(listener1);
        ProgressEventBus.subscribe(listener2);
        ProgressEventBus.subscribe(listener3);

        assert.equal(ProgressEventBus.getListenerCount(), 3);

        ProgressEventBus.clearAllListeners();

        assert.equal(ProgressEventBus.getListenerCount(), 0);
    });
});

// ============================================================================
// Step 1.3: ProgressTracker Tests
// ============================================================================

describe('ProgressTracker - Construction', () => {
    it('should create tracker with source only', () => {
        const tracker = new ProgressTracker('workspace');

        assert.equal(tracker.source, 'workspace');
        assert.equal(tracker.totalSteps, undefined);
        assert.equal(tracker.currentStep, 0);
        assert.equal(tracker.isStarted, false);
        assert.equal(tracker.isFinished, false);
    });

    it('should create tracker with source and totalSteps', () => {
        const tracker = new ProgressTracker('node-packages', 5);

        assert.equal(tracker.source, 'node-packages');
        assert.equal(tracker.totalSteps, 5);
        assert.equal(tracker.currentStep, 0);
    });

    it('should trim whitespace from source', () => {
        const tracker = new ProgressTracker('  workspace  ');

        assert.equal(tracker.source, 'workspace');
    });

    it('should throw TypeError for missing source', () => {
        assert.throws(
            () => {
                new ProgressTracker();
            },
            {
                name: 'TypeError',
                message: /source must be a non-empty string/,
            }
        );
    });

    it('should throw TypeError for empty source', () => {
        assert.throws(() => {
            new ProgressTracker('   ');
        }, TypeError);
    });

    it('should throw TypeError for non-string source', () => {
        assert.throws(() => {
            new ProgressTracker(123);
        }, TypeError);
    });

    it('should throw TypeError for non-number totalSteps', () => {
        assert.throws(
            () => {
                new ProgressTracker('test', 'five');
            },
            {
                name: 'TypeError',
                message: /totalSteps must be a positive number/,
            }
        );
    });

    it('should throw TypeError for zero totalSteps', () => {
        assert.throws(() => {
            new ProgressTracker('test', 0);
        }, TypeError);
    });

    it('should throw TypeError for negative totalSteps', () => {
        assert.throws(() => {
            new ProgressTracker('test', -5);
        }, TypeError);
    });
});

describe('ProgressTracker - Start Method', () => {
    let receivedEvents;
    let listener;

    beforeEach(() => {
        receivedEvents = [];
        listener = (event) => receivedEvents.push(event);
        ProgressEventBus.subscribe(listener);
    });

    afterEach(() => {
        ProgressEventBus.clearAllListeners();
    });

    it('should emit START event', () => {
        const tracker = new ProgressTracker('workspace');
        tracker.start('Initializing workspace...');

        assert.equal(receivedEvents.length, 1);
        assert.equal(receivedEvents[0].source, 'workspace');
        assert.equal(receivedEvents[0].type, 'start');
        assert.equal(receivedEvents[0].message, 'Initializing workspace...');
        assert.equal(receivedEvents[0].progress, 0);
    });

    it('should mark tracker as started', () => {
        const tracker = new ProgressTracker('test');
        assert.equal(tracker.isStarted, false);

        tracker.start('Starting...');

        assert.equal(tracker.isStarted, true);
        assert.equal(tracker.isFinished, false);
    });

    it('should reset currentStep to 0', () => {
        const tracker = new ProgressTracker('test', 5);
        tracker.start('Start');
        tracker.update('Update', 3);
        assert.equal(tracker.currentStep, 3);

        // Restart
        tracker.start('Restart');

        assert.equal(tracker.currentStep, 0);
    });

    it('should include optional detail', () => {
        const tracker = new ProgressTracker('test');
        const detail = { config: 'default' };

        tracker.start('Starting...', detail);

        assert.equal(receivedEvents[0].detail, detail);
    });

    it('should throw TypeError for non-string message', () => {
        const tracker = new ProgressTracker('test');

        assert.throws(
            () => {
                tracker.start(123);
            },
            {
                name: 'TypeError',
                message: /message must be a string/,
            }
        );
    });
});

describe('ProgressTracker - Update Method (without totalSteps)', () => {
    let receivedEvents;
    let listener;

    beforeEach(() => {
        receivedEvents = [];
        listener = (event) => receivedEvents.push(event);
        ProgressEventBus.subscribe(listener);
    });

    afterEach(() => {
        ProgressEventBus.clearAllListeners();
    });

    it('should emit UPDATE event without progress', () => {
        const tracker = new ProgressTracker('workspace');
        tracker.update('Loading configuration...');

        assert.equal(receivedEvents.length, 1);
        assert.equal(receivedEvents[0].source, 'workspace');
        assert.equal(receivedEvents[0].type, 'update');
        assert.equal(receivedEvents[0].message, 'Loading configuration...');
        assert.equal(receivedEvents[0].progress, undefined);
    });

    it('should emit UPDATE event with explicit progress', () => {
        const tracker = new ProgressTracker('workspace');
        tracker.update('Loading...', 45);

        assert.equal(receivedEvents[0].progress, 45);
    });

    it('should accept progress of 0', () => {
        const tracker = new ProgressTracker('test');
        tracker.update('Starting...', 0);

        assert.equal(receivedEvents[0].progress, 0);
    });

    it('should accept progress of 100', () => {
        const tracker = new ProgressTracker('test');
        tracker.update('Almost done...', 100);

        assert.equal(receivedEvents[0].progress, 100);
    });

    it('should include optional detail', () => {
        const tracker = new ProgressTracker('test');
        const detail = { itemsProcessed: 10 };

        tracker.update('Processing...', 50, detail);

        assert.equal(receivedEvents[0].detail, detail);
    });

    it('should throw RangeError for negative progress', () => {
        const tracker = new ProgressTracker('test');

        assert.throws(
            () => {
                tracker.update('Test', -1);
            },
            {
                name: 'RangeError',
                message: /progress must be between 0 and 100/,
            }
        );
    });

    it('should throw RangeError for progress > 100', () => {
        const tracker = new ProgressTracker('test');

        assert.throws(() => {
            tracker.update('Test', 101);
        }, RangeError);
    });

    it('should throw TypeError for non-string message', () => {
        const tracker = new ProgressTracker('test');

        assert.throws(() => {
            tracker.update(123);
        }, TypeError);
    });

    it('should throw TypeError for non-number progress', () => {
        const tracker = new ProgressTracker('test');

        assert.throws(() => {
            tracker.update('Test', 'fifty');
        }, TypeError);
    });
});

describe('ProgressTracker - Update Method (with totalSteps)', () => {
    let receivedEvents;
    let listener;

    beforeEach(() => {
        receivedEvents = [];
        listener = (event) => receivedEvents.push(event);
        ProgressEventBus.subscribe(listener);
    });

    afterEach(() => {
        ProgressEventBus.clearAllListeners();
    });

    it('should calculate progress from step count', () => {
        const tracker = new ProgressTracker('packages', 10);

        tracker.update('Package 1', 1);
        assert.equal(receivedEvents[0].progress, 10);

        tracker.update('Package 5', 5);
        assert.equal(receivedEvents[1].progress, 50);

        tracker.update('Package 10', 10);
        assert.equal(receivedEvents[2].progress, 100);
    });

    it('should handle step 0 (0% progress)', () => {
        const tracker = new ProgressTracker('test', 5);

        tracker.update('Starting...', 0);

        assert.equal(receivedEvents[0].progress, 0);
    });

    it('should update currentStep', () => {
        const tracker = new ProgressTracker('test', 5);

        tracker.update('Step 1', 1);
        assert.equal(tracker.currentStep, 1);

        tracker.update('Step 3', 3);
        assert.equal(tracker.currentStep, 3);
    });

    it('should round progress to nearest integer', () => {
        const tracker = new ProgressTracker('test', 3);

        tracker.update('Step 1', 1); // 33.33... -> 33%
        assert.equal(receivedEvents[0].progress, 33);

        tracker.update('Step 2', 2); // 66.66... -> 67%
        assert.equal(receivedEvents[1].progress, 67);
    });

    it('should throw RangeError for step > totalSteps', () => {
        const tracker = new ProgressTracker('test', 5);

        assert.throws(
            () => {
                tracker.update('Too many', 6);
            },
            {
                name: 'RangeError',
                message: /step must be between 0 and 5/,
            }
        );
    });

    it('should throw RangeError for negative step', () => {
        const tracker = new ProgressTracker('test', 5);

        assert.throws(() => {
            tracker.update('Negative', -1);
        }, RangeError);
    });
});

describe('ProgressTracker - Complete Method', () => {
    let receivedEvents;
    let listener;

    beforeEach(() => {
        receivedEvents = [];
        listener = (event) => receivedEvents.push(event);
        ProgressEventBus.subscribe(listener);
    });

    afterEach(() => {
        ProgressEventBus.clearAllListeners();
    });

    it('should emit COMPLETE event', () => {
        const tracker = new ProgressTracker('workspace');
        tracker.complete('Workspace ready');

        assert.equal(receivedEvents.length, 1);
        assert.equal(receivedEvents[0].source, 'workspace');
        assert.equal(receivedEvents[0].type, 'complete');
        assert.equal(receivedEvents[0].message, 'Workspace ready');
        assert.equal(receivedEvents[0].progress, 100);
    });

    it('should mark tracker as finished', () => {
        const tracker = new ProgressTracker('test');
        assert.equal(tracker.isFinished, false);

        tracker.complete('Done');

        assert.equal(tracker.isFinished, true);
    });

    it('should include optional detail', () => {
        const tracker = new ProgressTracker('test');
        const detail = { duration: 1234 };

        tracker.complete('Complete', detail);

        assert.equal(receivedEvents[0].detail, detail);
    });

    it('should throw TypeError for non-string message', () => {
        const tracker = new ProgressTracker('test');

        assert.throws(() => {
            tracker.complete(123);
        }, TypeError);
    });
});

describe('ProgressTracker - Error Method', () => {
    let receivedEvents;
    let listener;

    beforeEach(() => {
        receivedEvents = [];
        listener = (event) => receivedEvents.push(event);
        ProgressEventBus.subscribe(listener);
    });

    afterEach(() => {
        ProgressEventBus.clearAllListeners();
    });

    it('should emit ERROR event', () => {
        const tracker = new ProgressTracker('workspace');
        tracker.error('Failed to load configuration');

        assert.equal(receivedEvents.length, 1);
        assert.equal(receivedEvents[0].source, 'workspace');
        assert.equal(receivedEvents[0].type, 'error');
        assert.equal(receivedEvents[0].message, 'Failed to load configuration');
        assert.equal(receivedEvents[0].progress, undefined);
    });

    it('should mark tracker as finished', () => {
        const tracker = new ProgressTracker('test');
        assert.equal(tracker.isFinished, false);

        tracker.error('Error occurred');

        assert.equal(tracker.isFinished, true);
    });

    it('should include error in detail', () => {
        const tracker = new ProgressTracker('test');
        const error = new Error('Network failure');

        tracker.error('Failed to load', error);

        assert.ok(receivedEvents[0].detail);
        assert.equal(receivedEvents[0].detail.error, error);
    });

    it('should handle error without additional details', () => {
        const tracker = new ProgressTracker('test');

        tracker.error('Generic error');

        assert.equal(receivedEvents[0].detail, undefined);
    });

    it('should throw TypeError for non-string message', () => {
        const tracker = new ProgressTracker('test');

        assert.throws(() => {
            tracker.error(123);
        }, TypeError);
    });
});

describe('ProgressTracker - Complete Workflow', () => {
    let receivedEvents;
    let listener;

    beforeEach(() => {
        receivedEvents = [];
        listener = (event) => receivedEvents.push(event);
        ProgressEventBus.subscribe(listener);
    });

    afterEach(() => {
        ProgressEventBus.clearAllListeners();
    });

    it('should track complete workflow without steps', () => {
        const tracker = new ProgressTracker('workspace');

        tracker.start('Starting workspace initialization');
        tracker.update('Loading configuration');
        tracker.update('Setting up panels');
        tracker.update('Binding events');
        tracker.complete('Workspace ready');

        assert.equal(receivedEvents.length, 5);
        assert.equal(receivedEvents[0].type, 'start');
        assert.equal(receivedEvents[1].type, 'update');
        assert.equal(receivedEvents[2].type, 'update');
        assert.equal(receivedEvents[3].type, 'update');
        assert.equal(receivedEvents[4].type, 'complete');
    });

    it('should track complete workflow with steps', () => {
        const tracker = new ProgressTracker('node-packages', 5);

        tracker.start('Loading packages');
        tracker.update('Loaded core package', 1);
        tracker.update('Loaded ui package', 2);
        tracker.update('Loaded devices package', 3);
        tracker.update('Loaded runtime package', 4);
        tracker.update('Loaded utils package', 5);
        tracker.complete('All packages loaded');

        assert.equal(receivedEvents.length, 7);

        // Check progress calculation
        assert.equal(receivedEvents[0].progress, 0); // start
        assert.equal(receivedEvents[1].progress, 20); // 1/5
        assert.equal(receivedEvents[2].progress, 40); // 2/5
        assert.equal(receivedEvents[3].progress, 60); // 3/5
        assert.equal(receivedEvents[4].progress, 80); // 4/5
        assert.equal(receivedEvents[5].progress, 100); // 5/5
        assert.equal(receivedEvents[6].progress, 100); // complete
    });

    it('should track workflow ending in error', () => {
        const tracker = new ProgressTracker('device-runtime');
        const error = new Error('Collection not found');

        tracker.start('Loading device collections');
        tracker.update('Loading collection 1');
        tracker.error('Failed to load collection', error);

        assert.equal(receivedEvents.length, 3);
        assert.equal(receivedEvents[0].type, 'start');
        assert.equal(receivedEvents[1].type, 'update');
        assert.equal(receivedEvents[2].type, 'error');
        assert.equal(receivedEvents[2].detail.error, error);
    });
});
