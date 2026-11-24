import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { ViewBase } from '../../src/micro_otter/nodes/html/js/views/view-base.js';
import { TabbedView } from '../../src/micro_otter/nodes/html/js/views/tabbed-view.js';
import { AppEvent } from '../../src/micro_otter/nodes/html/js/core/app-event.js';

class TestView extends ViewBase {
    render() {}
}

describe('TabbedView event contract regressions', () => {
    it('emits tab-changed as AppEvent with TabChanged payload type', () => {
        const first = new TestView({ id: 'view-1', title: 'First' });
        const second = new TestView({ id: 'view-2', title: 'Second' });
        const tabbed = new TabbedView({ views: [first, second], activeId: 'view-1' });

        let received = null;
        tabbed.on('tab-changed', (event) => {
            received = event;
        });

        tabbed.selectView('view-2');

        assert.ok(received instanceof AppEvent);
        assert.equal(received.name, 'tab-changed');
        assert.equal(received.detail.payloadTypeId, 'TabbedView.TabChanged.v1');
        assert.equal(received.detail.previousId, 'view-1');
        assert.equal(received.detail.activeId, 'view-2');
    });

    it('emits tab-moved as AppEvent with TabMoved payload type', () => {
        const first = new TestView({ id: 'view-1', title: 'First' });
        const second = new TestView({ id: 'view-2', title: 'Second' });
        const third = new TestView({ id: 'view-3', title: 'Third' });
        const tabbed = new TabbedView({
            views: [first, second, third],
            activeId: 'view-1',
            reorderable: true,
        });

        let received = null;
        tabbed.on('tab-moved', (event) => {
            received = event;
        });

        assert.equal(tabbed.moveView('view-1', 2), true);

        assert.ok(received instanceof AppEvent);
        assert.equal(received.name, 'tab-moved');
        assert.equal(received.detail.payloadTypeId, 'TabbedView.TabMoved.v1');
        assert.equal(received.detail.viewId, 'view-1');
        assert.equal(received.detail.fromIndex, 0);
        assert.equal(received.detail.toIndex, 2);
        assert.equal(received.detail.view, first);
    });

    it('emits tab-renamed and accept() applies rename', () => {
        const view = new TestView({ id: 'view-1', title: 'Original' });
        const tabbed = new TabbedView({ views: [view], activeId: 'view-1' });

        let received = null;
        tabbed.on('tab-renamed', (event) => {
            received = event;
            event.detail.accept();
        });

        tabbed._commitTabRename('view-1', 'Original', 'Renamed');

        assert.ok(received instanceof AppEvent);
        assert.equal(received.name, 'tab-renamed');
        assert.equal(received.detail.payloadTypeId, 'TabbedView.TabRenamed.v1');
        assert.equal(received.detail.viewId, 'view-1');
        assert.equal(received.detail.oldName, 'Original');
        assert.equal(received.detail.newName, 'Renamed');
        assert.equal(view.title, 'Renamed');
    });

    it('emits tab-renamed and reject() keeps previous title', () => {
        const view = new TestView({ id: 'view-1', title: 'Original' });
        const tabbed = new TabbedView({ views: [view], activeId: 'view-1' });

        let received = null;
        tabbed.on('tab-renamed', (event) => {
            received = event;
            event.detail.reject('duplicate');
        });

        tabbed._commitTabRename('view-1', 'Original', 'Duplicate');

        assert.ok(received instanceof AppEvent);
        assert.equal(received.detail.payloadTypeId, 'TabbedView.TabRenamed.v1');
        assert.equal(view.title, 'Original');
    });
});
