import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { SplitView } from '../../src/micro_otter/nodes/html/js/views/split-view.js';
import { ViewBase } from '../../src/micro_otter/nodes/html/js/views/view-base.js';
import { AppEvent } from '../../src/micro_otter/nodes/html/js/core/app-event.js';

class DummyView extends ViewBase {
    render(container) {
        const el = document.createElement('div');
        el.className = 'dummy-view';
        container.replaceChildren(el);
    }
}

describe('SplitView event contract', () => {
    let dom;
    let document;
    let window;
    let container;

    beforeEach(() => {
        dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
            url: 'http://localhost',
        });
        window = dom.window;
        document = window.document;

        global.window = window;
        global.document = document;
        global.HTMLElement = window.HTMLElement;
        global.EventTarget = window.EventTarget;
        global.CustomEvent = window.CustomEvent;

        container = document.createElement('div');
        container.style.width = '1200px';
        container.style.height = '800px';
        document.body.appendChild(container);
    });

    afterEach(() => {
        if (container && container.parentNode) {
            container.parentNode.removeChild(container);
        }
        delete global.window;
        delete global.document;
        delete global.HTMLElement;
        delete global.EventTarget;
        delete global.CustomEvent;
    });

    it('emits layoutChange as AppEvent with SplitView.LayoutChange.v1 payload', () => {
        const split = new SplitView({
            views: [new DummyView({ title: 'A' }), new DummyView({ title: 'B' })],
        });

        let received = null;
        split.on('layoutChange', (event) => {
            received = event;
        });

        split.attachTo(container);

        assert.ok(received instanceof AppEvent);
        assert.equal(received.name, 'layoutChange');
        assert.equal(received.detail.payloadTypeId, 'SplitView.LayoutChange.v1');
        assert.equal(typeof received.detail.source, 'string');
        assert.ok(Array.isArray(received.detail.ratios));
        assert.equal(received.detail.count, 2);
        assert.equal(received.detail.orientation, 'horizontal');
    });

    it('handles ViewBase.DesiredSize.v1 and emits desiredSize-sourced layout change', () => {
        const left = new DummyView({ title: 'Left' });
        const right = new DummyView({ title: 'Right' });
        const split = new SplitView({ views: [left, right] });

        const received = [];
        split.on('layoutChange', (event) => {
            received.push(event);
        });

        split.attachTo(container);
        split._availableSpan = () => 1000;
        left.setDesiredSize({ width: 420, height: null });

        const desiredSizeEvent = [...received]
            .reverse()
            .find((event) => event.detail.source === 'desiredSize');
        assert.ok(desiredSizeEvent instanceof AppEvent);
        assert.equal(desiredSizeEvent.detail.payloadTypeId, 'SplitView.LayoutChange.v1');
    });

    it('throws on incompatible desiredSize event envelope', () => {
        const left = new DummyView({ title: 'Left' });
        const right = new DummyView({ title: 'Right' });
        const split = new SplitView({ views: [left, right] });

        assert.throws(() => {
            split._handleDesiredSize(left, 0, { detail: { width: 200, height: null } });
        }, /expected AppEvent instance/);
    });

    it('re-equalizes flexible panes when the last fixed pane is released', () => {
        const first = new DummyView({ title: 'First' });
        const second = new DummyView({ title: 'Second' });
        const split = new SplitView({ orientation: 'vertical', views: [first, second] });
        split.attachTo(container);
        split._availableSpan = () => 800;

        // Collapse the first pane: it is fixed to its header height while the
        // second pane takes the rest.
        first.setHeightConstraints({ minHeight: 32, maxHeight: 32 });
        assert.ok(
            split._ratios[0] < split._ratios[1],
            'the collapsed pane keeps only its fixed share'
        );

        // Expand it again: released from its fixed height with no other fixed pane.
        first.setHeightConstraints({ minHeight: 32, maxHeight: null });

        assert.deepEqual(split._ratios, [0.5, 0.5], 'the released pane regains an equal share');
    });

    it('publishes the leading content inset to CSS and round-trips it through serialization', () => {
        const split = new SplitView({
            orientation: 'vertical',
            contentInsetStart: 16,
            views: [new DummyView({ title: 'Only' })],
        });
        split.attachTo(container);

        assert.equal(split.contentInsetStart, 16);
        assert.equal(split.serialize().contentInsetStart, 16);
        assert.equal(
            container.querySelector('.split-view').style.getPropertyValue('--split-inset-start'),
            '16px',
            'the inset is handed to the split-view.css padding rule'
        );

        const restored = SplitView.deserialize(split.serialize(), (entry) =>
            ViewBase.deserialize(entry)
        );
        assert.equal(restored.contentInsetStart, 16);
    });

    it('publishes the block-start content inset to CSS and round-trips it through serialization', () => {
        const split = new SplitView({
            orientation: 'vertical',
            contentInsetTop: 4,
            views: [new DummyView({ title: 'Only' })],
        });
        split.attachTo(container);

        assert.equal(split.contentInsetTop, 4);
        assert.equal(split.serialize().contentInsetTop, 4);
        assert.equal(
            container.querySelector('.split-view').style.getPropertyValue('--split-inset-top'),
            '4px',
            'the inset is handed to the split-view.css block-start padding rule'
        );

        const restored = SplitView.deserialize(split.serialize(), (entry) =>
            ViewBase.deserialize(entry)
        );
        assert.equal(restored.contentInsetTop, 4);
    });

    it('clamps a negative or non-finite block-start inset to zero', () => {
        const split = new SplitView({
            contentInsetTop: -8,
            views: [new DummyView({ title: 'Only' })],
        });
        const splitWithNaN = new SplitView({
            contentInsetTop: Number.NaN,
            views: [new DummyView({ title: 'Other' })],
        });

        assert.equal(split.contentInsetTop, 0);
        assert.equal(splitWithNaN.contentInsetTop, 0);

        split.attachTo(container);
        assert.equal(
            container.querySelector('.split-view').style.getPropertyValue('--split-inset-top'),
            ''
        );
    });

    it('clamps a negative or non-finite content inset to zero', () => {
        const split = new SplitView({
            contentInsetStart: -8,
            views: [new DummyView({ title: 'Only' })],
        });
        const splitWithNaN = new SplitView({
            contentInsetStart: Number.NaN,
            views: [new DummyView({ title: 'Other' })],
        });

        assert.equal(split.contentInsetStart, 0);
        assert.equal(splitWithNaN.contentInsetStart, 0);

        split.attachTo(container);
        assert.equal(
            container.querySelector('.split-view').style.getPropertyValue('--split-inset-start'),
            ''
        );
    });

    it('publishes the inset guide as a host class and round-trips it through serialization', () => {
        const withGuide = new SplitView({
            orientation: 'vertical',
            contentInsetStart: 16,
            contentInsetGuide: true,
            views: [new DummyView({ title: 'Only' })],
        });
        withGuide.attachTo(container);

        assert.equal(withGuide.contentInsetGuide, true);
        assert.equal(withGuide.serialize().contentInsetGuide, true);
        assert.ok(
            container.querySelector('.split-view').classList.contains('split-view--inset-guide'),
            'the guide is handed to the split-view.css ::before rule'
        );

        const restored = SplitView.deserialize(withGuide.serialize(), (entry) =>
            ViewBase.deserialize(entry)
        );
        assert.equal(restored.contentInsetGuide, true);

        const withoutGuide = new SplitView({
            orientation: 'vertical',
            contentInsetStart: 16,
            views: [new DummyView({ title: 'Other' })],
        });
        withoutGuide.attachTo(container);
        assert.equal(withoutGuide.contentInsetGuide, false);
        assert.equal(withoutGuide.serialize().contentInsetGuide, false);
    });
});
