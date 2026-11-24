import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { ViewBase } from '../../src/micro_otter/nodes/html/js/views/view-base.js';
import { OverlayWindow } from '../../src/micro_otter/nodes/html/js/views/overlay-window.js';
import { AppEvent, AppPayload } from '../../src/micro_otter/nodes/html/js/core/app-event.js';

class DummyView extends ViewBase {
    render(container) {
        const el = document.createElement('div');
        el.className = 'dummy-view';
        container.replaceChildren(el);
    }
}

class TestPayload extends AppPayload {
    constructor() {
        super('Test.Payload.v1');
    }
}

describe('ViewBase and OverlayWindow event contracts', () => {
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
        global.Node = window.Node;
        global.EventTarget = window.EventTarget;
        global.CustomEvent = window.CustomEvent;

        container = document.createElement('div');
        container.style.width = '1000px';
        container.style.height = '700px';
        document.body.appendChild(container);
    });

    afterEach(() => {
        if (container && container.parentNode) {
            container.parentNode.removeChild(container);
        }
        delete global.window;
        delete global.document;
        delete global.HTMLElement;
        delete global.Node;
        delete global.EventTarget;
        delete global.CustomEvent;
    });

    it('emits ViewBase attach and desiredSize as AppEvent envelopes', () => {
        const view = new DummyView({ title: 'View Contract Test' });

        let attachEvent = null;
        let desiredSizeEvent = null;
        view.on('attach', (event) => {
            attachEvent = event;
        });
        view.on('desiredSize', (event) => {
            desiredSizeEvent = event;
        });

        view.attachTo(container);
        view.setDesiredSize({ width: 360, height: null });

        assert.ok(attachEvent instanceof AppEvent);
        assert.equal(attachEvent.name, 'attach');
        assert.equal(attachEvent.detail.payloadTypeId, 'ViewBase.Attach.v1');
        assert.equal(attachEvent.detail.container, container);

        assert.ok(desiredSizeEvent instanceof AppEvent);
        assert.equal(desiredSizeEvent.name, 'desiredSize');
        assert.equal(desiredSizeEvent.detail.payloadTypeId, 'ViewBase.DesiredSize.v1');
        assert.equal(desiredSizeEvent.detail.width, 360);
        assert.equal(desiredSizeEvent.detail.height, null);
    });

    it('rejects pre-wrapped AppEvent input in ViewBase._emit', () => {
        const view = new DummyView({ title: 'View Contract Test' });
        view.on('attach', () => {});

        assert.throws(() => {
            view._emit('attach', new AppEvent('attach', new TestPayload()));
        }, /expects a payload instance, not AppEvent/);
    });

    it('rejects non-AppPayload input in ViewBase._emit', () => {
        const view = new DummyView({ title: 'View Contract Test' });
        view.on('attach', () => {});

        assert.throws(() => {
            view._emit('attach', { container });
        }, /expects payload to be an AppPayload instance/);
    });

    it('emits OverlayWindow move and resize as AppEvent envelopes', () => {
        const hosted = new DummyView({ title: 'Hosted View' });
        const overlay = new OverlayWindow({
            view: hosted,
            width: 320,
            height: 200,
            x: 48,
            y: 64,
        });

        let moveEvent = null;
        let resizeEvent = null;
        overlay.on('move', (event) => {
            moveEvent = event;
        });
        overlay.on('resize', (event) => {
            resizeEvent = event;
        });

        overlay.attachTo(container);

        assert.ok(moveEvent instanceof AppEvent);
        assert.equal(moveEvent.name, 'move');
        assert.equal(moveEvent.detail.payloadTypeId, 'OverlayWindow.Move.v1');
        assert.equal(typeof moveEvent.detail.x, 'number');
        assert.equal(typeof moveEvent.detail.y, 'number');

        assert.ok(resizeEvent instanceof AppEvent);
        assert.equal(resizeEvent.name, 'resize');
        assert.equal(resizeEvent.detail.payloadTypeId, 'OverlayWindow.Resize.v1');
        assert.equal(typeof resizeEvent.detail.width, 'number');
        assert.equal(typeof resizeEvent.detail.height, 'number');
    });

    it('rejects non-AppPayload input in OverlayWindow._emit', () => {
        const hosted = new DummyView({ title: 'Hosted View' });
        const overlay = new OverlayWindow({ view: hosted });
        overlay.on('close', () => {});

        assert.throws(() => {
            overlay._emit('close', { reason: 'close' });
        }, /expects payload to be an AppPayload instance/);
    });

    it('closes on outside mousedown when closeOnOutsideClick is enabled', async () => {
        const hosted = new DummyView({ title: 'Hosted View' });
        const overlay = new OverlayWindow({
            view: hosted,
            closeOnOutsideClick: true,
            x: 48,
            y: 64,
            width: 320,
            height: 200,
        });

        let closeEvent = null;
        overlay.on('close', (event) => {
            closeEvent = event;
        });

        overlay.attachTo(container);

        // Wait for the deferred document listener registration.
        await new Promise((resolve) => setTimeout(resolve, 0));

        const outside = document.createElement('div');
        document.body.appendChild(outside);
        outside.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));

        assert.ok(closeEvent);
        assert.equal(closeEvent.name, 'close');
        assert.equal(closeEvent.detail.payloadTypeId, 'OverlayWindow.Close.v1');

        outside.remove();
    });
});
