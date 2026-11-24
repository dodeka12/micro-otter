import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { ToolbarView } from '../../src/micro_otter/nodes/html/js/views/toolbar-view.js';

describe('ToolbarView layout modes', () => {
    let dom;
    let container;

    const createIcon = () => {
        const icon = document.createElement('span');
        icon.textContent = 'i';
        return icon;
    };

    beforeEach(() => {
        dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
            url: 'http://localhost',
        });

        global.window = dom.window;
        global.document = dom.window.document;
        global.HTMLElement = dom.window.HTMLElement;

        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        global.window = undefined;
        global.document = undefined;
        global.HTMLElement = undefined;
        dom.window.close();
    });

    test('uses multi-line mode by default with fixed height constraints', () => {
        const toolbar = new ToolbarView({ height: 40 });
        toolbar.attachTo(container);

        const root = container.querySelector('.view-toolbar');
        const controls = container.querySelector('.view-toolbar__controls');

        assert.ok(root.classList.contains('view-toolbar--multi-line'));
        assert.ok(!root.classList.contains('view-toolbar--scroll'));
        assert.ok(controls.classList.contains('view-toolbar__controls--multi-line'));
        assert.strictEqual(toolbar.layoutMode, 'multi-line');
        assert.strictEqual(toolbar.minHeight, 40);
        assert.strictEqual(toolbar.maxHeight, 40);
    });

    test('keeps multi-line mode fixed while adapting height to measured content', () => {
        const toolbar = new ToolbarView({ layoutMode: 'multi-line', height: 36 });
        toolbar.attachTo(container);

        const root = container.querySelector('.view-toolbar');
        Object.defineProperty(root, 'scrollHeight', {
            configurable: true,
            get: () => 88,
        });

        toolbar.onResized({ width: 200, height: 36 });

        assert.strictEqual(toolbar.minHeight, 88);
        assert.strictEqual(toolbar.maxHeight, 88);
    });

    test('renders multi-line mode with separator-preferred grouping', () => {
        const toolbar = new ToolbarView({ layoutMode: 'multi-line' });

        toolbar.addButton({ icon: createIcon(), label: 'A', onClick: () => {} });
        toolbar.addSeparator();
        toolbar.addButton({ icon: createIcon(), label: 'B', onClick: () => {} });
        toolbar.addButton({ icon: createIcon(), label: 'C', onClick: () => {} });
        toolbar.addSeparator();
        toolbar.addButton({ icon: createIcon(), label: 'D', onClick: () => {} });

        toolbar.attachTo(container);

        const root = container.querySelector('.view-toolbar');
        const controls = container.querySelector('.view-toolbar__controls');
        const groups = Array.from(container.querySelectorAll('.view-toolbar__group'));
        const separators = container.querySelectorAll('.view-toolbar__separator');

        assert.ok(root.classList.contains('view-toolbar--multi-line'));
        assert.ok(controls.classList.contains('view-toolbar__controls--multi-line'));
        assert.strictEqual(toolbar.layoutMode, 'multi-line');
        assert.strictEqual(toolbar.maxHeight, 36);

        assert.strictEqual(groups.length, 3);
        assert.strictEqual(groups[0].querySelectorAll('.view-toolbar__btn').length, 1);
        assert.strictEqual(groups[1].querySelectorAll('.view-toolbar__btn').length, 2);
        assert.strictEqual(groups[2].querySelectorAll('.view-toolbar__btn').length, 1);
        assert.strictEqual(separators.length, 0);
    });

    test('renders separators in scroll mode', () => {
        const toolbar = new ToolbarView({ layoutMode: 'scroll' });

        toolbar.addButton({ icon: createIcon(), label: 'A', onClick: () => {} });
        toolbar.addSeparator();
        toolbar.addButton({ icon: createIcon(), label: 'B', onClick: () => {} });

        toolbar.attachTo(container);

        const separators = container.querySelectorAll('.view-toolbar__separator');
        assert.strictEqual(separators.length, 1);
    });

    test('serializes and deserializes layout mode', () => {
        const toolbar = new ToolbarView({ title: 'T', height: 44, layoutMode: 'multi-line' });

        const data = toolbar.serialize();
        assert.strictEqual(data.layoutMode, 'multi-line');
        assert.strictEqual(data.height, 44);

        const restored = ToolbarView.deserialize(data);
        assert.strictEqual(restored.layoutMode, 'multi-line');
        assert.strictEqual(restored.minHeight, 44);
        assert.strictEqual(restored.maxHeight, 44);
    });

    test('switches mode at runtime and re-renders controls', () => {
        const toolbar = new ToolbarView({ layoutMode: 'scroll' });

        toolbar.addButton({ icon: createIcon(), label: 'A', onClick: () => {} });
        toolbar.addSeparator();
        toolbar.addButton({ icon: createIcon(), label: 'B', onClick: () => {} });

        toolbar.attachTo(container);
        toolbar.setLayoutMode('multi-line');

        assert.strictEqual(toolbar.layoutMode, 'multi-line');
        assert.strictEqual(container.querySelectorAll('.view-toolbar__group').length, 2);
        assert.strictEqual(container.querySelectorAll('.view-toolbar__separator').length, 0);
    });

    describe('addControl', () => {
        const createControl = (onRender = () => {}) => {
            const control = {
                renderCalls: [],
                render(target) {
                    onRender(target);
                    this.renderCalls.push(target);
                    const element = document.createElement('span');
                    element.className = 'stub-control';
                    target.appendChild(element);
                },
            };
            return control;
        };

        test('wraps a self-rendering control in a default host', () => {
            const toolbar = new ToolbarView({ layoutMode: 'scroll' });
            const control = createControl();

            const host = toolbar.addControl(control);
            toolbar.attachTo(container);

            assert.strictEqual(host.className, 'view-toolbar__control');
            assert.ok(host.querySelector('.stub-control'));
            assert.strictEqual(control.renderCalls[0], host);

            const controls = container.querySelector('.view-toolbar__controls');
            assert.ok(controls.querySelector('.view-toolbar__control'));
        });

        test('applies a custom host class verbatim', () => {
            const toolbar = new ToolbarView({ layoutMode: 'scroll' });
            const host = toolbar.addControl(createControl(), { className: 'custom-host' });

            toolbar.attachTo(container);

            assert.strictEqual(host.className, 'custom-host');
            assert.ok(container.querySelector('.view-toolbar__controls .custom-host'));
        });

        test('calls destroy exactly once when controls are cleared', () => {
            const toolbar = new ToolbarView({ layoutMode: 'scroll' });
            let destroyCalls = 0;
            const control = createControl();
            control.destroy = () => {
                destroyCalls += 1;
            };

            toolbar.addControl(control);
            toolbar.attachTo(container);

            toolbar.clearControls();

            assert.strictEqual(destroyCalls, 1);
            assert.strictEqual(container.querySelectorAll('.custom-host').length, 0);
            assert.strictEqual(container.querySelectorAll('.view-toolbar__control').length, 0);
        });

        test('tolerates a control without destroy', () => {
            const toolbar = new ToolbarView({ layoutMode: 'scroll' });
            toolbar.addControl(createControl());
            toolbar.attachTo(container);

            assert.doesNotThrow(() => toolbar.clearControls());
            assert.strictEqual(container.querySelectorAll('.view-toolbar__control').length, 0);
        });
    });
});

describe('ToolbarView control spacing', () => {
    const stylesheetPath = path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        '..',
        '..',
        'src',
        'micro_otter',
        'nodes',
        'html',
        'styles',
        'standard',
        'toolbar-view.css'
    );

    /**
     * Returns the declaration block of the first rule matching *selector*.
     * @param {string} css Stylesheet text to search.
     * @param {string} selector Selector whose declaration block is read.
     * @returns {string|null} The declaration block, or null when the rule is absent.
     */
    function ruleBody(css, selector) {
        const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
        return match ? match[1] : null;
    }

    test('pads checkbox controls horizontally so they clear their neighbour', () => {
        const body = ruleBody(
            readFileSync(stylesheetPath, 'utf8'),
            '.view-toolbar__controls .custom-control--checkbox'
        );
        assert.ok(body, 'missing the toolbar checkbox spacing rule');

        const padding = body.match(/(?:^|[;{\s])padding\s*:\s*([^;]+);/);
        assert.ok(padding, 'the checkbox spacing rule must declare padding');

        const values = padding[1].trim().split(/\s+/);
        assert.strictEqual(values.length, 2, 'expected vertical and horizontal padding only');
        assert.strictEqual(values[0], '0', 'vertical padding must stay 0 to keep the row height');
        assert.ok(
            parseFloat(values[1]) >= 6,
            `horizontal padding ${values[1]} is too small to separate a checkbox from a button`
        );
    });
});
