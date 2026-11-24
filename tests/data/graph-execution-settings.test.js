// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file Unit tests for the shared graph execution-settings module.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    DEFAULT_EXECUTION_TYPE,
    DEFAULT_GRAPH_ENABLED,
    DEFAULT_RUN_ON_START,
    DEFAULT_SIGNAL_MODE,
    DEFAULT_SLEEP_MS,
    DEFAULT_TRIGGER_NAME,
    GRAPH_EXECUTION_TYPES,
    MAX_SIGNAL_COUNT,
    MAX_SIGNAL_NAME_LENGTH,
    MAX_SLEEP_MS,
    MIN_SLEEP_MS,
    clampSleepDuration,
    normalizeExecutionType,
    normalizeGraphEnabled,
    normalizeRunOnStart,
    normalizeSignalMode,
    normalizeSignalNames,
    normalizeTriggerName,
} from '../../src/micro_otter/nodes/html/js/data/graph-execution-settings.js';

describe('normalizeExecutionType', () => {
    it('keeps known execution types', () => {
        assert.equal(normalizeExecutionType('startup'), 'startup');
        assert.equal(normalizeExecutionType('continuous'), 'continuous');
        assert.equal(normalizeExecutionType('irq'), 'irq');
        assert.equal(normalizeExecutionType('event'), 'event');
        assert.equal(normalizeExecutionType('function'), 'function');
    });

    it('normalizes case and surrounding whitespace', () => {
        assert.equal(normalizeExecutionType('  Startup '), 'startup');
        assert.equal(normalizeExecutionType('CONTINUOUS'), 'continuous');
        assert.equal(normalizeExecutionType(' IRQ '), 'irq');
        assert.equal(normalizeExecutionType(' EVENT '), 'event');
        assert.equal(normalizeExecutionType(' Function '), 'function');
    });

    it('falls back to the default for unknown or non-string values', () => {
        assert.equal(normalizeExecutionType('loop'), DEFAULT_EXECUTION_TYPE);
        assert.equal(normalizeExecutionType(null), DEFAULT_EXECUTION_TYPE);
        assert.equal(normalizeExecutionType(undefined), DEFAULT_EXECUTION_TYPE);
        assert.equal(normalizeExecutionType(42), DEFAULT_EXECUTION_TYPE);
        assert.equal(normalizeExecutionType({}), DEFAULT_EXECUTION_TYPE);
        assert.equal(normalizeExecutionType(''), DEFAULT_EXECUTION_TYPE);
    });
});

describe('normalizeGraphEnabled', () => {
    it('disables a graph only for the literal boolean false', () => {
        assert.equal(normalizeGraphEnabled(false), false);
        assert.equal(normalizeGraphEnabled(true), true);
    });

    it('accepts the string form of false', () => {
        assert.equal(normalizeGraphEnabled('false'), false);
        assert.equal(normalizeGraphEnabled('  False '), false);
        assert.equal(normalizeGraphEnabled('true'), true);
    });

    it('treats missing or unusable values as enabled', () => {
        assert.equal(normalizeGraphEnabled(undefined), DEFAULT_GRAPH_ENABLED);
        assert.equal(normalizeGraphEnabled(null), DEFAULT_GRAPH_ENABLED);
        assert.equal(normalizeGraphEnabled(0), DEFAULT_GRAPH_ENABLED);
        assert.equal(normalizeGraphEnabled(''), DEFAULT_GRAPH_ENABLED);
        assert.equal(normalizeGraphEnabled({}), DEFAULT_GRAPH_ENABLED);
    });

    it('defaults legacy graphs to enabled', () => {
        assert.equal(DEFAULT_GRAPH_ENABLED, true);
    });
});

describe('clampSleepDuration', () => {
    it('keeps in-range values', () => {
        assert.equal(clampSleepDuration(250), 250);
        assert.equal(clampSleepDuration('250'), 250);
    });

    it('accepts 0 and small positive values', () => {
        assert.equal(clampSleepDuration(0), 0);
        assert.equal(clampSleepDuration('0'), 0);
        assert.equal(clampSleepDuration(5), 5);
    });

    it('floors fractional values', () => {
        assert.equal(clampSleepDuration('250.9'), 250);
        assert.equal(clampSleepDuration(9.9), 9);
    });

    it('clamps to the supported range', () => {
        assert.equal(clampSleepDuration(-100), MIN_SLEEP_MS);
        assert.equal(clampSleepDuration(-0.5), MIN_SLEEP_MS);
        assert.equal(clampSleepDuration(70000), MAX_SLEEP_MS);
    });

    it('falls back to the default for blank or non-numeric input', () => {
        assert.equal(clampSleepDuration(''), DEFAULT_SLEEP_MS);
        assert.equal(clampSleepDuration('   '), DEFAULT_SLEEP_MS);
        assert.equal(clampSleepDuration('abc'), DEFAULT_SLEEP_MS);
        assert.equal(clampSleepDuration(Number.NaN), DEFAULT_SLEEP_MS);
        assert.equal(clampSleepDuration(Infinity), DEFAULT_SLEEP_MS);
        assert.equal(clampSleepDuration(undefined), DEFAULT_SLEEP_MS);
        assert.equal(clampSleepDuration(null), DEFAULT_SLEEP_MS);
        assert.equal(clampSleepDuration({}), DEFAULT_SLEEP_MS);
        assert.equal(clampSleepDuration([]), DEFAULT_SLEEP_MS);
        assert.equal(clampSleepDuration(true), DEFAULT_SLEEP_MS);
    });
});

describe('graph execution settings constants', () => {
    it('exposes a sane interval range', () => {
        assert.equal(MIN_SLEEP_MS, 0);
        assert.equal(DEFAULT_SLEEP_MS, 500);
        assert.equal(MAX_SLEEP_MS, 60000);
        assert.ok(MIN_SLEEP_MS < DEFAULT_SLEEP_MS);
        assert.ok(DEFAULT_SLEEP_MS < MAX_SLEEP_MS);
        assert.ok(MIN_SLEEP_MS < MAX_SLEEP_MS);
    });

    it('exposes all execution types with a valid default', () => {
        assert.deepEqual(
            [...GRAPH_EXECUTION_TYPES],
            ['startup', 'continuous', 'irq', 'event', 'function']
        );
        assert.ok(GRAPH_EXECUTION_TYPES.includes(DEFAULT_EXECUTION_TYPE));
    });

    it('exposes an unset trigger name', () => {
        assert.equal(DEFAULT_TRIGGER_NAME, '');
    });
});

describe('normalizeTriggerName', () => {
    it('trims surrounding whitespace', () => {
        assert.equal(normalizeTriggerName('  Button  '), 'Button');
        assert.equal(normalizeTriggerName('\tButton\n'), 'Button');
    });

    it('keeps case and inner spaces', () => {
        assert.equal(normalizeTriggerName('Button'), 'Button');
        assert.equal(normalizeTriggerName('button'), 'button');
        assert.equal(normalizeTriggerName(' Hall  Sensor '), 'Hall  Sensor');
    });

    it('returns the unset name for unusable values', () => {
        assert.equal(normalizeTriggerName(''), DEFAULT_TRIGGER_NAME);
        assert.equal(normalizeTriggerName('   '), DEFAULT_TRIGGER_NAME);
        assert.equal(normalizeTriggerName(undefined), DEFAULT_TRIGGER_NAME);
        assert.equal(normalizeTriggerName(null), DEFAULT_TRIGGER_NAME);
        assert.equal(normalizeTriggerName(42), DEFAULT_TRIGGER_NAME);
        assert.equal(normalizeTriggerName({}), DEFAULT_TRIGGER_NAME);
        assert.equal(normalizeTriggerName([]), DEFAULT_TRIGGER_NAME);
    });
});

describe('normalizeSignalNames', () => {
    it('rejects non-arrays', () => {
        assert.deepEqual(normalizeSignalNames(undefined), []);
        assert.deepEqual(normalizeSignalNames(null), []);
        assert.deepEqual(normalizeSignalNames('a'), []);
        assert.deepEqual(normalizeSignalNames({}), []);
    });

    it('trims entries and drops blanks', () => {
        assert.deepEqual(normalizeSignalNames(['  radar ', '', '  ']), ['radar']);
    });

    it('slices over-long names to 64 characters', () => {
        assert.deepEqual(normalizeSignalNames(['a'.repeat(70)]), ['a'.repeat(MAX_SIGNAL_NAME_LENGTH)]);
    });

    it('deduplicates case-sensitively, keeping first occurrence', () => {
        assert.deepEqual(normalizeSignalNames(['radar', 'Radar', 'radar']), ['radar', 'Radar']);
    });

    it('truncates to the signal-count limit', () => {
        const many = Array.from({ length: MAX_SIGNAL_COUNT + 5 }, (_, i) => `s${i}`);
        assert.equal(normalizeSignalNames(many).length, MAX_SIGNAL_COUNT);
    });
});

describe('normalizeSignalMode', () => {
    it('selects all only for the string form of all', () => {
        assert.equal(normalizeSignalMode('all'), 'all');
        assert.equal(normalizeSignalMode('  ALL '), 'all');
    });

    it('falls back to any for everything else', () => {
        assert.equal(normalizeSignalMode('any'), DEFAULT_SIGNAL_MODE);
        assert.equal(normalizeSignalMode(''), DEFAULT_SIGNAL_MODE);
        assert.equal(normalizeSignalMode(undefined), DEFAULT_SIGNAL_MODE);
        assert.equal(normalizeSignalMode(42), DEFAULT_SIGNAL_MODE);
        assert.equal(DEFAULT_SIGNAL_MODE, 'any');
    });
});

describe('normalizeRunOnStart', () => {
    it('disables only for false or its string form', () => {
        assert.equal(normalizeRunOnStart(false), false);
        assert.equal(normalizeRunOnStart('false'), false);
        assert.equal(normalizeRunOnStart('  False '), false);
    });

    it('falls back to true for everything else', () => {
        assert.equal(normalizeRunOnStart(true), DEFAULT_RUN_ON_START);
        assert.equal(normalizeRunOnStart(undefined), DEFAULT_RUN_ON_START);
        assert.equal(normalizeRunOnStart(0), DEFAULT_RUN_ON_START);
        assert.equal(DEFAULT_RUN_ON_START, true);
    });
});

describe('signal constants', () => {
    it('exposes the signal limits', () => {
        assert.equal(MAX_SIGNAL_COUNT, 32);
        assert.equal(MAX_SIGNAL_NAME_LENGTH, 64);
    });
});

