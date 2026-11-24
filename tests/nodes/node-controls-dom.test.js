import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { createDomHarness } from '../helpers/dom-harness.js';
import {
    NumberControlUi,
    TextControlUi,
    CheckboxControlUi,
    NodeDropdownControlUi,
    SliderControlUi,
    ColorControlUi,
    IconControlUi,
    clampNumericControlValue,
} from '../../src/micro_otter/nodes/html/js/nodes/controls/index.js';
import { resetMdiIconIndexCache } from '../../src/micro_otter/nodes/html/js/data/mdi-icons.js';

/**
 * Minimal MDI index standing in for the generated `vendor/mdi/icon-index.json`:
 * enough entries to exercise name, prefix and alias ranking.
 */
const ICON_INDEX_FIXTURE = {
    version: '7.4.47',
    icons: {
        account: 'F0004',
        lightbulb: 'F0335',
        thermometer: 'F050F',
        'thermometer-lines': 'F10A2',
        'weather-sunny': 'F0599',
    },
    aliases: {
        temperature: 'thermometer',
        user: 'account',
    },
};

function createNodeState(initialValues = {}) {
    return {
        controlValues: { ...initialValues },
    };
}

function createNodeUi(changeLog, hiddenEditorCounter) {
    return {
        onControlChanged(id, newValue, oldValue) {
            changeLog.push({ id, newValue, oldValue });
        },
        hideEditor() {
            hiddenEditorCounter.count += 1;
        },
    };
}

describe('Node controls DOM behavior migration', () => {
    let harness;

    beforeEach(() => {
        harness = createDomHarness();
    });

    afterEach(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        harness.cleanup();
    });

    it('renders number editor with constraints and emits deterministic value changes', () => {
        const changeLog = [];
        const hiddenEditorCounter = { count: 0 };
        const nodeData = createNodeState();
        const nodeUi = createNodeUi(changeLog, hiddenEditorCounter);

        const control = new NumberControlUi(
            {
                id: 'gain',
                type: 'number',
                label: 'Gain',
                default: 50,
                constraints: { min: 0, max: 100, step: 5 },
            },
            nodeData,
            nodeUi
        );

        const element = control.renderDOM(document.body);
        const input = element.querySelector('input[type="number"]');

        assert.ok(input);
        assert.equal(input.min, '0');
        assert.equal(input.max, '100');
        assert.equal(input.step, '5');
        assert.equal(input.value, '50');

        input.value = '75';
        input.dispatchEvent(new harness.window.Event('input', { bubbles: true }));

        assert.equal(nodeData.controlValues.gain, 75);
        assert.equal(changeLog.length, 1);
        assert.deepEqual(changeLog[0], {
            id: 'gain',
            newValue: 75,
            oldValue: undefined,
        });

        input.dispatchEvent(new harness.window.Event('blur', { bubbles: true }));
        assert.equal(hiddenEditorCounter.count, 1);
    });

    it('reads min/max/step from the node-definition shape and clamps on close', () => {
        const changeLog = [];
        const hiddenEditorCounter = { count: 0 };
        const nodeData = createNodeState({ refreshIntervalMs: 1000 });
        const nodeUi = createNodeUi(changeLog, hiddenEditorCounter);

        const control = new NumberControlUi(
            {
                id: 'refreshIntervalMs',
                type: 'number',
                label: 'Refresh (ms)',
                default: 1000,
                min: 100,
                max: 60000,
                step: 100,
            },
            nodeData,
            nodeUi
        );

        const element = control.renderDOM(document.body);
        const input = element.querySelector('input[type="number"]');

        // Node definitions carry min/max/step at the top level of the control; the editor
        // must read them there instead of only from a nested `constraints` object.
        assert.equal(input.min, '100');
        assert.equal(input.max, '60000');
        assert.equal(input.step, '100');

        input.value = '5';
        input.dispatchEvent(new harness.window.Event('input', { bubbles: true }));

        // The stored value stays in range even before the editor closes: a click-away
        // removes the input without firing blur.
        assert.equal(nodeData.controlValues.refreshIntervalMs, 100);

        input.dispatchEvent(new harness.window.Event('blur', { bubbles: true }));

        assert.equal(nodeData.controlValues.refreshIntervalMs, 100);
        assert.equal(input.value, '100');
        assert.equal(hiddenEditorCounter.count, 1);
        assert.deepEqual(changeLog.at(-1), {
            id: 'refreshIntervalMs',
            newValue: 100,
            oldValue: 100,
        });
    });

    it('clamps an over-max number committed with Enter', () => {
        const changeLog = [];
        const hiddenEditorCounter = { count: 0 };
        const nodeData = createNodeState();
        const nodeUi = createNodeUi(changeLog, hiddenEditorCounter);

        const control = new NumberControlUi(
            {
                id: 'refreshIntervalMs',
                type: 'number',
                label: 'Refresh (ms)',
                default: 1000,
                min: 100,
                max: 60000,
                step: 100,
            },
            nodeData,
            nodeUi
        );

        const element = control.renderDOM(document.body);
        const input = element.querySelector('input[type="number"]');

        input.value = '70000';
        input.dispatchEvent(
            new harness.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
        );

        assert.equal(nodeData.controlValues.refreshIntervalMs, 60000);
        assert.equal(input.value, '60000');
        assert.equal(hiddenEditorCounter.count, 1);
        assert.deepEqual(changeLog.at(-1), {
            id: 'refreshIntervalMs',
            newValue: 60000,
            oldValue: undefined,
        });
    });

    it('renders text editor and closes on Enter via public hideEditor contract', () => {
        const changeLog = [];
        const hiddenEditorCounter = { count: 0 };
        const nodeData = createNodeState({ message: 'hello' });
        const nodeUi = createNodeUi(changeLog, hiddenEditorCounter);

        const control = new TextControlUi(
            {
                id: 'message',
                type: 'text',
                label: 'Message',
                default: 'fallback',
            },
            nodeData,
            nodeUi
        );

        const element = control.renderDOM(document.body);
        const input = element.querySelector('input[type="text"]');

        assert.ok(input);
        assert.equal(input.value, 'hello');

        input.value = 'world';
        input.dispatchEvent(new harness.window.Event('input', { bubbles: true }));

        assert.equal(nodeData.controlValues.message, 'world');
        assert.equal(changeLog.length, 1);
        assert.deepEqual(changeLog[0], {
            id: 'message',
            newValue: 'world',
            oldValue: 'hello',
        });

        input.dispatchEvent(
            new harness.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
        );
        assert.equal(hiddenEditorCounter.count, 1);
    });

    it('renders localized control label for active i18n locale', () => {
        const changeLog = [];
        const hiddenEditorCounter = { count: 0 };
        const nodeData = createNodeState();
        const nodeUi = {
            ...createNodeUi(changeLog, hiddenEditorCounter),
            _i18nService: { currentLocale: 'de' },
        };

        const control = new TextControlUi(
            {
                id: 'message',
                type: 'text',
                label: { en: 'Message', de: 'Nachricht' },
                default: '',
            },
            nodeData,
            nodeUi
        );

        const element = control.renderDOM(document.body);
        const label = element.querySelector('label');

        assert.ok(label);
        assert.equal(label.textContent, 'Nachricht');
    });

    it('toggles checkbox value immediately through renderDOM', () => {
        const changeLog = [];
        const hiddenEditorCounter = { count: 0 };
        const nodeData = createNodeState({ enabled: true });
        const nodeUi = createNodeUi(changeLog, hiddenEditorCounter);

        const control = new CheckboxControlUi(
            {
                id: 'enabled',
                type: 'checkbox',
                label: 'Enabled',
                default: false,
            },
            nodeData,
            nodeUi
        );

        const element = control.renderDOM(document.body);

        assert.equal(element.style.display, 'none');
        assert.equal(nodeData.controlValues.enabled, false);
        assert.equal(changeLog.length, 1);
        assert.deepEqual(changeLog[0], {
            id: 'enabled',
            newValue: false,
            oldValue: true,
        });
        assert.equal(hiddenEditorCounter.count, 0);
    });

    it('renders dropdown options and emits selected value changes', async () => {
        const changeLog = [];
        const hiddenEditorCounter = { count: 0 };
        const nodeData = createNodeState({ mode: 'add' });
        const nodeUi = createNodeUi(changeLog, hiddenEditorCounter);

        const control = new NodeDropdownControlUi(
            {
                id: 'mode',
                type: 'dropdown',
                label: 'Mode',
                default: 'add',
                options: [
                    { value: 'add', label: 'Add' },
                    { value: 'subtract', label: 'Subtract' },
                    { value: 'multiply', label: 'Multiply' },
                ],
            },
            nodeData,
            nodeUi
        );

        const element = control.renderDOM(document.body);
        const trigger = element.querySelector('.node-control-ui__dropdown-trigger');
        const options = element.querySelectorAll('.node-control-ui__dropdown-option');

        assert.ok(trigger);
        assert.equal(options.length, 3);
        assert.equal(
            trigger.querySelector('.node-control-ui__dropdown-trigger-label').textContent,
            'Add'
        );
        assert.equal(options[0].textContent, 'Add');

        options[2].dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));

        assert.equal(nodeData.controlValues.mode, 'multiply');
        assert.equal(changeLog.length, 1);
        assert.deepEqual(changeLog[0], {
            id: 'mode',
            newValue: 'multiply',
            oldValue: 'add',
        });

        trigger.dispatchEvent(
            new harness.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
        );
        await new Promise((resolve) => setTimeout(resolve, 20));
        assert.equal(hiddenEditorCounter.count, 1);
    });

    it('preserves typed boolean values for dropdown options', () => {
        const changeLog = [];
        const hiddenEditorCounter = { count: 0 };
        const nodeData = createNodeState({ flag: false });
        const nodeUi = createNodeUi(changeLog, hiddenEditorCounter);

        const control = new NodeDropdownControlUi(
            {
                id: 'flag',
                type: 'dropdown',
                label: 'Flag',
                default: false,
                options: [
                    { value: true, label: 'True' },
                    { value: false, label: 'False' },
                ],
            },
            nodeData,
            nodeUi
        );

        const element = control.renderDOM(document.body);
        const trigger = element.querySelector('.node-control-ui__dropdown-trigger');
        const options = element.querySelectorAll('.node-control-ui__dropdown-option');

        assert.ok(trigger);
        assert.equal(
            trigger.querySelector('.node-control-ui__dropdown-trigger-label').textContent,
            'False'
        );

        options[0].dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));

        assert.equal(nodeData.controlValues.flag, true);
        assert.equal(typeof nodeData.controlValues.flag, 'boolean');
        assert.equal(changeLog.at(-1).newValue, true);
    });

    it('toggles several options of a multi-dropdown and keeps the editor open', () => {
        const changeLog = [];
        const hiddenEditorCounter = { count: 0 };
        const nodeData = createNodeState({ flags: ['heating'] });
        const nodeUi = createNodeUi(changeLog, hiddenEditorCounter);

        const control = new NodeDropdownControlUi(
            {
                id: 'flags',
                type: 'multi-dropdown',
                label: 'Available Flags',
                default: [],
                options: [
                    { value: 'heating', label: 'heating' },
                    { value: 'pump', label: 'pump' },
                ],
            },
            nodeData,
            nodeUi
        );

        assert.equal(control.closeOnChange, false);

        const element = control.renderDOM(document.body);
        const trigger = element.querySelector('.node-control-ui__dropdown-trigger');
        const options = element.querySelectorAll('.node-control-ui__dropdown-option');
        const tickOf = (index) =>
            options[index].querySelector('.node-control-ui__dropdown-option-tick').textContent;

        assert.equal(
            trigger.querySelector('.node-control-ui__dropdown-trigger-label').textContent,
            'heating'
        );
        assert.equal(tickOf(0), '\u2611');
        assert.equal(tickOf(1), '\u2610');
        // The tick is separated from the label by a real element.
        assert.equal(options[1].querySelectorAll('span')[1].textContent, 'pump');

        options[1].dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));

        assert.deepEqual(nodeData.controlValues.flags, ['heating', 'pump']);
        assert.deepEqual(changeLog.at(-1), {
            id: 'flags',
            newValue: ['heating', 'pump'],
            oldValue: ['heating'],
        });
        assert.equal(tickOf(1), '\u2611');
        assert.equal(
            trigger.querySelector('.node-control-ui__dropdown-trigger-label').textContent,
            'heating, pump'
        );
        assert.equal(hiddenEditorCounter.count, 0);

        options[0].dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));

        assert.deepEqual(nodeData.controlValues.flags, ['pump']);
        assert.equal(tickOf(0), '\u2610');
        assert.equal(
            trigger.querySelector('.node-control-ui__dropdown-trigger-label').textContent,
            'pump'
        );
    });

    it('renders a disabled dropdown that does not emit changes', () => {
        const changeLog = [];
        const hiddenEditorCounter = { count: 0 };
        const nodeData = createNodeState({ mode: 'a' });
        const nodeUi = createNodeUi(changeLog, hiddenEditorCounter);

        const control = new NodeDropdownControlUi(
            {
                id: 'mode',
                type: 'dropdown',
                label: 'Mode',
                default: 'a',
                disabled: true,
                options: [{ value: 'a', label: 'A' }],
            },
            nodeData,
            nodeUi
        );

        const element = control.renderDOM(document.body);
        const trigger = element.querySelector('.node-control-ui__dropdown-trigger');
        const options = element.querySelectorAll('.node-control-ui__dropdown-option');

        assert.ok(trigger);
        assert.equal(trigger.disabled, true);

        options[0].dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
        assert.equal(changeLog.length, 0);
    });

    it('caps the dropdown menu height when options exceed maxVisibleItems', () => {
        const nodeData = createNodeState({ pin: 1 });
        const nodeUi = createNodeUi([], { count: 0 });
        const options = Array.from({ length: 10 }, (_, index) => ({
            value: index + 1,
            label: String(index + 1),
        }));

        const control = new NodeDropdownControlUi(
            {
                id: 'pin',
                type: 'dropdown',
                label: 'Pin',
                default: 1,
                maxVisibleItems: 5,
                options,
            },
            nodeData,
            nodeUi
        );

        const element = control.renderDOM(document.body);
        const menu = element.querySelector('.node-control-ui__dropdown-menu');

        assert.ok(menu);
        assert.equal(element.querySelectorAll('.node-control-ui__dropdown-option').length, 10);
        assert.equal(menu.style.overflowY, 'auto');
        assert.equal(menu.style.maxHeight, '130px');
    });

    it('opens the dropdown menu automatically after render', async () => {
        const nodeData = createNodeState({ mode: 'add' });
        const nodeUi = createNodeUi([], { count: 0 });

        const control = new NodeDropdownControlUi(
            {
                id: 'mode',
                type: 'dropdown',
                label: 'Mode',
                default: 'add',
                options: [
                    { value: 'add', label: 'Add' },
                    { value: 'subtract', label: 'Subtract' },
                ],
            },
            nodeData,
            nodeUi
        );

        const element = control.renderDOM(document.body);
        const menu = element.querySelector('.node-control-ui__dropdown-menu');

        assert.ok(menu);
        assert.equal(menu.style.display, 'none');

        await new Promise((resolve) => setTimeout(resolve, 20));
        assert.equal(menu.style.display, 'block');
    });

    it('does not auto-open a disabled dropdown menu', async () => {
        const nodeData = createNodeState({ mode: 'a' });
        const nodeUi = createNodeUi([], { count: 0 });

        const control = new NodeDropdownControlUi(
            {
                id: 'mode',
                type: 'dropdown',
                label: 'Mode',
                default: 'a',
                disabled: true,
                options: [{ value: 'a', label: 'A' }],
            },
            nodeData,
            nodeUi
        );

        const element = control.renderDOM(document.body);
        const menu = element.querySelector('.node-control-ui__dropdown-menu');

        assert.ok(menu);

        await new Promise((resolve) => setTimeout(resolve, 20));
        assert.equal(menu.style.display, 'none');
    });

    it('highlights options on hover and marks the selected option', () => {
        const nodeData = createNodeState({ mode: 'add' });
        const nodeUi = createNodeUi([], { count: 0 });

        const control = new NodeDropdownControlUi(
            {
                id: 'mode',
                type: 'dropdown',
                label: 'Mode',
                default: 'add',
                options: [
                    { value: 'add', label: 'Add' },
                    { value: 'subtract', label: 'Subtract' },
                ],
            },
            nodeData,
            nodeUi
        );

        const element = control.renderDOM(document.body);
        const options = element.querySelectorAll('.node-control-ui__dropdown-option');

        // The currently selected option is marked and highlighted.
        assert.equal(options[0].getAttribute('aria-selected'), 'true');
        assert.equal(options[0].style.backgroundColor, 'rgba(99, 181, 255, 0.2)');
        assert.equal(options[1].hasAttribute('aria-selected'), false);

        // Hovering a non-selected option applies the hover background...
        options[1].dispatchEvent(new harness.window.MouseEvent('mouseenter'));
        assert.equal(options[1].style.backgroundColor, 'rgba(255, 255, 255, 0.08)');

        // ...and leaving restores the original background.
        options[1].dispatchEvent(new harness.window.MouseEvent('mouseleave'));
        assert.equal(options[1].style.backgroundColor, '');

        control.destroy();
    });

    it('does not accumulate document-level listeners across reopen cycles', async () => {
        const changeLog = [];
        const nodeData = createNodeState({ mode: 'add' });
        const nodeUi = createNodeUi(changeLog, { count: 0 });

        const control = new NodeDropdownControlUi(
            {
                id: 'mode',
                type: 'dropdown',
                label: 'Mode',
                default: 'add',
                options: [
                    { value: 'add', label: 'Add' },
                    { value: 'subtract', label: 'Subtract' },
                ],
            },
            nodeData,
            nodeUi
        );

        const mousedownHandlers = new Set();
        const originalAdd = document.addEventListener.bind(document);
        const originalRemove = document.removeEventListener.bind(document);
        document.addEventListener = (type, handler, options) => {
            if (type === 'mousedown') mousedownHandlers.add(handler);
            return originalAdd(type, handler, options);
        };
        document.removeEventListener = (type, handler, options) => {
            if (type === 'mousedown') mousedownHandlers.delete(handler);
            return originalRemove(type, handler, options);
        };

        try {
            const firstEditor = control.renderDOM(document.body);
            await new Promise((resolve) => setTimeout(resolve, 20));
            assert.equal(mousedownHandlers.size, 1);

            // Selecting an option closes the menu and removes its listener.
            const firstOptions = firstEditor.querySelectorAll('.node-control-ui__dropdown-option');
            firstOptions[1].dispatchEvent(
                new harness.window.MouseEvent('click', { bubbles: true })
            );
            assert.equal(changeLog.at(-1).newValue, 'subtract');
            assert.equal(mousedownHandlers.size, 0);

            // Reopening re-renders and attaches exactly one listener again.
            const secondEditor = control.renderDOM(document.body);
            await new Promise((resolve) => setTimeout(resolve, 20));
            assert.equal(mousedownHandlers.size, 1);

            // A different option can still be selected after reopening.
            const secondOptions = secondEditor.querySelectorAll(
                '.node-control-ui__dropdown-option'
            );
            secondOptions[0].dispatchEvent(
                new harness.window.MouseEvent('click', { bubbles: true })
            );
            assert.equal(changeLog.at(-1).newValue, 'add');
            assert.equal(mousedownHandlers.size, 0);
        } finally {
            document.addEventListener = originalAdd;
            document.removeEventListener = originalRemove;
        }
    });

    it('renders slider editor with value display and commits on change', () => {
        const changeLog = [];
        const hiddenEditorCounter = { count: 0 };
        const nodeData = createNodeState({ speed: 50 });
        const nodeUi = createNodeUi(changeLog, hiddenEditorCounter);

        const control = new SliderControlUi(
            {
                id: 'speed',
                type: 'slider',
                label: 'Speed',
                default: 10,
                constraints: { min: 0, max: 100, step: 5 },
            },
            nodeData,
            nodeUi
        );

        const element = control.renderDOM(document.body);
        const slider = element.querySelector('input[type="range"]');
        const valueDisplay = element.querySelector('.node-control-ui__slider-value');

        assert.ok(slider);
        assert.ok(valueDisplay);
        assert.equal(slider.min, '0');
        assert.equal(slider.max, '100');
        assert.equal(slider.step, '5');
        assert.equal(slider.value, '50');
        assert.equal(valueDisplay.textContent, '50');

        slider.value = '35';
        slider.dispatchEvent(new harness.window.Event('input', { bubbles: true }));

        assert.equal(valueDisplay.textContent, '35');
        assert.equal(nodeData.controlValues.speed, 35);

        slider.dispatchEvent(new harness.window.Event('change', { bubbles: true }));
        assert.equal(hiddenEditorCounter.count, 1);
        assert.equal(changeLog.at(-1).newValue, 35);
    });

    it('renders color editor and updates value with alpha channel', () => {
        const nodeData = createNodeState({ color: '#FF5733FF' });
        const nodeUi = createNodeUi([], { count: 0 });

        const control = new ColorControlUi(
            {
                id: 'color',
                type: 'color',
                label: 'Color',
                default: '#112233FF',
            },
            nodeData,
            nodeUi
        );

        const element = control.renderDOM(document.body);
        const colorInput = element.querySelector('input[type="color"]');
        const alphaSlider = element.querySelector('input[type="range"]');
        const alphaDisplay = element.querySelector('.node-control-ui__alpha-display');

        assert.ok(colorInput);
        assert.ok(alphaSlider);
        assert.ok(alphaDisplay);
        assert.equal(colorInput.value.toLowerCase(), '#ff5733');
        assert.equal(alphaSlider.value, '255');

        alphaSlider.value = '128';
        alphaSlider.dispatchEvent(new harness.window.Event('input', { bubbles: true }));

        assert.equal(nodeData.controlValues.color, '#ff573380');
        assert.equal(alphaDisplay.textContent, 'α50%');
    });

    describe('icon control picker', () => {
        const originalFetch = globalThis.fetch;

        beforeEach(() => {
            resetMdiIconIndexCache();
            globalThis.fetch = async () => ({ ok: true, json: async () => ICON_INDEX_FIXTURE });
        });

        afterEach(() => {
            globalThis.fetch = originalFetch;
            resetMdiIconIndexCache();
        });

        function createIconControl(initialValues = {}, t = (key) => key) {
            const changeLog = [];
            const hiddenEditorCounter = { count: 0 };
            const nodeData = createNodeState({ icon: 'mdi:lightbulb', ...initialValues });
            const nodeUi = createNodeUi(changeLog, hiddenEditorCounter);
            const control = new IconControlUi(
                { id: 'icon', type: 'icon', label: 'Icon', default: 'mdi:lightbulb' },
                nodeData,
                nodeUi,
                { t }
            );

            const element = control.renderDOM(document.body);
            const input = element.querySelector('input[type="text"]');

            return { control, element, input, nodeData, changeLog, hiddenEditorCounter };
        }

        function tileLabels(element) {
            return [...element.querySelectorAll('.icon-control__tile')].map((tile) =>
                tile.getAttribute('aria-label')
            );
        }

        function dispatchKey(input, key) {
            input.dispatchEvent(
                new harness.window.KeyboardEvent('keydown', { key, bubbles: true })
            );
        }

        function dispatchInput(input, value) {
            input.value = value;
            input.dispatchEvent(new harness.window.Event('input', { bubbles: true }));
        }

        async function flushPendingLoads() {
            await new Promise((resolve) => setTimeout(resolve, 0));
        }

        it('renders a free-text icon input with a hidden picker popover', () => {
            const { element, input } = createIconControl();

            assert.ok(input);
            assert.equal(input.value, 'mdi:lightbulb');
            assert.equal(input.placeholder, 'controls.iconPicker.hint');
            assert.equal(element.classList.contains('icon-control'), true);
            assert.equal(element.querySelector('.icon-control__popover').hidden, true);
            assert.equal(element.querySelectorAll('.icon-control__tile').length, 0);
        });

        it('loads the index on focus and shows the tiles matching the current value', async () => {
            const { control, element, input } = createIconControl();

            input.focus();
            await flushPendingLoads();

            assert.equal(element.querySelector('.icon-control__popover').hidden, false);
            assert.deepEqual(tileLabels(element), ['mdi:lightbulb']);
            assert.ok(
                element.querySelector('.icon-control__tile .icon-control__glyph'),
                'tiles must use the glyph class the stylesheet targets'
            );
            assert.equal(
                element.querySelector('.icon-control__tile').getAttribute('aria-selected'),
                'true'
            );
            assert.equal(control._index.version, '7.4.47');
        });

        it('loads the index once and tracks the viewport only while open', async () => {
            let fetchCount = 0;
            globalThis.fetch = async () => {
                fetchCount += 1;
                return { ok: true, json: async () => ICON_INDEX_FIXTURE };
            };

            const { control, input } = createIconControl();

            input.focus();
            await flushPendingLoads();
            input.blur();
            input.focus();
            await flushPendingLoads();

            assert.equal(fetchCount, 1);
            assert.doesNotThrow(() => {
                harness.window.dispatchEvent(new harness.window.Event('resize'));
            });

            control.destroy();
            assert.equal(control.picker, null, 'the picker is released with the control');

            assert.doesNotThrow(() => {
                harness.window.dispatchEvent(new harness.window.Event('resize'));
            });
        });

        it('filters by name as the user types and keeps the typed text as the value', async () => {
            const { element, input, nodeData } = createIconControl();

            input.focus();
            await flushPendingLoads();

            dispatchInput(input, 'therm');

            assert.deepEqual(tileLabels(element), ['mdi:thermometer', 'mdi:thermometer-lines']);
            assert.match(
                element.querySelector('.icon-control__status').textContent,
                /iconPicker\.count/
            );
            assert.equal(nodeData.controlValues.icon, 'therm');
        });

        it('ranks alias hits and labels them with the canonical name', async () => {
            const { element, input } = createIconControl();

            input.focus();
            await flushPendingLoads();

            dispatchInput(input, 'temperature');

            assert.deepEqual(tileLabels(element), ['mdi:thermometer (alias: temperature)']);
        });

        it('selects a tile, writes the canonical mdi value and keeps the editor open', async () => {
            const { element, input, nodeData, changeLog, hiddenEditorCounter } =
                createIconControl();

            input.focus();
            await flushPendingLoads();

            dispatchInput(input, 'therm');
            const tile = [...element.querySelectorAll('.icon-control__tile')].find(
                (candidate) => candidate.getAttribute('aria-label') === 'mdi:thermometer-lines'
            );
            assert.ok(tile);
            tile.click();

            assert.equal(nodeData.controlValues.icon, 'mdi:thermometer-lines');
            assert.equal(changeLog.at(-1).newValue, 'mdi:thermometer-lines');
            assert.equal(hiddenEditorCounter.count, 0);
            assert.equal(element.querySelector('.icon-control__popover').hidden, false);
            assert.deepEqual(tileLabels(element), ['mdi:thermometer-lines']);
            assert.equal(
                element.querySelector('.icon-control__tile').getAttribute('aria-selected'),
                'true'
            );
        });

        it('takes the tile the arrow keys reached with Enter and closes the editor', async () => {
            const { element, input, nodeData, hiddenEditorCounter } = createIconControl();

            input.focus();
            await flushPendingLoads();

            dispatchInput(input, 'therm');
            dispatchKey(input, 'ArrowDown');
            dispatchKey(input, 'Enter');

            assert.equal(nodeData.controlValues.icon, 'mdi:thermometer-lines');
            assert.equal(hiddenEditorCounter.count, 1);
            assert.equal(element.querySelector('.icon-control__popover').hidden, true);
        });

        it('accepts the typed text with Enter instead of the first match', async () => {
            const { element, input, nodeData, hiddenEditorCounter } = createIconControl();

            input.focus();
            await flushPendingLoads();

            dispatchInput(input, 'therm');
            dispatchKey(input, 'Enter');

            // The grid highlights `mdi:thermometer` by default; Enter must not overwrite the
            // text the user just typed with it.
            assert.equal(nodeData.controlValues.icon, 'therm');
            assert.equal(hiddenEditorCounter.count, 1);
            assert.equal(element.querySelector('.icon-control__popover').hidden, true);
        });

        it('keeps the typed text when the arrow keys cannot move the highlight', async () => {
            const { element, input, nodeData, hiddenEditorCounter } = createIconControl();

            input.focus();
            await flushPendingLoads();

            // A single match: ArrowDown is clamped at index 0, so nothing was chosen.
            dispatchInput(input, 'temperature');
            dispatchKey(input, 'ArrowDown');
            dispatchKey(input, 'ArrowDown');
            dispatchKey(input, 'Enter');

            assert.equal(nodeData.controlValues.icon, 'temperature');
            assert.equal(hiddenEditorCounter.count, 1);
            assert.equal(element.querySelector('.icon-control__popover').hidden, true);
        });

        it('accepts the typed text with Enter before the index has loaded', async () => {
            const { element, input, nodeData, hiddenEditorCounter } = createIconControl();

            dispatchInput(input, 'mdi:home-assistant');
            dispatchKey(input, 'Enter');

            assert.equal(nodeData.controlValues.icon, 'mdi:home-assistant');
            assert.equal(hiddenEditorCounter.count, 1);
            assert.equal(element.querySelector('.icon-control__popover').hidden, true);
        });

        it('clamps arrow navigation at the first and last tile instead of wrapping', async () => {
            const { element, input, nodeData } = createIconControl();

            input.focus();
            await flushPendingLoads();

            dispatchInput(input, 'therm');
            const activeLabels = () =>
                [...element.querySelectorAll('.icon-control__tile')]
                    .filter((tile) => tile.getAttribute('tabindex') === '0')
                    .map((tile) => tile.getAttribute('aria-label'));

            assert.deepEqual(activeLabels(), ['mdi:thermometer']);

            dispatchKey(input, 'ArrowUp');
            assert.deepEqual(activeLabels(), ['mdi:thermometer']);

            dispatchKey(input, 'ArrowDown');
            dispatchKey(input, 'ArrowDown');
            assert.deepEqual(activeLabels(), ['mdi:thermometer-lines']);

            dispatchKey(input, 'Enter');
            assert.equal(nodeData.controlValues.icon, 'mdi:thermometer-lines');
        });

        it('keeps the editor open for in-wrapper focus moves and closes it when focus leaves', async () => {
            const { element, input, nodeData, hiddenEditorCounter } = createIconControl();

            input.focus();
            await flushPendingLoads();

            const clearButton = element.querySelector('.icon-control__clear');
            input.dispatchEvent(
                new harness.window.FocusEvent('blur', { relatedTarget: clearButton })
            );
            assert.equal(hiddenEditorCounter.count, 0);

            const tile = element.querySelector('.icon-control__tile');
            const mouseDown = new harness.window.MouseEvent('mousedown', {
                bubbles: true,
                cancelable: true,
            });
            tile.dispatchEvent(mouseDown);
            assert.equal(mouseDown.defaultPrevented, true);
            assert.equal(hiddenEditorCounter.count, 0);

            input.dispatchEvent(
                new harness.window.FocusEvent('blur', { relatedTarget: document.body })
            );
            assert.equal(hiddenEditorCounter.count, 1);
            assert.equal(nodeData.controlValues.icon, 'mdi:lightbulb');
        });

        it('leaves a foreign icon set untouched and hints nothing about it', async () => {
            const { control, element, input } = createIconControl({ icon: 'ph:thermometer' });

            input.focus();
            await flushPendingLoads();

            assert.equal(element.querySelector('.icon-control__hint').hidden, true);
            assert.deepEqual(tileLabels(element), []);
            assert.equal(control.getValue(), 'ph:thermometer');
            assert.equal(input.value, 'ph:thermometer');
        });

        it('caps the grid at the search limit and reports the truncation', async () => {
            const icons = {};
            for (let index = 0; index < 350; index += 1) {
                icons[`alpha-${String(index).padStart(3, '0')}`] = 'F0000';
            }
            globalThis.fetch = async () => ({
                ok: true,
                json: async () => ({ version: '7.4.47', icons, aliases: {} }),
            });

            const calls = [];
            const { element, input } = createIconControl({ icon: '' }, (key, params) => {
                calls.push({ key, params });
                return key;
            });

            input.focus();
            await flushPendingLoads();

            assert.equal(element.querySelectorAll('.icon-control__tile').length, 300);
            const countCall = calls
                .filter((call) => call.key === 'controls.iconPicker.count')
                .pop();
            assert.deepEqual(countCall.params, { shown: 300, total: 350 });

            const moreButton = element.querySelector('.icon-control__more');
            assert.equal(moreButton.hidden, false);
            const moreCall = calls
                .filter((call) => call.key === 'controls.iconPicker.showMore')
                .pop();
            assert.deepEqual(moreCall.params, { count: 50 });
        });

        it('pages through the remaining matches instead of hiding them', async () => {
            const icons = {};
            for (let index = 0; index < 420; index += 1) {
                icons[`alpha-${String(index).padStart(3, '0')}`] = 'F0000';
            }
            globalThis.fetch = async () => ({
                ok: true,
                json: async () => ({ version: '7.4.47', icons, aliases: {} }),
            });

            const calls = [];
            const { element, input } = createIconControl({ icon: '' }, (key, params) => {
                calls.push({ key, params });
                return key;
            });

            input.focus();
            await flushPendingLoads();

            const tiles = () => element.querySelectorAll('.icon-control__tile');
            const status = () => element.querySelector('.icon-control__status').textContent;
            const moreButton = element.querySelector('.icon-control__more');

            assert.equal(tiles().length, 300);
            assert.equal(moreButton.hidden, false);

            moreButton.click();

            // The second page is appended, not re-rendered: no hit is lost and the scroll
            // position inside the grid is kept.
            assert.equal(tiles().length, 420);
            assert.equal(moreButton.hidden, true);
            assert.deepEqual(
                calls.filter((call) => call.key === 'controls.iconPicker.count').pop().params,
                { shown: 420, total: 420 }
            );
            assert.equal(status(), 'controls.iconPicker.count');
            assert.equal(new Set([...tiles()].map((tile) => tile.dataset.iconName)).size, 420);
        });

        it('starts a new query at the first page again', async () => {
            const icons = {};
            for (let index = 0; index < 420; index += 1) {
                icons[`alpha-${String(index).padStart(3, '0')}`] = 'F0000';
            }
            icons['beta-one'] = 'F0001';
            globalThis.fetch = async () => ({
                ok: true,
                json: async () => ({ version: '7.4.47', icons, aliases: {} }),
            });

            const { element, input } = createIconControl({ icon: '' });

            input.focus();
            await flushPendingLoads();

            const moreButton = element.querySelector('.icon-control__more');
            moreButton.click();
            assert.equal(element.querySelectorAll('.icon-control__tile').length, 421);

            dispatchInput(input, 'beta');

            assert.equal(element.querySelectorAll('.icon-control__tile').length, 1);
            assert.equal(moreButton.hidden, true);
            assert.equal(element.querySelector('.icon-control__tile').dataset.iconName, 'beta-one');
        });

        it('closes the picker on the first Escape and the editor on the second', async () => {
            const { element, input, nodeData, hiddenEditorCounter } = createIconControl();

            input.focus();
            await flushPendingLoads();

            dispatchInput(input, 'mdi:not-in-index');

            dispatchKey(input, 'Escape');
            assert.equal(element.querySelector('.icon-control__popover').hidden, true);
            assert.equal(hiddenEditorCounter.count, 0);

            dispatchKey(input, 'Escape');
            assert.equal(hiddenEditorCounter.count, 1);
            assert.equal(nodeData.controlValues.icon, 'mdi:not-in-index');
        });

        it('hints about MDI names outside the bundled release instead of rejecting them', async () => {
            const { control, element, input } = createIconControl({
                icon: 'mdi:definitely-not-an-icon',
            });

            input.focus();
            await flushPendingLoads();

            const hint = element.querySelector('.icon-control__hint');
            assert.equal(hint.hidden, false);
            assert.match(hint.textContent, /iconPicker\.unknown/);
            assert.deepEqual(tileLabels(element), []);
            assert.equal(control.getValue(), 'mdi:definitely-not-an-icon');
        });

        it('clears the value through the footer button', async () => {
            const { element, input, nodeData } = createIconControl();

            input.focus();
            await flushPendingLoads();

            const clearButton = element.querySelector('.icon-control__clear');
            assert.equal(clearButton.hidden, false);

            clearButton.click();

            assert.equal(nodeData.controlValues.icon, '');
            assert.equal(input.value, '');
            assert.equal(clearButton.hidden, true);
        });

        it('degrades to plain text entry when the index cannot be loaded', async () => {
            globalThis.fetch = async () => {
                throw new Error('offline');
            };

            const { element, input, nodeData } = createIconControl();

            input.focus();
            await flushPendingLoads();

            assert.match(
                element.querySelector('.icon-control__status').textContent,
                /iconPicker\.unavailable/
            );
            assert.deepEqual(tileLabels(element), []);

            dispatchInput(input, 'mdi:any-name-at-all');

            assert.equal(nodeData.controlValues.icon, 'mdi:any-name-at-all');
        });

        it('keeps the grid selection in sync when the value changes externally', async () => {
            const { control, element, input } = createIconControl();

            input.focus();
            await flushPendingLoads();

            control.setValue('mdi:weather-sunny');

            const selectedTiles = [...element.querySelectorAll('.icon-control__tile')].filter(
                (tile) => tile.getAttribute('aria-selected') === 'true'
            );
            assert.equal(selectedTiles.length, 1);
            assert.equal(selectedTiles[0].getAttribute('aria-label'), 'mdi:weather-sunny');
        });

        it('removes the picker DOM and listeners on destroy', async () => {
            const { control, element, input } = createIconControl();

            input.focus();
            await flushPendingLoads();

            control.destroy();

            assert.equal(document.body.contains(element), false);
            assert.equal(control.picker, null);
            assert.equal(element.querySelector('.icon-control__popover'), null);
        });
    });
});

describe('clampNumericControlValue', () => {
    it('clamps into top-level min/max and ignores step', () => {
        const definition = { id: 'gain', type: 'number', min: 0, max: 10, step: 2 };
        assert.equal(clampNumericControlValue(definition, 50), 10);
        assert.equal(clampNumericControlValue(definition, -4), 0);
        assert.equal(clampNumericControlValue(definition, 5), 5, 'off-lattice values are kept');
    });

    it('prefers nested constraints over top-level min/max', () => {
        const definition = {
            id: 'gain',
            type: 'number',
            min: -100,
            max: 100,
            constraints: { min: 0, max: 10 },
        };
        assert.equal(clampNumericControlValue(definition, 50), 10);
        assert.equal(clampNumericControlValue(definition, -4), 0);
    });

    it('leaves the value alone when no finite bounds are present', () => {
        assert.equal(clampNumericControlValue({ id: 'x', type: 'number' }, 42), 42);
        assert.equal(
            clampNumericControlValue(
                { id: 'x', type: 'number', min: Number.NaN, max: Infinity },
                -7
            ),
            -7
        );
    });
});
