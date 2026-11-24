// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file Unknown node types become capability issues that name the owning package.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    MISSING_NODE_TYPE_MESSAGE_FALLBACK,
    MISSING_NODE_TYPE_MESSAGE_KEY,
    createMissingNodeTypeIssue,
    packageIdForTypeId,
} from '../../src/micro_otter/nodes/html/js/core/missing-node-type-issue.js';

describe('packageIdForTypeId', () => {
    it('returns the package segment of a hub type id', () => {
        assert.equal(packageIdForTypeId('sample_addon.hello'), 'sample_addon');
        // Nested ids keep the first segment, which is the package id.
        assert.equal(packageIdForTypeId('extra.multi.part'), 'extra');
    });

    it('returns null when the id carries no package prefix', () => {
        assert.equal(packageIdForTypeId('core'), null);
        assert.equal(packageIdForTypeId('.leading'), null);
        assert.equal(packageIdForTypeId(''), null);
        assert.equal(packageIdForTypeId(null), null);
        assert.equal(packageIdForTypeId(42), null);
    });
});

describe('createMissingNodeTypeIssue', () => {
    it('names the type and the package in the default message', () => {
        const issue = createMissingNodeTypeIssue({
            nodeId: 'node-1',
            typeId: 'sample_addon.hello',
        });

        assert.equal(issue.nodeId, 'node-1');
        assert.equal(issue.scope, 'node');
        assert.equal(issue.capability, null);
        assert.equal(issue.controlId, null);
        assert.equal(issue.inputId, null);
        // `NodeData.setCapabilityIssues` normalizes every issue to this source.
        assert.equal(issue.source, 'capabilityCheck');
        assert.match(issue.message, /sample_addon\.hello/);
        assert.match(issue.message, /sample_addon/);
        assert.equal(issue.message.includes('{{'), false);
    });

    it('uses the translated sentence when the key resolves', () => {
        const seen = [];
        const issue = createMissingNodeTypeIssue({
            nodeId: 'node-1',
            typeId: 'sample_addon.hello',
            translate: (key, params) => {
                seen.push({ key, params });
                return 'Translated';
            },
        });

        assert.equal(issue.message, 'Translated');
        assert.deepEqual(seen, [
            {
                key: MISSING_NODE_TYPE_MESSAGE_KEY,
                params: { type: 'sample_addon.hello', package: 'sample_addon' },
            },
        ]);
    });

    it('falls back to the English sentence when the key is untranslated', () => {
        const issue = createMissingNodeTypeIssue({
            nodeId: 'node-1',
            typeId: 'sample_addon.hello',
            // `I18nService.t` echoes the key for unknown keys, which must not reach the tooltip.
            translate: (key) => key,
        });

        assert.equal(
            issue.message,
            MISSING_NODE_TYPE_MESSAGE_FALLBACK.replace('{{type}}', 'sample_addon.hello').replace(
                '{{package}}',
                'sample_addon'
            )
        );
    });

    it('tolerates a node without a usable type id', () => {
        const issue = createMissingNodeTypeIssue({ nodeId: 'node-1', typeId: undefined });

        assert.match(issue.message, /Unknown node type/);
        assert.equal(issue.message.includes('{{'), false);
    });
});
