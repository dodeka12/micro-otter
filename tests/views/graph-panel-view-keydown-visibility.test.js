import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { GraphPanelView } from '../../src/micro_otter/nodes/html/js/views/graph-panel-view.js';

function makeViewLike(isVisible) {
    let keyDownDispatched = 0;
    return {
        _isVisible: isVisible,
        interactionModule: {
            handleKeyDown() {
                keyDownDispatched += 1;
                return true;
            },
        },
        _keyDownDispatched: () => keyDownDispatched,
    };
}

describe('GraphPanelView handleKeyDown visibility guard', () => {
    it('ignores keyboard shortcuts when the panel is hidden', () => {
        const viewLike = makeViewLike(false);
        GraphPanelView.prototype.handleKeyDown.call(viewLike, {
            key: 'v',
            ctrlKey: true,
            preventDefault() {},
        });
        assert.equal(viewLike._keyDownDispatched(), 0);
    });

    it('dispatches keyboard shortcuts when the panel is visible', () => {
        const viewLike = makeViewLike(true);
        GraphPanelView.prototype.handleKeyDown.call(viewLike, {
            key: 'v',
            ctrlKey: true,
            preventDefault() {},
        });
        assert.equal(viewLike._keyDownDispatched(), 1);
    });
});
