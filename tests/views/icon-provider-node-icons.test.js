import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { IconProvider } from '../../src/micro_otter/nodes/html/js/views/icon-provider.js';

describe('IconProvider node icons', () => {
    it('registers compare and logic node icon aliases', () => {
        assert.equal(IconProvider.has('branchingNode'), false);
        assert.equal(IconProvider.has('compareNode'), true);
        assert.equal(IconProvider.has('logicNode'), true);
    });

    it('resolves icon URLs for new node icon aliases', () => {
        assert.equal(
            IconProvider.getPath('compareNode'),
            '/html/icons/compare_arrows_24dp.svg'
        );
        assert.equal(
            IconProvider.getPath('logicNode'),
            '/html/icons/logic_ampersand_24dp.svg'
        );
    });
});
