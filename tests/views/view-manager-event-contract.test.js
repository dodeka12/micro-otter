import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { ViewManager } from '../../src/micro_otter/nodes/html/js/views/view-manager.js';
import { ViewBase } from '../../src/micro_otter/nodes/html/js/views/view-base.js';
import { AppPayload } from '../../src/micro_otter/nodes/html/js/core/app-event.js';

class TestClosePayload extends AppPayload {
    constructor() {
        super('TestModal.Close.v1');
    }
}

class TestModalView extends ViewBase {
    render(container) {
        container.replaceChildren(document.createElement('div'));
    }

    emitClose() {
        this._emit('close', new TestClosePayload());
    }
}

class InterceptModalView extends ViewBase {
    constructor() {
        super({ title: 'Intercept Modal' });
        this.closeHandler = null;
    }

    render(container) {
        container.replaceChildren(document.createElement('div'));
    }

    on(event, handler) {
        if (event === 'close') {
            this.closeHandler = handler;
        }
        return () => {};
    }
}

describe('ViewManager showModal event contract', () => {
    let dom;
    let document;
    let window;
    let mount;

    beforeEach(() => {
        dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
            url: 'http://localhost',
        });
        window = dom.window;
        document = window.document;

        global.window = window;
        global.document = document;
        global.HTMLElement = window.HTMLElement;
        global.CustomEvent = window.CustomEvent;

        mount = document.createElement('div');
        document.body.appendChild(mount);
    });

    afterEach(() => {
        if (mount && mount.parentNode) {
            mount.parentNode.removeChild(mount);
        }
        delete global.window;
        delete global.document;
        delete global.HTMLElement;
        delete global.CustomEvent;
    });

    it('auto-clears modal when close AppEvent is emitted', () => {
        const manager = new ViewManager({ mount, themeRegistry: { setTheme: () => 'sandbox', currentTheme: 'sandbox', events: new EventTarget(), load: async () => {}, applyThemeStyles: () => 'sandbox' } });
        const modal = new TestModalView({ title: 'Modal' });

        manager.showModal(modal);
        assert.equal(manager.modalLayer.style.display, 'block');

        modal.emitClose();

        assert.equal(manager.modalLayer.style.display, 'none');
    });

    it('throws when showModal close listener receives non-AppEvent payload', () => {
        const manager = new ViewManager({ mount, themeRegistry: { setTheme: () => 'sandbox', currentTheme: 'sandbox', events: new EventTarget(), load: async () => {}, applyThemeStyles: () => 'sandbox' } });
        const modal = new InterceptModalView();

        manager.showModal(modal);

        assert.ok(typeof modal.closeHandler === 'function');
        assert.throws(() => {
            modal.closeHandler({});
        }, /expected AppEvent instance/);
    });
});
