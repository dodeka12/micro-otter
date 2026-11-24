// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import NodeData from '../../src/micro_otter/nodes/html/js/data/node-data.js';

describe('NodeData naming model', () => {
    it('initializes with typeName and empty userName', () => {
        const node = new NodeData({
            id: 5,
            type: 'core.constant',
            typeName: { en: 'Constant', de: 'Konstante' },
        });

        assert.deepEqual(node.getTypeName(), { en: 'Constant', de: 'Konstante' });
        assert.equal(node.getUserName(), null);
        assert.equal(node.getDisplayName('de'), 'Konstante');
        assert.equal(node.title, 'Constant');
    });

    it('setUserNameForLocale() overrides display name only for that locale', () => {
        const node = new NodeData({
            id: 6,
            type: 'core.constant',
            typeName: { en: 'Constant', de: 'Konstante' },
        });

        node.setUserNameForLocale('de', 'Wohnzimmer Wert');

        assert.deepEqual(node.getUserNames(), { de: 'Wohnzimmer Wert' });
        assert.equal(node.getDisplayName('de'), 'Wohnzimmer Wert');
        assert.equal(node.getDisplayName('en'), 'Constant');
        assert.equal(node.title, 'Constant');
    });

    it('clearUserName(locale) clears only that locale entry', () => {
        const node = new NodeData({
            id: 7,
            type: 'core.constant',
            typeName: { en: 'Constant', de: 'Konstante' },
            userName: { en: 'Custom EN', de: 'Custom DE' },
        });

        node.clearUserName('de');

        assert.deepEqual(node.getUserNames(), { en: 'Custom EN' });
        assert.equal(node.getDisplayName('de'), 'Konstante');
        assert.equal(node.getDisplayName('en'), 'Custom EN');
        assert.equal(node.title, 'Custom EN');
    });

    it('setTitle() maps to en locale user name for compatibility', () => {
        const node = new NodeData({
            id: 8,
            type: 'core.constant',
            typeName: { en: 'Constant', de: 'Konstante' },
        });

        node.setTitle('My Node');

        assert.deepEqual(node.getUserNames(), { en: 'My Node' });
        assert.equal(node.title, 'My Node');
    });

    it('toData() includes typeName and userName', () => {
        const node = new NodeData({
            id: 9,
            type: 'core.constant',
            typeName: { en: 'Constant', de: 'Konstante' },
            userName: { en: 'Custom Name', de: 'Eigener Name' },
        });

        const data = node.toData();

        assert.deepEqual(data.typeName, { en: 'Constant', de: 'Konstante' });
        assert.deepEqual(data.userName, { en: 'Custom Name', de: 'Eigener Name' });
        assert.equal(data.title, 'Custom Name');
    });
});
