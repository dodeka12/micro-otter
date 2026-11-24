import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { cloneNodeForGenerator } from '../../src/micro_otter/nodes/html/js/proc/transpiler-helpers.js';
import {
    clearGraphRules,
    getGraphRules,
    validateGraphRules,
} from '../../src/micro_otter/nodes/html/js/core/graph-rule-registry.js';
// Side effect: sets globalThis.GraphRules so the webview capability module can register
// itself when loaded as a script below.
import '../../src/micro_otter/nodes/html/js/core/graph-topic-validator.js';

const webviewDefinitionsPath = path.resolve(
    'src/micro_otter/nodes/device/node_pkgs/webview/node_definitions.json'
);
const webviewPackageManifestPath = path.resolve(
    'src/micro_otter/nodes/device/node_pkgs/webview/manifest.json'
);
const webviewGeneratorPath = path.resolve(
    'src/micro_otter/nodes/device/node_pkgs/webview/node_generators.js'
);
const webviewRuntimePath = path.resolve(
    'src/micro_otter/nodes/device/node_pkgs/webview/libs/webview/page_runtime.py'
);
const webviewCapabilitiesPath = path.resolve(
    'src/micro_otter/nodes/device/node_pkgs/webview/node_capabilities.js'
);
const webviewClientPath = path.resolve(
    'src/micro_otter/nodes/device/node_pkgs/webview/libs/webview/webview_client.js'
);

function readNodeDefinitions() {
    return JSON.parse(readFileSync(webviewDefinitionsPath, 'utf8'));
}

function readWebviewPackageManifest() {
    return JSON.parse(readFileSync(webviewPackageManifestPath, 'utf8'));
}

function createContext() {
    const registeredImports = [];
    return {
        inputs: ['None', 'None', 'None'],
        inputSources: [null, null, null],
        outputs: ['node_out0'],
        graph: {
            id: null,
            name: null,
        },
        node: {
            id: 'node-1',
            type: 'content',
            controlValues: {},
        },
        helpers: {
            registerImport(statement) {
                registeredImports.push(statement);
            },
            formatLiteral(value) {
                return JSON.stringify(value);
            },
            createOutputName(index) {
                return `node_dynamic_out${index}`;
            },
        },
        _registeredImports: registeredImports,
    };
}

function clamp(value, min, max) {
    if (value < min) {
        return min;
    }
    if (value > max) {
        return max;
    }
    return value;
}

function computeJoystickParityState({ useUserInput, frontend, axis1Input, axis2Input }) {
    const sourceAxis1 = useUserInput ? frontend?.axis1 : axis1Input;
    const sourceAxis2 = useUserInput ? frontend?.axis2 : axis2Input;

    const axis1 = clamp(Number.isFinite(Number(sourceAxis1)) ? Number(sourceAxis1) : 0, -1, 1);
    const axis2 = clamp(Number.isFinite(Number(sourceAxis2)) ? Number(sourceAxis2) : 0, -1, 1);

    return { axis1, axis2 };
}

describe('webview node definitions', () => {
    it('webview manifest loads joystick generator module', () => {
        const manifest = readWebviewPackageManifest();
        const generators = Array.isArray(manifest?.generators) ? manifest.generators : [];
        assert.ok(
            generators.includes('generator_joystick_display.js'),
            'Expected webview manifest to include generator_joystick_display.js'
        );
    });

    it('ships the graph runtime through the graph-display mpAssets variant', () => {
        const manifest = readWebviewPackageManifest();
        const mpAssets = manifest?.variants?.py?.mpAssets || {};
        assert.deepEqual(mpAssets['graph-display'], [
            'otter_webview/utils.py',
            'otter_webview/graph.py',
        ]);

        const wildcardAssets = Array.isArray(mpAssets['*']) ? mpAssets['*'] : [];
        assert.ok(wildcardAssets.includes('otter_webview/refresh_hook.py'));
        assert.ok(!wildcardAssets.includes('otter_webview/graph.py'));

        const generators = Array.isArray(manifest.generators) ? manifest.generators : [];
        assert.equal(
            generators.filter((generator) => generator === 'generator_graph_display.js').length,
            1,
            'manifest must list generator_graph_display.js exactly once'
        );

        const [major, minor, patch] = String(manifest.version)
            .split('.')
            .map((part) => Number.parseInt(part, 10));
        const isNewerThanOneForty =
            major > 1 || (major === 1 && (minor > 40 || (minor === 40 && patch > 0)));
        assert.ok(
            isNewerThanOneForty,
            `Expected a version above 1.40.0, received ${manifest.version}`
        );
    });

    it('declares vars as a required package that resolves to a real manifest', () => {
        const manifest = readWebviewPackageManifest();
        assert.deepEqual(manifest.requiredPackages, ['vars']);

        const varsManifestPath = path.resolve(
            'src/micro_otter/nodes/device/node_pkgs/vars/manifest.json'
        );
        const varsManifest = JSON.parse(readFileSync(varsManifestPath, 'utf8'));
        assert.equal(varsManifest.id, 'vars');
    });

    it('manifest generator list covers every generator module in the package', () => {
        const manifest = readWebviewPackageManifest();
        const declared = new Set(Array.isArray(manifest.generators) ? manifest.generators : []);
        const packageDir = path.dirname(webviewPackageManifestPath);
        const files = readdirSync(packageDir).filter(
            (name) => name.startsWith('generator_') && name.endsWith('.js')
        );

        assert.ok(files.length > 0, 'Expected generator modules in the webview package');
        for (const file of files) {
            assert.ok(declared.has(file), `manifest is missing the generator ${file}`);
        }
    });

    it('declares exactly one persist checkbox on the five input controls', () => {
        const nodeTypes = readNodeDefinitions().nodeTypes || {};
        const inputNodeIds = [
            'web-view-number-input',
            'web-view-string-input',
            'web-view-slider',
            'web-view-checkbox',
            'web-view-select',
        ];

        for (const id of inputNodeIds) {
            const controls = nodeTypes[id].controls || [];
            const persistControls = controls.filter((control) => control.id === 'persist');
            assert.equal(
                persistControls.length,
                1,
                `${id} should declare exactly one persist control`
            );
            assert.equal(persistControls[0].type, 'checkbox');
            assert.equal(persistControls[0].default, false);
        }

        for (const id of Object.keys(nodeTypes)) {
            if (inputNodeIds.includes(id)) {
                continue;
            }
            const controls = nodeTypes[id].controls || [];
            assert.equal(
                controls.some((control) => control.id === 'persist'),
                false,
                `${id} must not declare a persist control`
            );
        }
    });

    it('keeps the existing control entries alongside persist', () => {
        const nodeTypes = readNodeDefinitions().nodeTypes || {};

        assert.deepEqual(
            nodeTypes['web-view-number-input'].controls.map((control) => control.id),
            ['minValue', 'maxValue', 'step', 'maxDigits', 'persist']
        );
        assert.deepEqual(
            nodeTypes['web-view-string-input'].controls.map((control) => control.id),
            ['maxLength', 'persist']
        );
        assert.deepEqual(
            nodeTypes['web-view-slider'].controls.map((control) => control.id),
            ['minValue', 'maxValue', 'step', 'persist']
        );
        assert.deepEqual(
            nodeTypes['web-view-select'].controls.map((control) => control.id),
            ['optionCount', 'defaultIndex', 'persist']
        );
    });

    it('declare helper-generator extensions for all webview nodes', () => {
        const definitions = readNodeDefinitions();
        const nodeTypes = definitions?.nodeTypes || {};
        const ids = [
            'web-root',
            'web-page',
            'row',
            'column',
            'content',
            'value-table',
            'radar-display',
            'joystick-display',
            'graph-display',
            'title-content',
        ];
        const generatorNamesByNodeType = {
            'web-root': 'webviewRoot',
            'web-page': 'webviewPage',
            row: 'webviewRow',
            column: 'webviewColumn',
            content: 'webviewContent',
            'value-table': 'webviewValueTable',
            'radar-display': 'webviewRadarDisplay',
            'joystick-display': 'webviewJoystickDisplay',
            'graph-display': 'webviewGraphDisplay',
            'title-content': 'webviewTitleContent',
        };

        ids.forEach((id) => {
            const nodeDef = nodeTypes[id];
            assert.ok(nodeDef, `Expected node definition for ${id}`);
            assert.equal(nodeDef.implementations?.python?.type, 'code-generator');
            assert.equal(nodeDef.initImplementations?.python?.type, 'code-generator');
            assert.equal(nodeDef.helperImplementations?.python?.type, 'helper-generator');
            assert.equal(nodeDef.helperImplementations?.python?.helperGroup, 'web-runtime');
            assert.equal(
                nodeDef.helperImplementations?.python?.value,
                `NodeHelperGenerators.${generatorNamesByNodeType[id]}`
            );
            assert.equal(nodeDef.initFunction, 'init_webview');
        });

        const webRootTitleControl = nodeTypes['web-root']?.controls?.find(
            (control) => control.id === 'title'
        );
        assert.ok(webRootTitleControl, 'Expected web-root title control');
        assert.equal(webRootTitleControl.layout, 'stacked');

        const webPageTitleControl = nodeTypes['web-page']?.controls?.find(
            (control) => control.id === 'pageName'
        );
        assert.ok(webPageTitleControl, 'Expected web-page title control');
        assert.equal(webPageTitleControl.layout, 'stacked');
    });

    it('defines value-table row-count activeInputs visibility model', () => {
        const definitions = readNodeDefinitions();
        const nodeTypes = definitions?.nodeTypes || {};
        const valueTable = nodeTypes['value-table'];
        assert.ok(valueTable, 'Expected node definition for value-table');

        const inputs = Array.isArray(valueTable.inputs) ? valueTable.inputs : [];
        const inputIds = inputs.map((input) => input?.id);
        assert.equal(inputs.length, 11);
        assert.deepEqual(inputIds, [
            'parent',
            'label_1',
            'value_1',
            'label_2',
            'value_2',
            'label_3',
            'value_3',
            'label_4',
            'value_4',
            'label_5',
            'value_5',
        ]);

        const rowCountControl = (
            Array.isArray(valueTable.controls) ? valueTable.controls : []
        ).find((control) => control?.id === 'rowCount');
        const decimalPlacesControl = (
            Array.isArray(valueTable.controls) ? valueTable.controls : []
        ).find((control) => control?.id === 'decimalPlaces');
        assert.ok(rowCountControl, 'Expected rowCount control');
        assert.ok(decimalPlacesControl, 'Expected decimalPlaces control');
        assert.equal(rowCountControl.type, 'dropdown');
        assert.equal(rowCountControl.affectsInputs, true);
        assert.equal(decimalPlacesControl.type, 'number');
        assert.equal(decimalPlacesControl.default, 2);
        assert.equal(decimalPlacesControl.min, 0);
        assert.equal(decimalPlacesControl.max, 6);
        assert.equal(decimalPlacesControl.step, 1);

        const options = Array.isArray(rowCountControl.options) ? rowCountControl.options : [];
        assert.equal(options.length, 5);

        options.forEach((option, index) => {
            const rowCount = index + 1;
            const activeInputs = Array.isArray(option?.activeInputs) ? option.activeInputs : [];
            const expectedInputs = ['parent'];
            for (let rowIndex = 1; rowIndex <= rowCount; rowIndex += 1) {
                expectedInputs.push(`label_${rowIndex}`);
                expectedInputs.push(`value_${rowIndex}`);
            }
            assert.equal(option.value, rowCount);
            assert.deepEqual(activeInputs, expectedInputs);
        });

        for (let rowIndex = 1; rowIndex <= 5; rowIndex += 1) {
            const labelInput = inputs.find((input) => input?.id === `label_${rowIndex}`);
            const valueInput = inputs.find((input) => input?.id === `value_${rowIndex}`);
            assert.ok(labelInput?.defaultControl, `Expected defaultControl for label_${rowIndex}`);
            assert.ok(valueInput?.defaultControl, `Expected defaultControl for value_${rowIndex}`);
            assert.equal(labelInput.defaultControl.id, `defaultLabel${rowIndex}`);
            assert.equal(labelInput.defaultControl.type, 'text');
            assert.equal(valueInput.defaultControl.id, `defaultValue${rowIndex}`);
            assert.equal(valueInput.defaultControl.type, 'number');
        }
    });

    it('defines radar-display control bounds and input contract', () => {
        const definitions = readNodeDefinitions();
        const nodeTypes = definitions?.nodeTypes || {};
        const radarDisplay = nodeTypes['radar-display'];
        assert.ok(radarDisplay, 'Expected node definition for radar-display');

        assert.equal(radarDisplay.executionPhase, 'both');

        const inputs = Array.isArray(radarDisplay.inputs) ? radarDisplay.inputs : [];
        assert.deepEqual(
            inputs.map((input) => input?.id),
            ['parent', 'pieceIndex', 'pieceRadiusNormalized']
        );

        const pieceIndexInput = inputs.find((input) => input?.id === 'pieceIndex');
        assert.deepEqual(pieceIndexInput?.allowedTypes, ['int', 'float']);
        assert.deepEqual(pieceIndexInput?.initialTypes, ['int', 'float']);

        const pieceRadiusInput = inputs.find((input) => input?.id === 'pieceRadiusNormalized');
        assert.deepEqual(pieceRadiusInput?.allowedTypes, ['int', 'float']);
        assert.deepEqual(pieceRadiusInput?.initialTypes, ['int', 'float']);
        assert.equal(pieceRadiusInput?.defaultControl?.min, 0);
        assert.equal(pieceRadiusInput?.defaultControl?.max, 1);

        const controls = Array.isArray(radarDisplay.controls) ? radarDisplay.controls : [];
        const maxRadiusControl = controls.find((control) => control?.id === 'maxRadiusPx');
        const startAngleControl = controls.find((control) => control?.id === 'startAngleDeg');
        const endAngleControl = controls.find((control) => control?.id === 'endAngleDeg');
        const pieceCountControl = controls.find((control) => control?.id === 'pieceCount');
        const fillColorControl = controls.find((control) => control?.id === 'fillColor');
        const initialRadiusControl = controls.find(
            (control) => control?.id === 'initialRadiusNormalized'
        );

        assert.ok(maxRadiusControl, 'Expected maxRadiusPx control');
        assert.equal(maxRadiusControl.min, 1);
        assert.ok(maxRadiusControl.max == null);

        assert.ok(startAngleControl, 'Expected startAngleDeg control');
        assert.ok(endAngleControl, 'Expected endAngleDeg control');

        assert.ok(pieceCountControl, 'Expected pieceCount control');
        assert.equal(pieceCountControl.min, 1);
        assert.equal(pieceCountControl.max, 360);

        assert.ok(fillColorControl, 'Expected fillColor control');
        assert.equal(fillColorControl.type, 'color');

        assert.ok(initialRadiusControl, 'Expected initialRadiusNormalized control');
        assert.equal(initialRadiusControl.min, 0);
        assert.equal(initialRadiusControl.max, 1);
    });

    it('defines joystick-display input contract and visual controls', () => {
        const definitions = readNodeDefinitions();
        const nodeTypes = definitions?.nodeTypes || {};
        const joystickDisplay = nodeTypes['joystick-display'];
        assert.ok(joystickDisplay, 'Expected node definition for joystick-display');

        assert.equal(joystickDisplay.executionPhase, 'both');

        const inputs = Array.isArray(joystickDisplay.inputs) ? joystickDisplay.inputs : [];
        assert.deepEqual(
            inputs.map((input) => input?.id),
            ['parent', 'useUserInput', 'axis1', 'axis2']
        );

        const useUserInput = inputs.find((input) => input?.id === 'useUserInput');
        assert.deepEqual(useUserInput?.allowedTypes, ['bool']);
        assert.deepEqual(useUserInput?.initialTypes, ['bool']);
        assert.equal(useUserInput?.defaultControl?.type, 'checkbox');
        assert.equal(useUserInput?.defaultControl?.default, false);

        const axis1Input = inputs.find((input) => input?.id === 'axis1');
        assert.deepEqual(axis1Input?.allowedTypes, ['int', 'float']);
        assert.deepEqual(axis1Input?.initialTypes, ['int', 'float']);
        assert.equal(axis1Input?.defaultControl?.min, -1);
        assert.equal(axis1Input?.defaultControl?.max, 1);

        const axis2Input = inputs.find((input) => input?.id === 'axis2');
        assert.deepEqual(axis2Input?.allowedTypes, ['int', 'float']);
        assert.deepEqual(axis2Input?.initialTypes, ['int', 'float']);
        assert.equal(axis2Input?.defaultControl?.min, -1);
        assert.equal(axis2Input?.defaultControl?.max, 1);

        const outputs = Array.isArray(joystickDisplay.outputs) ? joystickDisplay.outputs : [];
        assert.deepEqual(
            outputs.map((output) => output?.id),
            ['element', 'axis1', 'axis2', 'changed']
        );
        assert.equal(outputs[3].outputType, 'bool');

        const controls = Array.isArray(joystickDisplay.controls) ? joystickDisplay.controls : [];
        const outerRadiusControl = controls.find((control) => control?.id === 'outerRadiusPx');
        const outerStrokeWidthControl = controls.find(
            (control) => control?.id === 'outerStrokeWidthPx'
        );
        const outerStrokeColorControl = controls.find(
            (control) => control?.id === 'outerStrokeColor'
        );
        const outerFillColorControl = controls.find((control) => control?.id === 'outerFillColor');
        const innerRadiusControl = controls.find((control) => control?.id === 'innerRadiusPx');
        const innerFillColorControl = controls.find((control) => control?.id === 'innerFillColor');
        const showDegreeMarksControl = controls.find(
            (control) => control?.id === 'showDegreeMarks'
        );
        const degreeMarkIntervalControl = controls.find(
            (control) => control?.id === 'degreeMarkIntervalDeg'
        );
        const degreeMarkColorControl = controls.find(
            (control) => control?.id === 'degreeMarkColor'
        );
        const recenterOnReleaseControl = controls.find(
            (control) => control?.id === 'recenterOnRelease'
        );

        assert.ok(outerRadiusControl, 'Expected outerRadiusPx control');
        assert.equal(outerRadiusControl.min, 1);
        assert.ok(outerStrokeWidthControl, 'Expected outerStrokeWidthPx control');
        assert.equal(outerStrokeWidthControl.min, 0);

        assert.ok(outerStrokeColorControl, 'Expected outerStrokeColor control');
        assert.equal(outerStrokeColorControl.type, 'color');
        assert.ok(outerFillColorControl, 'Expected outerFillColor control');
        assert.equal(outerFillColorControl.type, 'color');

        assert.ok(innerRadiusControl, 'Expected innerRadiusPx control');
        assert.equal(innerRadiusControl.min, 1);
        assert.ok(innerFillColorControl, 'Expected innerFillColor control');
        assert.equal(innerFillColorControl.type, 'color');

        assert.ok(showDegreeMarksControl, 'Expected showDegreeMarks control');
        assert.equal(showDegreeMarksControl.type, 'checkbox');

        assert.ok(degreeMarkIntervalControl, 'Expected degreeMarkIntervalDeg control');
        assert.equal(degreeMarkIntervalControl.type, 'dropdown');
        assert.ok(Array.isArray(degreeMarkIntervalControl.options));
        assert.equal(degreeMarkIntervalControl.options.length, 4);

        assert.ok(degreeMarkColorControl, 'Expected degreeMarkColor control');
        assert.equal(degreeMarkColorControl.type, 'color');
        assert.ok(recenterOnReleaseControl, 'Expected recenterOnRelease control');
        assert.equal(recenterOnReleaseControl.type, 'checkbox');
        assert.equal(recenterOnReleaseControl.default, true);
    });

    it('defines graph-display metadata, connector order, and control contract', () => {
        const definitions = readNodeDefinitions();
        const nodeTypes = definitions?.nodeTypes || {};
        const graphDisplay = nodeTypes['graph-display'];
        assert.ok(graphDisplay, 'Expected node definition for graph-display');

        assert.equal(graphDisplay.title.en, 'Line Graph');
        assert.equal(graphDisplay.title.de, 'Liniendiagramm');
        assert.equal(graphDisplay.category, 'webview');
        assert.equal(graphDisplay.executionPhase, 'both');
        assert.equal(graphDisplay.color, '#c892b8');
        assert.equal(graphDisplay.shape, 'square');
        assert.equal(graphDisplay.icon, 'icons/show_chart_24dp.svg');
        assert.equal(graphDisplay.defaultWidth, 360);
        assert.equal(graphDisplay.initFunction, 'init_webview');

        const inputs = Array.isArray(graphDisplay.inputs) ? graphDisplay.inputs : [];
        assert.deepEqual(
            inputs.map((input) => input?.id),
            ['parent', 'title', 'x', 'y']
        );
        assert.deepEqual(
            inputs.map((input) => input?.initialTypes),
            [['web.element'], ['string'], ['vars.array'], ['vars.array']]
        );
        assert.deepEqual(
            inputs.map((input) => input?.phase),
            ['both', 'both', 'both', 'both']
        );

        const titleInput = inputs.find((input) => input?.id === 'title');
        assert.deepEqual(titleInput?.defaultControl, {
            id: 'title',
            type: 'text',
            label: { en: 'Title', de: 'Titel' },
            default: 'Line Graph',
        });

        const outputs = Array.isArray(graphDisplay.outputs) ? graphDisplay.outputs : [];
        assert.deepEqual(
            outputs.map((output) => output?.id),
            ['element']
        );
        assert.equal(outputs[0].outputType, 'web.element');

        const controls = Array.isArray(graphDisplay.controls) ? graphDisplay.controls : [];
        assert.deepEqual(
            controls.map((control) => control?.id),
            [
                'yRangeMode',
                'minY',
                'maxY',
                'xRangeMode',
                'minX',
                'maxX',
                'heightPx',
                'xLabel',
                'yLabel',
                'lineColor',
                'tickCount',
                'maxPoints',
            ]
        );

        const controlById = new Map(controls.map((control) => [control.id, control]));
        for (const [modeId, boundIds] of [
            ['yRangeMode', ['minY', 'maxY']],
            ['xRangeMode', ['minX', 'maxX']],
        ]) {
            const control = controlById.get(modeId);
            assert.equal(control.type, 'dropdown');
            assert.equal(control.default, 'auto');
            assert.equal(control.affectsControls, true);
            assert.deepEqual(
                control.options.map((option) => [option.value, option.activeControls]),
                [
                    ['auto', []],
                    ['manual', boundIds],
                ]
            );
        }

        for (const id of ['minY', 'maxY', 'minX', 'maxX']) {
            const control = controlById.get(id);
            assert.equal(control.type, 'number');
            assert.equal(control.min, -100000);
            assert.equal(control.max, 100000);
            assert.equal(control.step, 0.1);
        }
        assert.equal(controlById.get('minY').default, -1);
        assert.equal(controlById.get('maxY').default, 1);
        assert.equal(controlById.get('minX').default, 0);
        assert.equal(controlById.get('maxX').default, 1);

        assert.equal(controlById.get('heightPx').default, 240);
        assert.equal(controlById.get('heightPx').min, 80);
        assert.equal(controlById.get('heightPx').max, 1200);
        assert.equal(controlById.get('heightPx').step, 10);

        assert.equal(controlById.get('tickCount').default, 5);
        assert.equal(controlById.get('tickCount').min, 2);
        assert.equal(controlById.get('tickCount').max, 12);
        assert.equal(controlById.get('tickCount').step, 1);

        assert.equal(controlById.get('maxPoints').default, 256);
        assert.equal(controlById.get('maxPoints').min, 2);
        assert.equal(controlById.get('maxPoints').max, 2048);
        assert.equal(controlById.get('maxPoints').step, 1);

        assert.equal(controlById.get('xLabel').type, 'text');
        assert.equal(controlById.get('xLabel').default, '');
        assert.equal(controlById.get('yLabel').type, 'text');
        assert.equal(controlById.get('yLabel').default, '');
        assert.equal(controlById.get('lineColor').type, 'color');
        assert.equal(controlById.get('lineColor').default, '#70d6ff');

        assert.equal(
            graphDisplay.implementations?.python?.value,
            'NodeCodeGenerators.webviewGraphDisplay'
        );
        assert.equal(
            graphDisplay.helperImplementations?.python?.value,
            'NodeHelperGenerators.webviewGraphDisplay'
        );
        assert.equal(graphDisplay.helperImplementations?.python?.helperGroup, 'web-runtime');
        assert.equal(
            graphDisplay.initImplementations?.python?.value,
            'NodeInitGenerators.webviewGraphDisplay'
        );
    });
});

describe('webview generators helper-first contract', () => {
    let originalSelf;
    let originalWindow;
    let originalNodeCodeGenerators;
    let originalNodeInitGenerators;
    let originalNodeHelperGenerators;
    let originalNodeHelperHandoffConsumers;

    before(async () => {
        originalSelf = globalThis.self;
        originalWindow = globalThis.window;
        originalNodeCodeGenerators = globalThis.NodeCodeGenerators;
        originalNodeInitGenerators = globalThis.NodeInitGenerators;
        originalNodeHelperGenerators = globalThis.NodeHelperGenerators;
        originalNodeHelperHandoffConsumers = globalThis.NodeHelperHandoffConsumers;

        globalThis.self = globalThis;
        delete globalThis.window;
        globalThis.NodeCodeGenerators = {};
        globalThis.NodeInitGenerators = {};
        globalThis.NodeHelperGenerators = {};
        globalThis.NodeHelperHandoffConsumers = {};

        const generatorUrl = pathToFileURL(webviewGeneratorPath);
        await import(`${generatorUrl.href}?test=webview-generators-fail-fast`);
    });

    after(() => {
        if (originalSelf === undefined) {
            delete globalThis.self;
        } else {
            globalThis.self = originalSelf;
        }

        if (originalWindow === undefined) {
            delete globalThis.window;
        } else {
            globalThis.window = originalWindow;
        }

        if (originalNodeCodeGenerators === undefined) {
            delete globalThis.NodeCodeGenerators;
        } else {
            globalThis.NodeCodeGenerators = originalNodeCodeGenerators;
        }

        if (originalNodeInitGenerators === undefined) {
            delete globalThis.NodeInitGenerators;
        } else {
            globalThis.NodeInitGenerators = originalNodeInitGenerators;
        }

        if (originalNodeHelperGenerators === undefined) {
            delete globalThis.NodeHelperGenerators;
        } else {
            globalThis.NodeHelperGenerators = originalNodeHelperGenerators;
        }

        if (originalNodeHelperHandoffConsumers === undefined) {
            delete globalThis.NodeHelperHandoffConsumers;
        } else {
            globalThis.NodeHelperHandoffConsumers = originalNodeHelperHandoffConsumers;
        }
    });

    it('registers the webview value-store generators', () => {
        assert.equal(typeof globalThis.NodeCodeGenerators.webStoreRead, 'function');
        assert.equal(typeof globalThis.NodeCodeGenerators.webStoreWrite, 'function');
    });

    it('resolves every declared webview generator implementation', () => {
        const nodeTypes = readNodeDefinitions().nodeTypes || {};

        for (const [id, def] of Object.entries(nodeTypes)) {
            const python = def?.implementations?.python;
            if (python?.type === 'code-generator') {
                const name = String(python.value || '').replace(/^NodeCodeGenerators\./, '');
                assert.equal(
                    typeof globalThis.NodeCodeGenerators[name],
                    'function',
                    `${id}: code generator ${name} is not registered`
                );
            }

            const helper = def?.helperImplementations?.python;
            if (helper?.type === 'helper-generator') {
                const name = String(helper.value || '').replace(/^NodeHelperGenerators\./, '');
                assert.equal(
                    typeof globalThis.NodeHelperGenerators[name],
                    'function',
                    `${id}: helper generator ${name} is not registered`
                );
            }

            const init = def?.initImplementations?.python;
            if (init?.type === 'code-generator') {
                const name = String(init.value || '').replace(/^NodeInitGenerators\./, '');
                assert.equal(
                    typeof globalThis.NodeInitGenerators[name],
                    'function',
                    `${id}: init generator ${name} is not registered`
                );
            }
        }
    });

    it('exposes shared node-kind contributor registry APIs with duplicate and missing checks', () => {
        const shared = globalThis.WebviewGeneratorShared;
        assert.ok(shared, 'Expected WebviewGeneratorShared global export');
        assert.equal(typeof shared.WebviewNodeBase, 'function');
        assert.equal(typeof globalThis.WebviewNodeBase, 'function');
        assert.equal(typeof shared.registerNodeKindImplementation, 'function');
        assert.equal(typeof shared.getNodeKindImplementation, 'function');
        assert.equal(typeof shared.listNodeKindImplementations, 'function');
        assert.equal(typeof shared.registerNodeKindContributor, 'function');
        assert.equal(typeof shared.getNodeKindContributor, 'function');
        assert.equal(typeof shared.listNodeKindContributors, 'function');
        assert.equal(
            shared.createWebviewRadarDisplayLoopGenerator,
            undefined,
            'Expected radar loop generator ownership outside shared module'
        );
        assert.equal(
            shared.createWebviewJoystickDisplayLoopGenerator,
            undefined,
            'Expected joystick loop generator ownership outside shared module'
        );

        const beforeCount = shared.listNodeKindContributors().length;

        const contributor = shared.registerNodeKindContributor('test-step2-contract', {
            renderMarkup() {
                return ['<div data-test-step2="true"></div>'];
            },
        });
        assert.equal(typeof contributor?.renderMarkup, 'function');

        const resolved = shared.getNodeKindContributor('test-step2-contract', {
            required: true,
        });
        assert.equal(resolved, contributor);

        assert.throws(() => {
            shared.registerNodeKindContributor('test-step2-contract', {
                renderMarkup() {
                    return [];
                },
            });
        }, /Duplicate webview node contributor registration/);

        assert.equal(shared.getNodeKindContributor('test-step2-missing'), null);
        assert.throws(() => {
            shared.getNodeKindContributor('test-step2-missing', { required: true });
        }, /Missing webview node contributor registration/);

        const afterCount = shared.listNodeKindContributors().length;
        assert.equal(afterCount, beforeCount + 1);
    });

    it('normalizes value-table decimalPlaces with finite integer clamp rules', () => {
        const shared = globalThis.WebviewGeneratorShared;
        const contributor = shared.getNodeKindContributor('value-table', { required: true });

        const normalizedDefault = contributor.normalizeControls({ rowCount: 2 });
        assert.equal(normalizedDefault.rowCount, 2);
        assert.equal(normalizedDefault.decimalPlaces, 2);

        const normalizedFloor = contributor.normalizeControls({ decimalPlaces: 4.9 });
        assert.equal(normalizedFloor.decimalPlaces, 4);

        const normalizedLowClamp = contributor.normalizeControls({ decimalPlaces: -3 });
        assert.equal(normalizedLowClamp.decimalPlaces, 0);

        const normalizedHighClamp = contributor.normalizeControls({ decimalPlaces: 99 });
        assert.equal(normalizedHighClamp.decimalPlaces, 6);

        const normalizedFallback = contributor.normalizeControls({ decimalPlaces: 'not-a-number' });
        assert.equal(normalizedFallback.decimalPlaces, 2);
    });

    it('registers node implementations by node kind with instance validation', () => {
        const shared = globalThis.WebviewGeneratorShared;
        const BaseClass = shared.WebviewNodeBase;

        class TestImplementation extends BaseClass {
            renderMarkup() {
                return ['<div data-step20="implementation"></div>'];
            }
        }

        const beforeCount = shared.listNodeKindImplementations().length;
        const implementation = new TestImplementation();
        const registered = shared.registerNodeKindImplementation(
            'test-step20-implementation',
            implementation
        );
        assert.equal(registered, implementation);

        const resolvedImplementation = shared.getNodeKindImplementation(
            'test-step20-implementation',
            { required: true }
        );
        assert.equal(resolvedImplementation, implementation);

        const resolvedContributor = shared.getNodeKindContributor('test-step20-implementation', {
            required: true,
        });
        assert.equal(typeof resolvedContributor?.renderMarkup, 'function');

        const afterCount = shared.listNodeKindImplementations().length;
        assert.equal(afterCount, beforeCount + 1);

        assert.throws(() => {
            shared.registerNodeKindImplementation(
                'test-step20-implementation',
                new TestImplementation()
            );
        }, /Duplicate webview node implementation registration/);

        assert.throws(() => {
            shared.registerNodeKindImplementation('test-step20-invalid', {
                renderMarkup() {
                    return [];
                },
            });
        }, /must be an instance of WebviewNodeBase/);
    });

    it('defines WebviewNodeBase interfaces with fail-fast runtime payload default', () => {
        const BaseClass = globalThis.WebviewNodeBase;
        assert.equal(typeof BaseClass, 'function');

        const instance = new BaseClass();
        assert.equal(typeof instance.normalizeControls, 'function');
        assert.equal(typeof instance.renderRuntimePayload, 'function');
        assert.equal(typeof instance.renderMarkup, 'function');
        assert.equal(typeof instance.renderClientUpdateHandler, 'function');
        assert.equal(typeof instance.renderClientHelpers, 'function');
        assert.equal(typeof instance.renderClientInitHooks, 'function');
        assert.equal(typeof instance.getWebserverCapabilities, 'function');
        assert.equal(typeof instance.getStructuralStrategy, 'function');

        assert.deepEqual(instance.normalizeControls({ title: 'ok' }), { title: 'ok' });
        assert.equal(instance.renderMarkup(), null);
        assert.equal(instance.renderClientUpdateHandler(), null);
        assert.equal(instance.renderClientHelpers(), null);
        assert.equal(instance.renderClientInitHooks(), null);
        assert.equal(instance.getWebserverCapabilities(), null);
        assert.equal(instance.getStructuralStrategy(), null);
        assert.throws(() => instance.renderRuntimePayload(), /must be implemented/);
    });

    it('exposes and populates structural node strategy registry for structural generators', () => {
        const shared = globalThis.WebviewGeneratorShared;
        assert.equal(typeof shared?.registerStructuralNodeKindStrategy, 'function');
        assert.equal(typeof shared?.getStructuralNodeKindStrategy, 'function');
        assert.equal(typeof shared?.listStructuralNodeKindStrategies, 'function');

        const webRoot = shared.getStructuralNodeKindStrategy('web-root', { required: true });
        const webPage = shared.getStructuralNodeKindStrategy('web-page', { required: true });
        const row = shared.getStructuralNodeKindStrategy('row', { required: true });
        const column = shared.getStructuralNodeKindStrategy('column', { required: true });

        assert.equal(webRoot?.containerClass, 'wv-root');
        assert.equal(webRoot?.isPageScopeKind, true);
        assert.equal(typeof webRoot?.normalizeControls, 'function');

        assert.equal(webPage?.containerClass, 'wv-page');
        assert.equal(webPage?.isPageScopeKind, true);
        assert.equal(typeof webPage?.normalizeControls, 'function');

        assert.equal(row?.containerClass, 'wv-row');
        assert.equal(row?.isPageScopeKind, false);
        assert.equal(typeof row?.normalizeControls, 'function');

        assert.equal(column?.containerClass, 'wv-col');
        assert.equal(column?.isPageScopeKind, false);
        assert.equal(typeof column?.normalizeControls, 'function');

        const strategyKinds = shared
            .listStructuralNodeKindStrategies()
            .map((entry) => entry?.nodeKind)
            .filter(Boolean);
        assert.ok(strategyKinds.includes('web-root'));
        assert.ok(strategyKinds.includes('web-page'));
        assert.ok(strategyKinds.includes('row'));
        assert.ok(strategyKinds.includes('column'));
    });

    it('column style rules scope equal-width columns to direct row children', () => {
        const impl = globalThis.WebviewGeneratorShared.getNodeKindImplementation('column');
        assert.ok(impl, 'Expected column implementation');
        assert.equal(typeof impl.renderClientStyleRules, 'function');

        const rules = impl.renderClientStyleRules().map((rule) => rule.trim());
        assert.ok(
            rules.includes('.wv-row > .wv-col { flex: 1 1 0; min-width: 0; }'),
            'Expected the scoped equal-width rule'
        );
        assert.ok(
            rules.includes(
                '.wv-col { display: flex; flex-direction: column; gap: 10px; flex: 1 1 auto; }'
            ),
            'Expected the standalone column rule to remain unchanged'
        );
        assert.ok(
            !rules.some((rule) => rule.startsWith('.wv-col { flex: 1 1 0;')),
            'Expected the equal-width rule not to override bare .wv-col'
        );
        assert.ok(
            !rules.some((rule) => rule.startsWith('.wv-row .wv-col')),
            'Expected the new rule to use the child combinator, not a descendant selector'
        );
    });

    it('registers dynamic contributors with normalizeControls ownership surfaces', () => {
        const shared = globalThis.WebviewGeneratorShared;
        const dynamicKinds = [
            'content',
            'value-table',
            'radar-display',
            'joystick-display',
            'graph-display',
            'title-content',
        ];

        dynamicKinds.forEach((nodeKind) => {
            const contributor = shared.getNodeKindContributor(nodeKind, { required: true });
            assert.equal(
                typeof contributor?.normalizeControls,
                'function',
                `Expected normalizeControls contributor surface for ${nodeKind}`
            );
        });

        const joystickContributor = shared.getNodeKindContributor('joystick-display', {
            required: true,
        });
        assert.equal(typeof joystickContributor?.getRefreshTransientKeyPrefixes, 'function');
        assert.deepEqual(joystickContributor.getRefreshTransientKeyPrefixes(), [
            'frontend:joystick:',
        ]);
    });

    it('runtime generators keep structural nodes as no-op and publish dynamic node updates', () => {
        const structuralCases = [
            {
                name: 'webviewRoot',
                expectedInitFragment: 'webElement:node-1:0',
            },
            {
                name: 'webviewPage',
                expectedInitFragment: 'webElement:node-1:0',
            },
            {
                name: 'webviewRow',
                expectedInitFragment: 'node_out0 = None',
            },
            {
                name: 'webviewColumn',
                expectedInitFragment: 'node_out0 = None',
            },
        ];

        structuralCases.forEach(({ name, expectedInitFragment }) => {
            const context = createContext();
            const initGenerator = globalThis.NodeInitGenerators[name];
            const loopGenerator = globalThis.NodeCodeGenerators[name];
            assert.equal(typeof initGenerator, 'function', `Expected init generator ${name}`);
            assert.equal(typeof loopGenerator, 'function', `Expected loop generator ${name}`);

            const initResult = initGenerator(context);
            const loopResult = loopGenerator(context);

            assert.equal(typeof initResult?.statement, 'string');
            assert.equal(typeof loopResult?.statement, 'string');
            assert.ok(initResult.statement.includes(expectedInitFragment));
            assert.ok(loopResult.statement.includes('# webview:'));
            assert.ok(loopResult.statement.includes(':loop'));
            assert.ok(!loopResult.statement.includes('= None'));
            assert.ok(!loopResult.statement.includes('WVR.'));
            assert.ok(!loopResult.statement.includes('WebPageRuntime'));
        });

        const dynamicCases = [
            {
                name: 'webviewContent',
                context: {
                    ...createContext(),
                    inputs: ['node_parent_out0', 'node_title', 'node_value'],
                    node: {
                        id: 'node-9',
                        type: 'content',
                        controlValues: {},
                    },
                },
                loopFragment: "'kind': 'content'",
            },
            {
                name: 'webviewValueTable',
                context: {
                    ...createContext(),
                    inputs: [
                        'node_parent_out2',
                        'node_label_1',
                        'node_value_1',
                        'node_label_2',
                        'node_value_2',
                        'None',
                        'None',
                        'None',
                        'None',
                        'None',
                        'None',
                    ],
                    node: {
                        id: 'node-12',
                        type: 'value-table',
                        controlValues: { rowCount: 2, decimalPlaces: 3 },
                    },
                },
                loopFragment: "'kind': 'value-table'",
            },
            {
                name: 'webviewRadarDisplay',
                context: {
                    ...createContext(),
                    inputs: ['node_parent_out3', 'node_piece_index', 'node_piece_radius'],
                    node: {
                        id: 'node-14',
                        type: 'radar-display',
                        controlValues: {
                            maxRadiusPx: 48,
                            startAngleDeg: -45,
                            endAngleDeg: 135,
                            pieceCount: 12,
                            fillColor: '#66ddff',
                            initialRadiusNormalized: 0.35,
                        },
                    },
                },
                loopFragment: "'kind': 'radar-display'",
            },
            {
                name: 'webviewJoystickDisplay',
                context: {
                    ...createContext(),
                    inputs: ['node_parent_out4', 'node_use_user', 'node_axis1', 'node_axis2'],
                    node: {
                        id: 'node-16',
                        type: 'joystick-display',
                        controlValues: {
                            outerRadiusPx: 52,
                            outerStrokeWidthPx: 3,
                            outerStrokeColor: '#86b6ff',
                            outerFillColor: '#0f182a',
                            innerRadiusPx: 9,
                            innerFillColor: '#5fd6ff',
                            showDegreeMarks: true,
                            degreeMarkIntervalDeg: 30,
                            degreeMarkColor: '#7fa1d6',
                        },
                    },
                },
                loopFragment: "'kind': 'joystick-display'",
            },
            {
                name: 'webviewGraphDisplay',
                context: {
                    ...createContext(),
                    inputs: ['node_parent_out5', 'node_title', 'node_x_values', 'node_y_values'],
                    node: {
                        id: 'node-17',
                        type: 'graph-display',
                        controlValues: {
                            title: 'Line Graph',
                            heightPx: 240,
                            tickCount: 5,
                            lineColor: '#70d6ff',
                            xLabel: 'Time',
                            yLabel: 'Value',
                            maxPoints: 128,
                            xRangeMode: 'auto',
                            yRangeMode: 'auto',
                        },
                    },
                },
                loopFragment: "'kind': 'graph-display'",
            },
            {
                name: 'webviewTitleContent',
                context: {
                    ...createContext(),
                    inputs: ['node_parent_out1', 'node_title', 'None'],
                    node: {
                        id: 'node-15',
                        type: 'title-content',
                        controlValues: { headingLevel: 3 },
                    },
                },
                loopFragment: "'kind': 'title-content'",
            },
        ];

        dynamicCases.forEach(({ name, context, loopFragment }) => {
            const initGenerator = globalThis.NodeInitGenerators[name];
            const loopGenerator = globalThis.NodeCodeGenerators[name];
            assert.equal(typeof initGenerator, 'function', `Expected init generator ${name}`);
            assert.equal(typeof loopGenerator, 'function', `Expected loop generator ${name}`);

            const initResult = initGenerator(context);
            const loopResult = loopGenerator(context);

            assert.equal(typeof initResult?.statement, 'string');
            assert.equal(typeof loopResult?.statement, 'string');
            assert.ok(initResult.statement.includes('node_out0 = node_parent'));
            assert.equal(initResult?.init?.execute, undefined);
            assert.ok(
                loopResult.statement.includes(
                    'web_interface_module.WEB_INTERFACE.publish_webview_values('
                )
            );
            assert.ok(loopResult.statement.includes('wv_bind_'));
            assert.ok(loopResult.statement.includes(loopFragment));
            if (name === 'webviewValueTable') {
                assert.ok(loopResult.statement.includes("'decimalPlaces': 3"));
            }
            assert.ok(loopResult.statement.includes('web_interface_module.WEB_INTERFACE'));
            assert.ok(!loopResult.statement.includes('WVR.'));
            assert.ok(!loopResult.statement.includes('WebPageRuntime'));
            assert.ok(
                context._registeredImports.includes(
                    'import otter_runtime.web_interface as web_interface_module'
                )
            );
        });
    });

    it('uses compile-time binding key when loop parent passthrough is unavailable', () => {
        const loopGenerator = globalThis.NodeCodeGenerators.webviewTitleContent;
        const initGenerator = globalThis.NodeInitGenerators.webviewTitleContent;
        assert.equal(typeof initGenerator, 'function');
        assert.equal(typeof loopGenerator, 'function');

        const initContext = {
            ...createContext(),
            inputs: ['node_parent_out1', 'node_title', 'None'],
            outputs: ['node_out0'],
            node: {
                id: 'node-15',
                type: 'title-content',
                controlValues: { headingLevel: 3 },
            },
        };
        const loopContext = {
            ...createContext(),
            inputs: ['None', 'node_title', 'None'],
            inputSources: [{ fromNode: 'node-parent', fromIndex: 1, toIndex: 0 }, null, null],
            outputs: ['node_out0'],
            node: {
                id: 'node-15',
                type: 'title-content',
                controlValues: { headingLevel: 3 },
            },
        };

        const initResult = initGenerator(initContext);
        const loopResult = loopGenerator(loopContext);

        assert.equal(initResult?.init?.execute, undefined);
        assert.ok(loopResult.statement.includes('"wv_bind_title_node_15_s1"'));
        assert.ok(!loopResult.statement.includes('globals().get('));
    });

    it('defaults value-table runtime payload decimalPlaces to 2 when control is missing', () => {
        const loopGenerator = globalThis.NodeCodeGenerators.webviewValueTable;
        assert.equal(typeof loopGenerator, 'function');

        const result = loopGenerator({
            ...createContext(),
            inputs: ['node_parent', 'node_label_1', 'node_value_1'],
            node: {
                id: 'node-value-table-default-precision',
                type: 'value-table',
                controlValues: { rowCount: 1 },
            },
        });

        assert.equal(typeof result?.statement, 'string');
        assert.ok(result.statement.includes("'kind': 'value-table'"));
        assert.ok(result.statement.includes("'decimalPlaces': 2"));
    });

    it('uses contributor runtime payload surface for shared dynamic loop generation', () => {
        const shared = globalThis.WebviewGeneratorShared;
        assert.equal(typeof shared?.registerNodeKindContributor, 'function');
        assert.equal(typeof shared?.createWebviewDynamicLoopGenerator, 'function');

        const contributorNodeKind = 'test-runtime-payload-contributor';
        shared.registerNodeKindContributor(contributorNodeKind, {
            renderRuntimePayload(context) {
                const titleInput =
                    typeof context?.titleInput === 'string' && context.titleInput.trim()
                        ? context.titleInput.trim()
                        : 'None';
                return `{ 'kind': 'test-runtime-payload', 'title': ${titleInput} }`;
            },
        });

        const loopGenerator = shared.createWebviewDynamicLoopGenerator(contributorNodeKind);
        const context = {
            ...createContext(),
            inputs: ['node_parent_out7', 'node_runtime_title', 'None'],
            inputSources: [{ fromNode: 'node-parent', fromIndex: 7, toIndex: 0 }, null, null],
            outputs: ['node_out0'],
            node: {
                id: 'node-runtime-payload',
                type: contributorNodeKind,
                controlValues: {},
            },
        };

        const loopResult = loopGenerator(context);
        assert.equal(typeof loopResult?.statement, 'string');
        assert.ok(loopResult.statement.includes("'kind': 'test-runtime-payload'"));
        assert.ok(loopResult.statement.includes("'title': node_runtime_title"));
    });

    it('radar-display loop generator emits clamped single-slice state updates with snapshots', () => {
        const initGenerator = globalThis.NodeInitGenerators.webviewRadarDisplay;
        const loopGenerator = globalThis.NodeCodeGenerators.webviewRadarDisplay;
        assert.equal(typeof initGenerator, 'function');
        assert.equal(typeof loopGenerator, 'function');

        const context = {
            ...createContext(),
            inputs: ['node_parent_out3', 'node_piece_index', 'node_piece_radius'],
            outputs: ['node_out0'],
            node: {
                id: 'node-radar-1',
                type: 'radar-display',
                controlValues: {
                    maxRadiusPx: 40,
                    startAngleDeg: -120,
                    endAngleDeg: 120,
                    pieceCount: 4,
                    fillColor: '#44c9ff',
                    initialRadiusNormalized: 0.2,
                },
            },
        };

        const initResult = initGenerator(context);
        const loopResult = loopGenerator(context);
        assert.equal(typeof initResult?.statement, 'string');
        assert.equal(typeof loopResult?.statement, 'string');
        assert.ok(loopResult.statement.includes('_wv_radar_bind_key = "wv_bind_radar_'));
        assert.ok(
            loopResult.statement.includes(
                '_wv_radar_slices = _wv_radar.ensure_slices(_wv_radar.state_store()'
            )
        );
        assert.ok(
            loopResult.statement.includes(
                '_wv_radar_piece_index, _wv_radar_piece_radius, _wv_radar_snapshot = _wv_radar.apply_piece_update(_wv_radar_slices, node_piece_index, node_piece_radius, 0.2)'
            )
        );
        assert.ok(loopResult.statement.includes("'pieceIndex': _wv_radar_piece_index"));
        assert.ok(loopResult.statement.includes("'pieceRadiusNormalized': _wv_radar_piece_radius"));
        assert.ok(loopResult.statement.includes("'sliceRadiiNormalized': _wv_radar_snapshot"));
        assert.ok(loopResult.statement.includes("'kind': 'radar-display'"));
        assert.ok(context._registeredImports.includes('import otter_webview.radar as _wv_radar'));
    });

    it('joystick-display loop generator emits bounded axis updates and axis outputs', () => {
        const initGenerator = globalThis.NodeInitGenerators.webviewJoystickDisplay;
        const loopGenerator = globalThis.NodeCodeGenerators.webviewJoystickDisplay;
        assert.equal(typeof initGenerator, 'function');
        assert.equal(typeof loopGenerator, 'function');

        const context = {
            ...createContext(),
            inputs: ['node_parent_out4', 'node_use_user', 'node_axis1', 'node_axis2'],
            inputSources: [
                { fromNode: 'node-parent', fromIndex: 4, toIndex: 0 },
                { fromNode: 'node-mode-src', fromIndex: 0, toIndex: 1 },
                { fromNode: 'node-axis1-src', fromIndex: 0, toIndex: 2 },
                { fromNode: 'node-axis2-src', fromIndex: 0, toIndex: 3 },
            ],
            outputs: ['node_out0', 'node_out1', 'node_out2'],
            node: {
                id: 'node-joy-1',
                type: 'joystick-display',
                controlValues: {
                    outerRadiusPx: 58,
                    outerStrokeWidthPx: 2,
                    outerStrokeColor: '#8db5ff',
                    outerFillColor: '#111b2f',
                    innerRadiusPx: 10,
                    innerFillColor: '#70d6ff',
                    showDegreeMarks: true,
                    degreeMarkIntervalDeg: 45,
                    degreeMarkColor: '#7fa1d6',
                },
            },
        };

        const initResult = initGenerator(context);
        const loopResult = loopGenerator(context);
        assert.equal(typeof initResult?.statement, 'string');
        assert.equal(typeof loopResult?.statement, 'string');
        assert.equal(initResult?.init?.execute, undefined);
        assert.ok(loopResult.statement.includes('_wv_joystick_bind_key = "wv_bind_joystick_'));
        assert.ok(loopResult.statement.includes('# webview-runtime/strict-v1'));
        assert.ok(
            loopResult.statement.includes(
                '_wv_joystick_state = _wv_joystick.ensure_state(_wv_joystick.state_store(), "joystick:wv_bind_joystick_'
            )
        );
        assert.ok(
            loopResult.statement.includes(
                '_wv_joystick_frontend = _wv_joystick.consume_frontend_payload(web_interface_module.WEB_INTERFACE.consume_webview_values_keys, "frontend:joystick:wv_bind_joystick_'
            )
        );
        assert.ok(!loopResult.statement.includes('_wv_joystick_frontend_map ='));
        assert.ok(!loopResult.statement.includes('except TypeError:'));
        assert.ok(!loopResult.statement.includes('_wv_math = globals().get("_wv_math", None)'));
        assert.ok(!loopResult.statement.includes('import math as _wv_math'));
        assert.ok(!loopResult.statement.includes('if not isinstance(_wv_joystick_state, dict):'));
        assert.ok(
            loopResult.statement.includes(
                '_wv_joystick_use_user_mode = _wv_utils.to_bool(node_use_user, False)'
            )
        );
        assert.ok(loopResult.statement.includes('if _wv_joystick_use_user_mode:'));
        assert.ok(
            loopResult.statement.includes(
                '_wv_joystick_axis1, _wv_joystick_axis2 = _wv_joystick.resolve_output_values(_wv_joystick_state, _wv_joystick_frontend, node_axis1, node_axis2, _wv_joystick_use_user_mode)'
            )
        );
        assert.ok(loopResult.statement.includes('else:'));
        assert.ok(!loopResult.statement.includes('_wv_joystick.apply_connector_input('));
        assert.ok(!loopResult.statement.includes('_wv_joystick.write_state('));
        assert.ok(loopResult.statement.includes("'axis1': _wv_joystick_axis1"));
        assert.ok(loopResult.statement.includes("'axis2': _wv_joystick_axis2"));
        assert.ok(!loopResult.statement.includes("'angleDeg':"));
        assert.ok(!loopResult.statement.includes("'radiusNormalized':"));
        assert.ok(!loopResult.statement.includes("_wv_joystick_frontend.get('angleDeg'"));
        assert.ok(!loopResult.statement.includes("_wv_joystick_frontend.get('radiusNormalized'"));
        assert.ok(loopResult.statement.includes('node_out1 = _wv_joystick_axis1'));
        assert.ok(loopResult.statement.includes('node_out2 = _wv_joystick_axis2'));
        assert.ok(loopResult.statement.includes("'kind': 'joystick-display'"));
        assert.ok(loopResult.statement.includes("'useUserInput': _wv_joystick_use_user_mode"));
        assert.ok(context._registeredImports.includes('import math'));
        assert.ok(!context._registeredImports.includes('import math as _wv_math'));
        assert.ok(context._registeredImports.includes('import otter_webview.utils as _wv_utils'));
        assert.ok(
            context._registeredImports.includes('import otter_webview.joystick as _wv_joystick')
        );
    });

    it('joystick-display loop generator assigns the changed output from state', () => {
        const loopGenerator = globalThis.NodeCodeGenerators.webviewJoystickDisplay;
        const result = loopGenerator({
            ...createContext(),
            inputs: ['node_parent_out4', 'None', 'None', 'None'],
            outputs: ['node_out0', 'node_out1', 'node_out2', 'node_changed'],
            node: {
                id: 'node-joy-changed',
                type: 'joystick-display',
                controlValues: {},
            },
        });
        assert.equal(typeof result?.statement, 'string');
        assert.ok(
            result.statement.includes(
                "node_changed = _wv_joystick_state.get('outputChanged', False)"
            ),
            'Expected changed output assignment from joystick state'
        );
        assert.ok(result.statement.includes('node_out1 = _wv_joystick_axis1'));
        assert.ok(result.statement.includes('node_out2 = _wv_joystick_axis2'));
        assert.ok(!result.statement.includes('(no connected changed output)'));
    });

    it('joystick-display loop generator reports a missing changed output', () => {
        const loopGenerator = globalThis.NodeCodeGenerators.webviewJoystickDisplay;
        const result = loopGenerator({
            ...createContext(),
            inputs: ['node_parent_out4', 'None', 'None', 'None'],
            outputs: ['node_out0', 'node_out1', 'node_out2'],
            node: {
                id: 'node-joy-changed',
                type: 'joystick-display',
                controlValues: {},
            },
        });
        assert.equal(typeof result?.statement, 'string');
        assert.ok(
            result.statement.includes(
                '# webview:joystick-display:loop (no connected changed output)'
            )
        );
        assert.ok(!result.statement.includes("get('outputChanged', False)"));
    });

    it('joystick-display loop generator keeps connector-mode else branch valid when axes are unconnected', () => {
        const loopGenerator = globalThis.NodeCodeGenerators.webviewJoystickDisplay;
        assert.equal(typeof loopGenerator, 'function');

        const context = {
            ...createContext(),
            inputs: ['node_parent_out4', 'node_use_user', 'None', 'None'],
            inputSources: [
                { fromNode: 'node-parent', fromIndex: 4, toIndex: 0 },
                { fromNode: 'node-mode-src', fromIndex: 0, toIndex: 1 },
                null,
                null,
            ],
            outputs: ['node_out0', 'node_out1', 'node_out2'],
            node: {
                id: 'node-joy-2',
                type: 'joystick-display',
                controlValues: {},
            },
        };

        const loopResult = loopGenerator(context);
        assert.equal(typeof loopResult?.statement, 'string');
        assert.ok(loopResult.statement.includes('if _wv_joystick_use_user_mode:'));
        assert.ok(
            loopResult.statement.includes(
                "_wv_joystick_axis1, _wv_joystick_axis2 = _wv_joystick.resolve_output_values(_wv_joystick_state, _wv_joystick_frontend, _wv_joystick_state.get('axis1', 0.0), _wv_joystick_state.get('axis2', 0.0), _wv_joystick_use_user_mode)"
            )
        );
    });

    it('joystick-display defaults to connector mode when axis inputs are connected without explicit mode input', () => {
        const loopGenerator = globalThis.NodeCodeGenerators.webviewJoystickDisplay;
        assert.equal(typeof loopGenerator, 'function');

        const context = {
            ...createContext(),
            inputs: ['node_parent_out4', 'None', 'node_axis1', 'node_axis2'],
            inputSources: [
                { fromNode: 'node-parent', fromIndex: 4, toIndex: 0 },
                null,
                { fromNode: 'node-axis1-src', fromIndex: 0, toIndex: 2 },
                { fromNode: 'node-axis2-src', fromIndex: 0, toIndex: 3 },
            ],
            outputs: ['node_out0', 'node_out1', 'node_out2'],
            node: {
                id: 'node-joy-3',
                type: 'joystick-display',
                controlValues: {},
            },
        };

        const loopResult = loopGenerator(context);
        assert.equal(typeof loopResult?.statement, 'string');
        assert.ok(
            loopResult.statement.includes(
                '_wv_joystick_use_user_mode = _wv_utils.to_bool(False, False)'
            )
        );
        assert.ok(
            loopResult.statement.includes(
                '_wv_joystick_axis1, _wv_joystick_axis2 = _wv_joystick.resolve_output_values(_wv_joystick_state, _wv_joystick_frontend, node_axis1, node_axis2, _wv_joystick_use_user_mode)'
            )
        );
    });

    it('graph-display loop generator publishes a normalized series payload', () => {
        const loopGenerator = globalThis.NodeCodeGenerators.webviewGraphDisplay;
        assert.equal(typeof loopGenerator, 'function');

        const context = {
            ...createContext(),
            inputs: ['node_parent_out5', 'node_title', 'node_x_values', 'node_y_values'],
            inputSources: [
                { fromNode: 'node-parent', fromIndex: 5, toIndex: 0 },
                { fromNode: 'node-title-src', fromIndex: 0, toIndex: 1 },
                { fromNode: 'node-x-src', fromIndex: 0, toIndex: 2 },
                { fromNode: 'node-y-src', fromIndex: 0, toIndex: 3 },
            ],
            outputs: ['node_out0'],
            node: {
                id: 'node-graph-1',
                type: 'graph-display',
                controlValues: {
                    title: 'Inline Title Is Ignored',
                    heightPx: 5000,
                    tickCount: 99,
                    lineColor: 'not-a-colour',
                    xLabel: '  Time ',
                    yLabel: 'Value',
                    maxPoints: 64,
                    xRangeMode: 'manual',
                    yRangeMode: 'manual',
                    minX: -1,
                    maxX: '2.5',
                    minY: '',
                    maxY: 'nope',
                },
            },
        };

        const result = loopGenerator(context);
        assert.equal(typeof result?.statement, 'string');

        const statement = result.statement;
        const requiredFragments = [
            'node_out0 = node_parent_out5',
            '_wv_graph_bind_key = "wv_bind_graph_node_graph_1_s5"',
            '_wv_graph_x, _wv_graph_y = _wv_graph.build_series(node_x_values, node_y_values, 64)',
            'web_interface_module.WEB_INTERFACE.publish_webview_values({_wv_graph_bind_key: {',
            "'kind': 'graph-display'",
            "'title': node_title",
            "'xValues': _wv_graph_x",
            "'yValues': _wv_graph_y",
            "'heightPx': 1200",
            '\'xRangeMode\': "manual"',
            '\'yRangeMode\': "manual"',
            "'minX': -1",
            "'maxX': 2.5",
            "'minY': None",
            "'maxY': None",
            '\'xLabel\': "Time"',
            '\'yLabel\': "Value"',
            '\'lineColor\': "#70d6ff"',
            "'tickCount': 12",
            "'maxPoints': 64",
        ];
        requiredFragments.forEach((fragment) => {
            assert.ok(
                statement.includes(fragment),
                `Expected graph-display statement to include: ${fragment}`
            );
        });
        assert.ok(!statement.includes('Inline Title Is Ignored'));
        assert.ok(
            context._registeredImports.includes('import otter_webview.graph as _wv_graph'),
            'Expected the loop generator to register the graph runtime import'
        );
    });

    it('graph-display loop generator emits None for unconnected series inputs', () => {
        const loopGenerator = globalThis.NodeCodeGenerators.webviewGraphDisplay;
        assert.equal(typeof loopGenerator, 'function');

        const context = {
            ...createContext(),
            inputs: ['node_parent_out5', 'None', 'None', 'None'],
            inputSources: [null, null, null, null],
            outputs: ['node_out0'],
            node: {
                id: 'node-graph-2',
                type: 'graph-display',
                controlValues: {},
            },
        };

        const statement = loopGenerator(context)?.statement ?? '';
        assert.ok(
            statement.includes('_wv_graph_x, _wv_graph_y = _wv_graph.build_series(None, None, 256)')
        );
        assert.ok(statement.includes('\'title\': "Line Graph"'));
        assert.ok(statement.includes("'maxPoints': 256"));
        assert.ok(statement.includes('\'lineColor\': "#70d6ff"'));
        assert.ok(statement.includes("'tickCount': 5"));
        assert.ok(statement.includes('node_out0 = node_parent_out5'));
    });

    it('graph-display implementation normalizes controls and runtime payload', () => {
        const shared = globalThis.WebviewGeneratorShared;
        const implementation = shared.getNodeKindImplementation('graph-display', {
            required: true,
        });

        const normalized = implementation.normalizeControls({
            title: '   ',
            heightPx: '4',
            tickCount: 1,
            lineColor: '#ABCDEF',
            xLabel: '  Time ',
            yLabel: 'Value',
            maxPoints: 9000,
            xRangeMode: 'MANUAL',
            yRangeMode: 'sorted',
            minX: 'not-a-number',
            maxX: 12,
        });

        assert.deepEqual(normalized, {
            title: 'Line Graph',
            heightPx: 80,
            tickCount: 2,
            maxPoints: 2048,
            lineColor: '#ABCDEF',
            xRangeMode: 'manual',
            yRangeMode: 'auto',
            minX: null,
            maxX: 12,
            minY: null,
            maxY: null,
            xLabel: 'Time',
            yLabel: 'Value',
        });

        assert.deepEqual(implementation.getWebserverCapabilities(), {
            needsWebDataStore: true,
            requiresPostRefresh: true,
        });

        const payload = implementation.renderRuntimePayload({
            controls: { title: 'Pressure', maxPoints: 3 },
            formatLiteral: (value) => JSON.stringify(value),
        });
        assert.equal(typeof payload, 'string');
        assert.ok(payload.includes("'kind': 'graph-display'"));
        assert.ok(payload.includes('\'title\': "Pressure"'));
        assert.ok(payload.includes("'xValues': []"));
        assert.ok(payload.includes("'maxPoints': 3"));

        const helpers = implementation.renderClientHelpers();
        assert.ok(Array.isArray(helpers));
        const helperSource = helpers.join('\n');
        assert.ok(helperSource.includes('function drawGraphDisplay(targetElement)'));
        assert.ok(helperSource.includes('function ensureGraphResizeObserver(targetElement)'));
        assert.ok(helperSource.includes('function resolveGraphRange('));
        assert.ok(helperSource.includes('canvas.getContext("2d")'));
        assert.ok(helperSource.includes('window.devicePixelRatio'));
        assert.ok(helperSource.includes('typeof ResizeObserver !== "function"'));
        assert.ok(helperSource.includes('normalizeGraphRangeMode(mode) === "manual"'));
        assert.ok(helperSource.includes('return { min: -1, max: 1 };'));
        assert.ok(helperSource.includes('return { min: low - 0.5, max: high + 0.5 };'));
        assert.ok(helperSource.includes('function formatGraphTick(value, span) {'));

        const initHooks = implementation.renderClientInitHooks();
        assert.equal(initHooks.length, 1);
        assert.ok(initHooks[0].includes('.wv-graph-display'));

        const styleRules = implementation.renderClientStyleRules();
        assert.ok(styleRules.some((rule) => rule.includes('.wv-graph-display')));
        assert.ok(styleRules.some((rule) => rule.includes('.wv-graph-title')));
        assert.ok(styleRules.some((rule) => rule.includes('.wv-graph-canvas')));
        const selectorPattern = /^\s*(\.[a-z0-9-]+)\s*\{/i;
        styleRules.forEach((rule) => {
            const match = selectorPattern.exec(String(rule));
            assert.ok(match, `Expected a single class selector rule: ${rule}`);
            assert.ok(
                ['.wv-graph-display', '.wv-graph-title', '.wv-graph-canvas'].includes(match[1]),
                `Unexpected graph style selector: ${match[1]}`
            );
        });
    });

    it('joystick behavior parity is preserved for user and connector modes', () => {
        const userMode = computeJoystickParityState({
            useUserInput: true,
            frontend: { axis1: 2, axis2: 0 },
            axis1Input: null,
            axis2Input: null,
        });

        assert.ok(Math.abs(userMode.axis1 - 1) < 1e-9);
        assert.ok(Math.abs(userMode.axis2 - 0) < 1e-9);

        const connectorMode = computeJoystickParityState({
            useUserInput: false,
            frontend: null,
            axis1Input: 2,
            axis2Input: 2,
        });

        assert.ok(Math.abs(connectorMode.axis1 - 1) < 1e-9);
        assert.ok(Math.abs(connectorMode.axis2 - 1) < 1e-9);
    });

    it('strict joystick loop generation excludes legacy defensive anti-patterns', () => {
        const loopGenerator = globalThis.NodeCodeGenerators.webviewJoystickDisplay;
        assert.equal(typeof loopGenerator, 'function');

        const context = {
            ...createContext(),
            inputs: ['node_parent_out4', 'node_use_user', 'node_axis1', 'node_axis2'],
            inputSources: [
                { fromNode: 'node-parent', fromIndex: 4, toIndex: 0 },
                { fromNode: 'node-mode-src', fromIndex: 0, toIndex: 1 },
                { fromNode: 'node-axis1-src', fromIndex: 0, toIndex: 2 },
                { fromNode: 'node-axis2-src', fromIndex: 0, toIndex: 3 },
            ],
            outputs: ['node_out0', 'node_out1', 'node_out2'],
            node: {
                id: 'node-joy-strict-check',
                type: 'joystick-display',
                controlValues: {},
            },
        };

        const loopResult = loopGenerator(context);
        assert.equal(typeof loopResult?.statement, 'string');

        const antiPatterns = [
            '_wv_math = globals().get("_wv_math", None)',
            'import math as _wv_math',
            'except TypeError:',
            'try:\n        _wv_joystick_axis1 = float(node_axis1)',
            'if not isinstance(_wv_joystick_state, dict):',
            "_wv_joystick_frontend.get('angleDeg'",
            "_wv_joystick_frontend.get('radiusNormalized'",
        ];
        antiPatterns.forEach((pattern) => {
            assert.ok(
                !loopResult.statement.includes(pattern),
                `Expected strict generator to omit anti-pattern: ${pattern}`
            );
        });

        const helperPatterns = [
            '_wv_utils.to_bool(node_use_user, False)',
            '_wv_joystick.consume_frontend_payload(web_interface_module.WEB_INTERFACE.consume_webview_values_keys, "frontend:joystick:wv_bind_joystick_',
            '_wv_joystick.resolve_output_values(_wv_joystick_state, _wv_joystick_frontend, node_axis1, node_axis2, _wv_joystick_use_user_mode)',
            '# webview-runtime/strict-v1',
        ];
        helperPatterns.forEach((pattern) => {
            assert.ok(
                loopResult.statement.includes(pattern),
                `Expected strict generator helper form: ${pattern}`
            );
        });
    });

    it('emits module-based helper/joystick forms without inline boilerplate duplication', () => {
        const initGenerator = globalThis.NodeInitGenerators.webviewJoystickDisplay;
        const loopGenerator = globalThis.NodeCodeGenerators.webviewJoystickDisplay;
        assert.equal(typeof initGenerator, 'function');
        assert.equal(typeof loopGenerator, 'function');

        const context = {
            ...createContext(),
            inputs: ['node_parent_out4', 'node_use_user', 'node_axis1', 'node_axis2'],
            inputSources: [
                { fromNode: 'node-parent', fromIndex: 4, toIndex: 0 },
                { fromNode: 'node-mode-src', fromIndex: 0, toIndex: 1 },
                { fromNode: 'node-axis1-src', fromIndex: 0, toIndex: 2 },
                { fromNode: 'node-axis2-src', fromIndex: 0, toIndex: 3 },
            ],
            outputs: ['node_out0', 'node_out1', 'node_out2'],
            node: {
                id: 'node-joy-regression-shape',
                type: 'joystick-display',
                controlValues: {},
            },
        };

        const initResult = initGenerator(context);
        const loopResult = loopGenerator(context);

        assert.equal(initResult?.init?.execute, undefined);
        assert.equal(typeof loopResult?.statement, 'string');

        const loopStatement = loopResult.statement;
        const requiredModuleCalls = [
            '_wv_joystick.ensure_state(_wv_joystick.state_store(), "joystick:wv_bind_joystick_',
            '_wv_joystick.consume_frontend_payload(web_interface_module.WEB_INTERFACE.consume_webview_values_keys, "frontend:joystick:wv_bind_joystick_',
            '_wv_utils.to_bool(node_use_user, False)',
            '_wv_joystick.resolve_output_values(_wv_joystick_state, _wv_joystick_frontend, node_axis1, node_axis2, _wv_joystick_use_user_mode)',
        ];
        requiredModuleCalls.forEach((pattern) => {
            assert.ok(
                loopStatement.includes(pattern),
                `Expected strict module call pattern: ${pattern}`
            );
        });

        const forbiddenInlineJoystickBoilerplate = [
            '_wv_joystick_frontend_map = _wv_joystick_consume([_wv_joystick_frontend_key], clear_after_read=True)',
            '_wv_joystick_axis_magnitude = (_wv_joystick_axis1 ** 2 + _wv_joystick_axis2 ** 2) ** 0.5',
            'while _wv_joystick_angle_deg < 0.0:',
            'while _wv_joystick_angle_deg >= 360.0:',
            '_wv_joystick_angle_rad = (_wv_joystick_angle_deg - 90.0) * (math.pi / 180.0)',
            "'angleDeg':",
            "'radiusNormalized':",
            '_WEBVIEW_TO_BOOL(',
            '_WEBVIEW_TO_FLOAT(',
            '_WEBVIEW_CLAMP(',
        ];
        forbiddenInlineJoystickBoilerplate.forEach((pattern) => {
            assert.ok(
                !loopStatement.includes(pattern),
                `Expected strict generator to omit inline joystick boilerplate: ${pattern}`
            );
        });

        assert.ok(!/\b_wv_math\b/.test(loopStatement));
        assert.ok(context._registeredImports.includes('import math'));
        assert.ok(!context._registeredImports.includes('import math as _wv_math'));
        assert.ok(context._registeredImports.includes('import otter_webview.utils as _wv_utils'));
        assert.ok(
            context._registeredImports.includes('import otter_webview.joystick as _wv_joystick')
        );
    });

    it('init generators emit only connected structural outputs', () => {
        const rowInitGenerator = globalThis.NodeInitGenerators.webviewRow;
        assert.equal(typeof rowInitGenerator, 'function');

        const rowResult = rowInitGenerator({
            ...createContext(),
            inputs: ['node_parent', 'None', 'None'],
            outputs: ['node_row_out0', 'node_row_out1', 'node_row_out2', 'node_row_out3'],
            outputsMeta: [
                { connected: true },
                { connected: false },
                { connected: true },
                { connected: false },
            ],
            node: {
                id: 'node-row',
                type: 'row',
                title: 'Row',
            },
        });

        assert.equal(typeof rowResult?.statement, 'string');
        assert.ok(rowResult.statement.includes('node_row_out0 = node_parent'));
        assert.ok(rowResult.statement.includes('node_row_out2 = node_parent'));
        assert.ok(!rowResult.statement.includes('node_row_out1 = node_parent'));
        assert.ok(!rowResult.statement.includes('node_row_out3 = node_parent'));

        const columnInitGenerator = globalThis.NodeInitGenerators.webviewColumn;
        assert.equal(typeof columnInitGenerator, 'function');

        const columnResult = columnInitGenerator({
            ...createContext(),
            inputs: ['node_parent', 'None', 'None'],
            outputs: ['node_col_out0', 'node_col_out1'],
            outputsMeta: [{ connected: false }, { connected: false }],
            node: {
                id: 'node-col',
                type: 'column',
                title: 'Column',
            },
        });

        assert.equal(typeof columnResult?.statement, 'string');
        assert.ok(columnResult.statement.includes('no connected outputs'));
        assert.ok(!columnResult.statement.includes('node_col_out0 ='));
        assert.ok(!columnResult.statement.includes('node_col_out1 ='));
    });

    it('helper generators return helper contribution payloads', () => {
        const names = [
            'webviewRoot',
            'webviewPage',
            'webviewRow',
            'webviewColumn',
            'webviewContent',
            'webviewValueTable',
            'webviewRadarDisplay',
            'webviewJoystickDisplay',
            'webviewGraphDisplay',
            'webviewTitleContent',
        ];

        names.forEach((name) => {
            const generator = globalThis.NodeHelperGenerators[name];
            assert.equal(typeof generator, 'function', `Expected helper generator ${name}`);

            const result = generator({
                ...createContext(),
                node: {
                    id: 'node-42',
                    type: 'content',
                    controlValues: {
                        title: 'Example',
                        value: 7,
                        headingLevel: 3,
                        rowCount: 2,
                        columnCount: 2,
                    },
                },
            });

            assert.equal(result?.schemaVersion, 'transpiler-helper-contribution/v1');
            assert.equal(result?.helperGroup, 'web-runtime');
            assert.ok(result?.data);
            assert.ok(result?.data['webNode:node-42']);

            const isDynamicNode =
                name === 'webviewContent' ||
                name === 'webviewValueTable' ||
                name === 'webviewRadarDisplay' ||
                name === 'webviewJoystickDisplay' ||
                name === 'webviewGraphDisplay' ||
                name === 'webviewTitleContent';
            if (isDynamicNode) {
                assert.equal(result?.webserverSpecPatch?.needsWebDataStore, true);
                assert.equal(result?.webserverSpecPatch?.requiresPostRefresh, true);
            } else {
                assert.notEqual(result?.webserverSpecPatch?.needsWebDataStore, true);
                assert.notEqual(result?.webserverSpecPatch?.requiresPostRefresh, true);
            }
        });
    });

    it('uses contributor-declared webserver capabilities in helper contributions', () => {
        const shared = globalThis.WebviewGeneratorShared;
        const contributorNodeKind = 'test-web-capabilities';
        shared.registerNodeKindContributor(contributorNodeKind, {
            getWebserverCapabilities() {
                return {
                    needsWebDataStore: true,
                    requiresPostRefresh: true,
                };
            },
        });

        const helperGenerator = shared.createHelperContributionGenerator(contributorNodeKind, 99);
        const result = helperGenerator({
            ...createContext(),
            node: {
                id: 'node-capabilities',
                type: contributorNodeKind,
                controlValues: {},
            },
            inputs: ['None'],
        });

        assert.equal(result?.webserverSpecPatch?.needsWebDataStore, true);
        assert.equal(result?.webserverSpecPatch?.requiresPostRefresh, true);
    });

    it('scopes helper contribution keys by graph id when graph context is available', () => {
        const generator = globalThis.NodeHelperGenerators.webviewPage;
        assert.equal(typeof generator, 'function');

        const result = generator({
            ...createContext(),
            graph: {
                id: 'graph-2',
                name: 'Graph 2',
            },
            node: {
                id: '1',
                type: 'web-page',
                controlValues: {
                    pageName: 'Reports',
                },
            },
        });

        assert.equal(result?.schemaVersion, 'transpiler-helper-contribution/v1');
        assert.ok(result?.data?.['webNode:graph-2:1']);
        assert.equal(result?.data?.['webNode:graph-2:1']?.id, '1');
        assert.equal(result?.data?.['webNode:graph-2:1']?.graphId, 'graph-2');
        assert.equal(result?.data?.['webNode:graph-2:1']?.scopedId, 'graph-2:1');
        assert.equal(result?.orderKey, '20:graph-2:1');
    });

    it('delegates node-kind layout rendering to shared contributor hooks when registered', async () => {
        const shared = globalThis.WebviewGeneratorShared;
        assert.equal(typeof shared?.registerNodeKindContributor, 'function');
        assert.equal(typeof shared?.unregisterNodeKindContributor, 'function');
        let capturedRenderContextKeys = [];

        const existing = shared.getNodeKindContributor('content');
        if (existing) {
            shared.unregisterNodeKindContributor('content');
        }

        try {
            shared.registerNodeKindContributor('content', {
                renderMarkup(context) {
                    capturedRenderContextKeys = Object.keys(context || {}).sort();
                    return [
                        `${context.indent}<div class="wv-content" data-wv-step4-delegated="true" data-node-id="${context.nodeId}"></div>`,
                    ];
                },
            });

            const consumer = globalThis.NodeHelperHandoffConsumers['web-runtime'];
            assert.equal(typeof consumer, 'function');

            const result = await consumer({
                group: {
                    mergedData: {
                        'webNode:node-root': {
                            id: 'node-root',
                            kind: 'web-root',
                            controls: { title: 'Delegation Test' },
                        },
                        'webNode:node-content': {
                            id: 'node-content',
                            kind: 'content',
                            controls: { title: 'Should be overridden', value: 123 },
                            layout: {
                                parentNodeId: 'node-root',
                                parentOutputIndex: 0,
                            },
                        },
                    },
                    webserverSpecPatch: {
                        disableCompressedAssets: true,
                    },
                },
                collection: {
                    id: 'collection-step4-delegation',
                    title: 'Delegation Collection',
                    webAssetGenerationMode: 'plain',
                },
            });

            const artifacts = Array.isArray(result?.artifacts) ? result.artifacts : [];
            const indexArtifact = artifacts.find(
                (artifact) =>
                    artifact.targetPath ===
                    'collection/webview/collection-step4-delegation/index.html'
            );

            assert.ok(indexArtifact, 'Expected generated index artifact for delegation test');
            const indexHtml = String(indexArtifact.content || '');
            assert.match(indexHtml, /data-wv-step4-delegated="true"/);
            assert.match(indexHtml, /data-node-id="node-content"/);
            assert.equal(capturedRenderContextKeys.includes('buildRadarBoundaryPathData'), false);
            assert.equal(capturedRenderContextKeys.includes('buildRadarArcPathData'), false);
            assert.equal(capturedRenderContextKeys.includes('buildRadarSlicePathData'), false);
            assert.equal(capturedRenderContextKeys.includes('buildJoystickInnerPosition'), false);
            assert.equal(capturedRenderContextKeys.includes('buildJoystickMarkLines'), false);
        } finally {
            shared.unregisterNodeKindContributor('content');
            if (existing) {
                shared.registerNodeKindContributor('content', existing);
            }
        }
    });

    it('registers content node contributor with markup and client update handler surfaces', () => {
        const shared = globalThis.WebviewGeneratorShared;
        assert.ok(shared, 'Expected WebviewGeneratorShared global export');

        const contentContributor = shared.getNodeKindContributor('content', { required: true });
        assert.equal(typeof contentContributor?.renderMarkup, 'function');
        assert.equal(typeof contentContributor?.renderClientUpdateHandler, 'function');

        const handlerLines = contentContributor.renderClientUpdateHandler({ nodeKind: 'content' });
        assert.ok(Array.isArray(handlerLines));
        assert.ok(
            handlerLines.some((line) =>
                String(line).includes('function applyContentUpdate(targetElement, entry) {')
            )
        );
    });

    it('uses content contributor override for generated applyContentUpdate handler', async () => {
        const shared = globalThis.WebviewGeneratorShared;
        const existing = shared.getNodeKindContributor('content');
        assert.ok(existing, 'Expected baseline content contributor before override test');

        shared.unregisterNodeKindContributor('content');
        try {
            shared.registerNodeKindContributor('content', {
                renderMarkup: existing.renderMarkup,
                renderClientUpdateHandler() {
                    return [
                        'function applyContentUpdate(targetElement, entry) {',
                        '  // step5 contributor override marker',
                        '  if (!targetElement) {',
                        '    return false;',
                        '  }',
                        '  targetElement.setAttribute("data-step5-override", "true");',
                        '  if (hasOwnProperty(entry, "value")) {',
                        '    targetElement.textContent = String(entry.value ?? "");',
                        '    return true;',
                        '  }',
                        '  return false;',
                        '}',
                    ];
                },
            });

            const consumer = globalThis.NodeHelperHandoffConsumers['web-runtime'];
            assert.equal(typeof consumer, 'function');

            const result = await consumer({
                group: {
                    mergedData: {
                        'webNode:node-root': {
                            id: 'node-root',
                            kind: 'web-root',
                            controls: { title: 'Step 5 Override' },
                        },
                        'webNode:node-content': {
                            id: 'node-content',
                            kind: 'content',
                            controls: { title: 'Temperature', value: 22 },
                            layout: {
                                parentNodeId: 'node-root',
                                parentOutputIndex: 0,
                            },
                        },
                    },
                    webserverSpecPatch: {
                        disableCompressedAssets: true,
                    },
                },
                collection: {
                    id: 'collection-step5-override',
                    title: 'Step 5 Override Collection',
                    webAssetGenerationMode: 'plain',
                },
            });

            const artifacts = Array.isArray(result?.artifacts) ? result.artifacts : [];
            const clientArtifact = artifacts.find(
                (artifact) =>
                    artifact.targetPath ===
                    'collection/webview/collection-step5-override/webview_client.js'
            );
            assert.ok(
                clientArtifact,
                'Expected generated client script artifact for override test'
            );
            const clientSource = String(clientArtifact.content || '');
            assert.match(clientSource, /step5 contributor override marker/);
            assert.match(clientSource, /data-step5-override/);
        } finally {
            shared.unregisterNodeKindContributor('content');
            shared.registerNodeKindContributor('content', existing);
        }
    });

    it('registers value-table contributor with markup and client update handler surfaces', () => {
        const shared = globalThis.WebviewGeneratorShared;
        const contributor = shared.getNodeKindContributor('value-table', { required: true });

        assert.equal(typeof contributor?.renderMarkup, 'function');
        assert.equal(typeof contributor?.renderClientUpdateHandler, 'function');

        const handlerLines = contributor.renderClientUpdateHandler({ nodeKind: 'value-table' });
        assert.ok(Array.isArray(handlerLines));
        assert.ok(
            handlerLines.some((line) =>
                String(line).includes('function applyValueTableUpdate(targetElement, entry) {')
            )
        );
        assert.ok(
            handlerLines.some((line) =>
                String(line).includes('const decimalPlaces = Number.isFinite')
            )
        );
        assert.ok(
            handlerLines.some((line) =>
                String(line).includes('return numericValue.toFixed(decimalPlaces);')
            )
        );
        assert.ok(
            handlerLines.some((line) => String(line).includes('return String(value ?? "");'))
        );
    });

    it('formats value-table numeric cells using decimalPlaces while preserving non-numeric values', () => {
        const shared = globalThis.WebviewGeneratorShared;
        const contributor = shared.getNodeKindContributor('value-table', { required: true });
        const handlerLines = contributor.renderClientUpdateHandler({ nodeKind: 'value-table' });
        const handlerSource = Array.isArray(handlerLines) ? handlerLines.join('\n') : '';
        const applyValueTableUpdate = new Function(
            `${handlerSource}\nreturn applyValueTableUpdate;`
        )();

        const dom = new JSDOM('<!doctype html><html><body></body></html>');
        const targetElement = dom.window.document.createElement('div');
        targetElement.innerHTML =
            '<table class="wv-value-table-grid"><tbody>' +
            '<tr class="wv-value-table-row" data-wv-row-index="1"><td data-wv-cell-role="label"></td><td data-wv-cell-role="value"></td></tr>' +
            '<tr class="wv-value-table-row" data-wv-row-index="2"><td data-wv-cell-role="label"></td><td data-wv-cell-role="value"></td></tr>' +
            '</tbody></table>';

        const updated = applyValueTableUpdate(targetElement, {
            decimalPlaces: 3,
            rows: [
                { label: 'Speed', value: 1.23456 },
                { label: 'Mode', value: 'AUTO' },
            ],
        });

        assert.equal(updated, true);

        const rows = Array.from(targetElement.querySelectorAll('[data-wv-row-index]'));
        assert.equal(rows.length, 2);
        assert.equal(rows[0]?.querySelector('[data-wv-cell-role=label]')?.textContent, 'Speed');
        assert.equal(rows[0]?.querySelector('[data-wv-cell-role=value]')?.textContent, '1.235');
        assert.equal(rows[1]?.querySelector('[data-wv-cell-role=label]')?.textContent, 'Mode');
        assert.equal(rows[1]?.querySelector('[data-wv-cell-role=value]')?.textContent, 'AUTO');
        assert.equal(targetElement.getAttribute('data-wv-decimal-places'), '3');

        applyValueTableUpdate(targetElement, {
            decimalPlaces: 0,
            rows: [{ label: 'Rounded', value: 9.6 }],
        });
        assert.equal(targetElement.querySelector('[data-wv-cell-role=value]')?.textContent, '10');

        applyValueTableUpdate(targetElement, {
            decimalPlaces: 99,
            rows: [{ label: 'Clamped', value: 1.23456789 }],
        });
        assert.equal(
            targetElement.querySelector('[data-wv-cell-role=value]')?.textContent,
            '1.234568'
        );
        assert.equal(targetElement.getAttribute('data-wv-decimal-places'), '6');
    });

    it('defines fixed value-table title/value spacing style contract', () => {
        const shared = globalThis.WebviewGeneratorShared;
        const contributor = shared.getNodeKindContributor('value-table', { required: true });
        const styleLines = contributor.renderClientStyleRules({ nodeKind: 'value-table' });

        assert.ok(Array.isArray(styleLines));
        assert.ok(
            styleLines.some(
                (line) =>
                    String(line).includes('.wv-value-table-label') &&
                    String(line).includes('padding-right: 14px;') &&
                    String(line).includes('min-width: 8ch;')
            )
        );
        assert.ok(
            styleLines.some(
                (line) =>
                    String(line).includes('.wv-value-table-value') &&
                    String(line).includes('min-width: 10ch;')
            )
        );
    });

    it('uses value-table contributor override for generated applyValueTableUpdate handler', async () => {
        const shared = globalThis.WebviewGeneratorShared;
        const existing = shared.getNodeKindContributor('value-table');
        assert.ok(existing, 'Expected baseline value-table contributor before override test');

        shared.unregisterNodeKindContributor('value-table');
        try {
            shared.registerNodeKindContributor('value-table', {
                renderMarkup: existing.renderMarkup,
                renderClientUpdateHandler() {
                    return [
                        'function applyValueTableUpdate(targetElement, entry) {',
                        '  // step6 value-table override marker',
                        '  if (!targetElement || !Array.isArray(entry.rows)) {',
                        '    return false;',
                        '  }',
                        '  targetElement.setAttribute("data-step6-vtable", String(entry.rows.length));',
                        '  return true;',
                        '}',
                    ];
                },
            });

            const consumer = globalThis.NodeHelperHandoffConsumers['web-runtime'];
            const result = await consumer({
                group: {
                    mergedData: {
                        'webNode:node-root': {
                            id: 'node-root',
                            kind: 'web-root',
                            controls: { title: 'Step 6 Override' },
                        },
                        'webNode:node-vtable': {
                            id: 'node-vtable',
                            kind: 'value-table',
                            controls: { rowCount: 3 },
                            layout: {
                                parentNodeId: 'node-root',
                                parentOutputIndex: 0,
                            },
                        },
                    },
                    webserverSpecPatch: {
                        disableCompressedAssets: true,
                    },
                },
                collection: {
                    id: 'collection-step6-override',
                    title: 'Step 6 Override Collection',
                    webAssetGenerationMode: 'plain',
                },
            });

            const artifacts = Array.isArray(result?.artifacts) ? result.artifacts : [];
            const clientArtifact = artifacts.find(
                (artifact) =>
                    artifact.targetPath ===
                    'collection/webview/collection-step6-override/webview_client.js'
            );
            assert.ok(clientArtifact, 'Expected generated client script artifact for step 6 test');
            const clientSource = String(clientArtifact.content || '');
            assert.match(clientSource, /step6 value-table override marker/);
            assert.match(clientSource, /data-step6-vtable/);
        } finally {
            shared.unregisterNodeKindContributor('value-table');
            shared.registerNodeKindContributor('value-table', existing);
        }
    });

    it('registers radar-display contributor with markup and client update handler surfaces', () => {
        const shared = globalThis.WebviewGeneratorShared;
        const contributor = shared.getNodeKindContributor('radar-display', { required: true });

        assert.equal(typeof contributor?.renderMarkup, 'function');
        assert.equal(typeof contributor?.renderClientUpdateHandler, 'function');

        const handlerLines = contributor.renderClientUpdateHandler({ nodeKind: 'radar-display' });
        assert.ok(Array.isArray(handlerLines));
        assert.ok(
            handlerLines.some((line) =>
                String(line).includes('function applyRadarDisplayUpdate(targetElement, entry) {')
            )
        );
    });

    it('uses radar contributor override for generated applyRadarDisplayUpdate handler', async () => {
        const shared = globalThis.WebviewGeneratorShared;
        const existing = shared.getNodeKindContributor('radar-display');
        assert.ok(existing, 'Expected baseline radar contributor before override test');

        shared.unregisterNodeKindContributor('radar-display');
        try {
            shared.registerNodeKindContributor('radar-display', {
                renderMarkup: existing.renderMarkup,
                renderClientUpdateHandler() {
                    return [
                        'function applyRadarDisplayUpdate(targetElement, entry) {',
                        '  // step7 radar override marker',
                        '  if (!targetElement || !entry || typeof entry !== "object") {',
                        '    return false;',
                        '  }',
                        '  targetElement.setAttribute("data-step7-radar", "true");',
                        '  return true;',
                        '}',
                    ];
                },
            });

            const consumer = globalThis.NodeHelperHandoffConsumers['web-runtime'];
            const result = await consumer({
                group: {
                    mergedData: {
                        'webNode:node-root': {
                            id: 'node-root',
                            kind: 'web-root',
                            controls: { title: 'Step 7 Override' },
                        },
                        'webNode:node-radar': {
                            id: 'node-radar',
                            kind: 'radar-display',
                            controls: { pieceCount: 4 },
                            layout: {
                                parentNodeId: 'node-root',
                                parentOutputIndex: 0,
                            },
                        },
                    },
                    webserverSpecPatch: {
                        disableCompressedAssets: true,
                    },
                },
                collection: {
                    id: 'collection-step7-override',
                    title: 'Step 7 Override Collection',
                    webAssetGenerationMode: 'plain',
                },
            });

            const artifacts = Array.isArray(result?.artifacts) ? result.artifacts : [];
            const clientArtifact = artifacts.find(
                (artifact) =>
                    artifact.targetPath ===
                    'collection/webview/collection-step7-override/webview_client.js'
            );
            assert.ok(clientArtifact, 'Expected generated client script artifact for step 7 test');
            const clientSource = String(clientArtifact.content || '');
            assert.match(clientSource, /step7 radar override marker/);
            assert.match(clientSource, /data-step7-radar/);
        } finally {
            shared.unregisterNodeKindContributor('radar-display');
            shared.registerNodeKindContributor('radar-display', existing);
        }
    });

    it('registers joystick-display contributor with markup and client update handler surfaces', () => {
        const shared = globalThis.WebviewGeneratorShared;
        const contributor = shared.getNodeKindContributor('joystick-display', { required: true });

        assert.equal(typeof contributor?.renderMarkup, 'function');
        assert.equal(typeof contributor?.renderClientUpdateHandler, 'function');

        const handlerLines = contributor.renderClientUpdateHandler({
            nodeKind: 'joystick-display',
        });
        assert.ok(Array.isArray(handlerLines));
        assert.ok(
            handlerLines.some((line) =>
                String(line).includes('function applyJoystickDisplayUpdate(targetElement, entry) {')
            )
        );
    });

    it('uses joystick contributor override for generated applyJoystickDisplayUpdate handler', async () => {
        const shared = globalThis.WebviewGeneratorShared;
        const existing = shared.getNodeKindContributor('joystick-display');
        assert.ok(existing, 'Expected baseline joystick contributor before override test');

        shared.unregisterNodeKindContributor('joystick-display');
        try {
            shared.registerNodeKindContributor('joystick-display', {
                renderMarkup: existing.renderMarkup,
                renderClientUpdateHandler() {
                    return [
                        'function applyJoystickDisplayUpdate(targetElement, entry) {',
                        '  // step8 joystick override marker',
                        '  if (!targetElement || !entry || typeof entry !== "object") {',
                        '    return false;',
                        '  }',
                        '  targetElement.setAttribute("data-step8-joystick", "true");',
                        '  return true;',
                        '}',
                    ];
                },
            });

            const consumer = globalThis.NodeHelperHandoffConsumers['web-runtime'];
            const result = await consumer({
                group: {
                    mergedData: {
                        'webNode:node-root': {
                            id: 'node-root',
                            kind: 'web-root',
                            controls: { title: 'Step 8 Override' },
                        },
                        'webNode:node-joystick': {
                            id: 'node-joystick',
                            kind: 'joystick-display',
                            controls: { outerRadiusPx: 52 },
                            layout: {
                                parentNodeId: 'node-root',
                                parentOutputIndex: 0,
                            },
                        },
                    },
                    webserverSpecPatch: {
                        disableCompressedAssets: true,
                    },
                },
                collection: {
                    id: 'collection-step8-override',
                    title: 'Step 8 Override Collection',
                    webAssetGenerationMode: 'plain',
                },
            });

            const artifacts = Array.isArray(result?.artifacts) ? result.artifacts : [];
            const clientArtifact = artifacts.find(
                (artifact) =>
                    artifact.targetPath ===
                    'collection/webview/collection-step8-override/webview_client.js'
            );
            assert.ok(clientArtifact, 'Expected generated client script artifact for step 8 test');
            const clientSource = String(clientArtifact.content || '');
            assert.match(clientSource, /step8 joystick override marker/);
            assert.match(clientSource, /data-step8-joystick/);
        } finally {
            shared.unregisterNodeKindContributor('joystick-display');
            shared.registerNodeKindContributor('joystick-display', existing);
        }
    });

    it('registers graph-display contributor with markup and client update handler surfaces', () => {
        const shared = globalThis.WebviewGeneratorShared;
        const contributor = shared.getNodeKindContributor('graph-display', { required: true });

        assert.equal(typeof contributor?.renderMarkup, 'function');
        assert.equal(typeof contributor?.renderClientUpdateHandler, 'function');

        const handlerLines = contributor.renderClientUpdateHandler({
            nodeKind: 'graph-display',
        });
        assert.ok(Array.isArray(handlerLines));
        assert.ok(
            handlerLines.some((line) =>
                String(line).includes('function applyGraphDisplayUpdate(targetElement, entry) {')
            )
        );
        assert.ok(
            handlerLines.some((line) => String(line).includes('drawGraphDisplay(targetElement);'))
        );
    });

    it('graph-display renderMarkup emits canvas host attributes', () => {
        const shared = globalThis.WebviewGeneratorShared;
        const implementation = shared.getNodeKindImplementation('graph-display');

        const lines = implementation.renderMarkup({
            indent: '  ',
            childIndent: '    ',
            nodeId: 'node-graph-42',
            element: {
                binding: {
                    elementId: 'wv_el_graph_node-graph-42_s0',
                    payloadKey: 'wv_bind_graph_node_graph_42_s0',
                },
                controls: {
                    title: 'Temperature',
                    heightPx: 300,
                    tickCount: 6,
                    lineColor: '#123456',
                    xLabel: 'Time',
                    yLabel: 'C',
                    xRangeMode: 'manual',
                    minX: 0,
                    maxX: 10,
                },
            },
            helpers: {
                escapeHtml: (value) => String(value ?? ''),
            },
        });

        const html = lines.join('\n');
        assert.ok(html.includes('id="wv_el_graph_node-graph-42_s0"'));
        assert.ok(html.includes('class="wv-content wv-graph-display"'));
        assert.ok(html.includes('data-wv-payload-key="wv_bind_graph_node_graph_42_s0"'));
        assert.ok(html.includes('data-wv-title="Temperature"'));
        assert.ok(html.includes('data-wv-height-px="300"'));
        assert.ok(html.includes('data-wv-tick-count="6"'));
        assert.ok(html.includes('data-wv-line-color="#123456"'));
        assert.ok(html.includes('data-wv-x-range-mode="manual"'));
        assert.ok(html.includes('data-wv-min-x="0"'));
        assert.ok(html.includes('data-wv-max-x="10"'));
        assert.ok(html.includes('data-wv-max-y=""'));
        assert.ok(html.includes('data-wv-x-label="Time"'));
        assert.ok(html.includes('<div class="wv-graph-title">Temperature</div>'));
        assert.ok(html.includes('<canvas class="wv-graph-canvas"'));
    });

    /**
     * Builds a generated graph client inside its own jsdom realm.
     * @param {object} options - Build options.
     * @param {string} options.collectionId - Collection id used for the generated artifact paths.
     * @param {object} [options.controls] - Graph node control values merged over the fixture defaults.
     * @param {(context: object) => void} [options.prepare] - Runs before `eval` with the window, elements, and recorder.
     * @returns {Promise<object>} The jsdom handle together with the generated graph elements.
     */
    async function buildGraphClient({ collectionId, controls = {}, prepare = null }) {
        const consumer = globalThis.NodeHelperHandoffConsumers['web-runtime'];
        assert.equal(typeof consumer, 'function');

        const result = await consumer({
            group: {
                mergedData: {
                    'webNode:node-root': {
                        id: 'node-root',
                        kind: 'web-root',
                        controls: { title: 'Graph' },
                    },
                    'webNode:node-graph': {
                        id: 'node-graph',
                        kind: 'graph-display',
                        controls: {
                            title: 'Pressure',
                            heightPx: 200,
                            tickCount: 4,
                            lineColor: '#70d6ff',
                            xLabel: 'Time',
                            yLabel: 'kPa',
                            maxPoints: 16,
                            ...controls,
                        },
                        layout: { parentNodeId: 'node-root', parentOutputIndex: 0 },
                    },
                },
                webserverSpecPatch: {
                    needsWebDataStore: true,
                    requiresPostRefresh: true,
                },
            },
            collection: {
                id: collectionId,
                title: 'Graph Client Collection',
                webAssetGenerationMode: 'plain',
            },
        });

        const artifacts = Array.isArray(result?.artifacts) ? result.artifacts : [];
        const indexHtmlArtifact = artifacts.find(
            (artifact) => artifact.targetPath === `collection/webview/${collectionId}/index.html`
        );
        const clientScriptArtifact = artifacts.find(
            (artifact) =>
                artifact.targetPath === `collection/webview/${collectionId}/webview_client.js`
        );
        assert.ok(indexHtmlArtifact, 'Expected a generated index.html artifact');
        assert.ok(clientScriptArtifact, 'Expected a generated client script artifact');

        const dom = new JSDOM(String(indexHtmlArtifact.content), {
            runScripts: 'outside-only',
            url: 'http://localhost/',
            pretendToBeVisual: true,
        });
        const { window } = dom;
        const drawnOperations = [];
        const drawContext = new Proxy(
            {},
            {
                get(target, property) {
                    if (property === 'measureText') {
                        return (text) => {
                            drawnOperations.push({ operation: 'measureText', args: [text] });
                            return { width: String(text ?? '').length * 7 };
                        };
                    }
                    return (...args) => {
                        drawnOperations.push({ operation: String(property), args });
                    };
                },
                set(target, property, value) {
                    drawnOperations.push({
                        operation: `set:${String(property)}`,
                        args: [value],
                    });
                    return true;
                },
            }
        );
        window.HTMLCanvasElement.prototype.getContext = () => drawContext;
        window.fetch = async () => ({
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ updates: [] }),
        });
        window.setInterval = () => 1;
        window.clearInterval = () => {};
        window.console = { warn: () => {} };

        const hostElement = window.document.querySelector('.wv-graph-display');
        assert.ok(hostElement);
        const canvas = hostElement.querySelector('canvas.wv-graph-canvas');
        assert.ok(canvas);

        if (typeof prepare === 'function') {
            prepare({ window, hostElement, canvas, drawnOperations });
        }

        window.eval(String(clientScriptArtifact.content));

        return { dom, window, hostElement, canvas, drawnOperations };
    }

    it('sizes the graph canvas from its own box and never from the card padding', async () => {
        const client = await buildGraphClient({ collectionId: 'collection-graph-box' });
        const { dom, window, hostElement, canvas, drawnOperations } = client;
        const originalGetComputedStyle = window.getComputedStyle;
        const graphEntry = {
            elementId: hostElement.id,
            kind: 'graph-display',
            title: 'Pressure',
            heightPx: 200,
            tickCount: 4,
            lineColor: '#70d6ff',
            xLabel: 'Time',
            yLabel: 'kPa',
            maxPoints: 16,
            xValues: [0, 1],
            yValues: [1, 2],
        };
        const redraw = () => {
            drawnOperations.length = 0;
            return window.applyUpdateList([graphEntry]);
        };
        const setRatio = (value) => {
            Object.defineProperty(window, 'devicePixelRatio', { value, configurable: true });
        };
        const setRect = (width) => {
            window.HTMLCanvasElement.prototype.getBoundingClientRect = () => ({
                width,
                height: 260,
                top: 0,
                left: 0,
                right: width,
                bottom: 260,
                x: 0,
                y: 0,
            });
        };

        try {
            setRatio(2);
            setRect(480);
            assert.equal(redraw(), 1);
            assert.equal(canvas.width, 960, 'Expected the HiDPI canvas box width');
            assert.equal(canvas.height, 400);
            assert.equal(canvas.style.width, '');
            assert.equal(canvas.style.height, '200px');
            const transformEntry = drawnOperations.find(
                (entry) => entry.operation === 'setTransform'
            );
            assert.ok(transformEntry, 'Expected the draw context to be scaled');
            assert.deepEqual(transformEntry.args, [2, 0, 0, 2, 0, 0]);

            Object.defineProperty(hostElement, 'clientWidth', { value: 418, configurable: true });
            assert.equal(redraw(), 1);
            assert.equal(canvas.width, 960, 'Expected the canvas box to win over the card width');
            delete hostElement.clientWidth;

            delete window.HTMLCanvasElement.prototype.getBoundingClientRect;
            Object.defineProperty(canvas, 'clientWidth', { value: 300, configurable: true });
            assert.equal(redraw(), 1);
            assert.equal(canvas.width, 600, 'Expected the canvas clientWidth fallback');
            delete canvas.clientWidth;

            Object.defineProperty(hostElement, 'clientWidth', { value: 400, configurable: true });
            window.getComputedStyle = () => ({ paddingLeft: '10px', paddingRight: '10px' });
            assert.equal(redraw(), 1);
            assert.equal(canvas.width, 760, 'Expected the card content-box fallback');

            setRatio(1);
            window.getComputedStyle = () => ({ paddingLeft: '', paddingRight: '10px' });
            assert.equal(redraw(), 1);
            assert.equal(canvas.width, 320, 'Expected unparsable insets to keep the constant width');

            window.getComputedStyle = undefined;
            assert.equal(redraw(), 1);
            assert.equal(canvas.width, 320, 'Expected a missing getComputedStyle to keep 320');

            window.getComputedStyle = originalGetComputedStyle;
            setRatio(2);
            setRect(100);
            assert.equal(redraw(), 1);
            assert.equal(canvas.width, 200, 'Expected no 160 px floor on a narrow card');

            setRatio(1);
            window.getComputedStyle = () => ({ paddingLeft: '10px', paddingRight: '10px' });
            window.HTMLCanvasElement.prototype.getBoundingClientRect = () => ({
                width: Number.NaN,
            });
            assert.equal(redraw(), 1, 'Expected a non-finite rect to redraw without throwing');
            assert.equal(
                canvas.width,
                380,
                'Expected a non-finite rect to fall through to the card content box'
            );

            window.getComputedStyle = originalGetComputedStyle;
            delete window.HTMLCanvasElement.prototype.getBoundingClientRect;
            delete canvas.clientWidth;
            delete hostElement.clientWidth;

            const measuringContext = {
                measureText: (text) => ({ width: text === '' ? 0 : 99 }),
            };
            assert.equal(window.graphMeasureLabel(undefined, 'x'), 0);
            assert.equal(window.graphMeasureLabel({}, 'x'), 0);
            assert.equal(window.graphMeasureLabel({ measureText: () => undefined }, 'x'), 0);
            assert.equal(
                window.graphMeasureLabel({ measureText: () => ({ width: Number.NaN }) }, 'x'),
                0
            );
            assert.equal(window.graphMeasureLabel({ measureText: () => ({ width: -3 }) }, 'x'), 0);
            assert.equal(window.graphMeasureLabel(measuringContext, null), 0);
            assert.equal(window.graphMeasureLabel(measuringContext, undefined), 0);
            assert.equal(window.graphMeasureLabel(measuringContext, 'ab'), 99);

            assert.equal(window.graphElementInsets(undefined), null);
            window.getComputedStyle = undefined;
            assert.equal(window.graphElementInsets(hostElement), null);
            window.getComputedStyle = () => ({});
            assert.equal(window.graphElementInsets(hostElement), null);
            window.getComputedStyle = () => ({ paddingLeft: '-2px', paddingRight: '4px' });
            assert.equal(window.graphElementInsets(hostElement), null);
            window.getComputedStyle = () => ({ paddingLeft: '10px', paddingRight: '4px' });
            const insets = window.graphElementInsets(hostElement);
            assert.ok(insets);
            assert.equal(insets.horizontal, 14);

            window.getComputedStyle = originalGetComputedStyle;
            assert.equal(
                window.graphCanvasCssWidth({ getBoundingClientRect: () => ({ width: 0.4 }) }, null),
                1
            );
            window.getComputedStyle = undefined;
            assert.equal(
                window.graphCanvasCssWidth(
                    { getBoundingClientRect: () => ({ width: 0 }), clientWidth: 0 },
                    { clientWidth: 0 }
                ),
                320
            );
        } finally {
            window.getComputedStyle = originalGetComputedStyle;
            delete window.HTMLCanvasElement.prototype.getBoundingClientRect;
            delete canvas.clientWidth;
            delete hostElement.clientWidth;
            delete window.devicePixelRatio;
            dom.window.close();
        }
    });

    it('keeps graph tick labels and axis captions inside the canvas', async () => {
        const drawnOperations = [];
        let measureWidth = (text) => String(text ?? '').length * 7;
        const drawContext = new Proxy(
            {},
            {
                get(target, property) {
                    if (property === 'measureText') {
                        return (text) => {
                            drawnOperations.push({ operation: 'measureText', args: [text] });
                            return { width: measureWidth(text) };
                        };
                    }
                    return (...args) => {
                        drawnOperations.push({ operation: String(property), args });
                    };
                },
                set(target, property, value) {
                    drawnOperations.push({
                        operation: `set:${String(property)}`,
                        args: [value],
                    });
                    return true;
                },
            }
        );
        const client = await buildGraphClient({
            collectionId: 'collection-graph-ticks',
            prepare({ window }) {
                window.devicePixelRatio = 1;
                window.HTMLCanvasElement.prototype.getBoundingClientRect = () => ({ width: 480 });
                window.HTMLCanvasElement.prototype.getContext = () => drawContext;
            },
        });
        const { dom, window, hostElement, canvas } = client;

        /**
         * Returns the measured width the stub assigns to a tick text.
         * @param {string|number|null|undefined} text Tick text passed to `measureText`.
         * @returns {number} Seven pixels per character.
         */
        const stubWidth = (text) => String(text ?? '').length * 7;
        /** Returns the recorded `fillText` operations of the last draw. */
        const fillTexts = () => drawnOperations.filter((entry) => entry.operation === 'fillText');
        /** Returns the recorded `rect` operations of the last draw. */
        const rects = () => drawnOperations.filter((entry) => entry.operation === 'rect');

        try {
            const baseEntry = {
                elementId: hostElement.id,
                kind: 'graph-display',
                title: 'Pressure',
                heightPx: 200,
                tickCount: 4,
                lineColor: '#70d6ff',
                xLabel: 'Time',
                yLabel: 'kPa',
                xRangeMode: 'auto',
                yRangeMode: 'auto',
                maxPoints: 16,
                xValues: [0, 1, 2, 3],
                yValues: [10, 14, 9, 18],
            };
            /**
             * Redraws the graph with the fixture plus an optional patch.
             * @param {object} [patch] Entry overrides applied over the fixture.
             * @returns {number} Applied update count.
             */
            const redraw = (patch = {}) => {
                drawnOperations.length = 0;
                return window.applyUpdateList([{ ...baseEntry, ...patch }]);
            };

            assert.equal(redraw(), 1);
            const fontIndex = drawnOperations.findIndex((entry) => entry.operation === 'set:font');
            const firstMeasureIndex = drawnOperations.findIndex(
                (entry) => entry.operation === 'measureText'
            );
            assert.ok(fontIndex >= 0, 'Expected the tick font to be assigned during the draw');
            assert.ok(
                firstMeasureIndex > fontIndex,
                'Expected the tick font to be applied before the labels are measured'
            );

            const narrowTexts = fillTexts();
            assert.equal(
                narrowTexts.length,
                12,
                'Expected 5 y ticks, 5 x ticks, and 2 axis captions'
            );
            const narrowYTicks = narrowTexts.slice(0, 5);
            const narrowMaxYWidth = Math.max(
                ...narrowYTicks.map((entry) => stubWidth(entry.args[0]))
            );
            const paddingLeft = 16 + narrowMaxYWidth + 8;
            assert.equal(narrowMaxYWidth, 28);
            assert.equal(paddingLeft, 52);
            narrowYTicks.forEach((entry) => {
                const width = stubWidth(entry.args[0]);
                assert.ok(entry.args[1] - width >= 0, 'Expected the y tick to start inside the canvas');
                assert.equal(entry.args[1], paddingLeft - 8);
                assert.equal(entry.args[3], Math.max(1, paddingLeft - 8));
                assert.ok(entry.args[2] >= 14 && entry.args[2] <= 166);
            });

            const narrowXTicks = narrowTexts.slice(5, 10);
            const lastXWidth = stubWidth(narrowXTicks[narrowXTicks.length - 1].args[0]);
            const paddingRight = Math.max(Math.ceil(lastXWidth / 2) + 4, 4);
            assert.equal(paddingRight, 15);
            narrowXTicks.forEach((entry) => {
                const width = stubWidth(entry.args[0]);
                assert.ok(entry.args[1] - width / 2 >= 0);
                assert.ok(entry.args[1] + width / 2 <= 480);
                assert.equal(entry.args[2], 200 - 34 + 8);
            });

            const narrowClip = rects().pop();
            assert.ok(narrowClip, 'Expected a clip rect operation');
            assert.equal(narrowClip.args[0], paddingLeft);
            assert.equal(narrowClip.args[1], 14);
            assert.equal(narrowClip.args[2], 480 - paddingLeft - paddingRight);
            assert.equal(narrowClip.args[3], 200 - 48);
            const translate = drawnOperations.find((entry) => entry.operation === 'translate');
            assert.ok(translate, 'Expected a rotated y caption translate');
            assert.equal(translate.args[0], 8);
            const xCaption = narrowTexts.find((entry) => entry.args[0] === 'Time');
            assert.ok(xCaption, 'Expected the x caption to be drawn');
            assert.equal(xCaption.args[2], 190);


            assert.equal(redraw({ yRangeMode: 'manual', minY: -1000000, maxY: 1000000 }), 1);
            const wideTexts = fillTexts();
            const wideYTicks = wideTexts.slice(0, 5);
            const wideMaxYWidth = Math.max(...wideYTicks.map((entry) => stubWidth(entry.args[0])));
            const widePaddingLeft = 16 + wideMaxYWidth + 8;
            assert.equal(wideMaxYWidth, 56);
            assert.equal(widePaddingLeft, 80);
            assert.equal(wideYTicks[0].args[1], widePaddingLeft - 8);
            assert.ok(
                wideYTicks[0].args[1] > narrowYTicks[0].args[1],
                'Expected the longer y labels to grow the left gutter'
            );
            wideYTicks.forEach((entry) => {
                const width = stubWidth(entry.args[0]);
                assert.ok(entry.args[1] - width >= 0, 'Expected the wide y tick to start inside the canvas');
            });
            const wideClip = rects().pop();
            const widePaddingRight = 480 - wideClip.args[0] - wideClip.args[2];
            const wideLastXWidth = stubWidth(wideTexts[9].args[0]);
            assert.ok(widePaddingRight >= Math.ceil(wideLastXWidth / 2) + 4);
            wideTexts.slice(5, 10).forEach((entry) => {
                const width = stubWidth(entry.args[0]);
                assert.ok(entry.args[1] - width / 2 >= 0);
                assert.ok(entry.args[1] + width / 2 <= 480);
            });

            window.HTMLCanvasElement.prototype.getBoundingClientRect = () => ({ width: 100 });
            assert.equal(redraw({ yRangeMode: 'manual', minY: -1000000, maxY: 1000000 }), 1);
            const clampTexts = fillTexts();
            const clampClip = rects().pop();
            const clampPaddingLeft = clampClip.args[0];
            const clampPaddingRight = 100 - clampClip.args[0] - clampClip.args[2];
            assert.equal(clampPaddingLeft, Math.floor(100 * 0.45));
            assert.ok(
                clampPaddingLeft + clampPaddingRight <= Math.floor(100 * 0.45) +
                    Math.floor(100 * 0.25)
            );
            assert.ok(clampClip.args[2] >= 1, 'Expected the clamped plot width to stay positive');
            clampTexts.slice(0, 5).forEach((entry) => {
                const effectiveWidth = Math.min(stubWidth(entry.args[0]), entry.args[3]);
                assert.ok(
                    entry.args[1] - effectiveWidth >= 0,
                    'Expected the condensed y tick to start inside the canvas'
                );
                assert.equal(entry.args[1], clampPaddingLeft - 8);
            });
            clampTexts.slice(5, 10).forEach((entry) => {
                const effectiveWidth = Math.min(stubWidth(entry.args[0]), entry.args[3]);
                assert.ok(entry.args[1] - effectiveWidth / 2 >= 0);
                assert.ok(entry.args[1] + effectiveWidth / 2 <= 100);
            });

            measureWidth = () => 0;
            const widthBeforeZero = canvas.width;
            assert.equal(redraw({ yRangeMode: 'manual', minY: -1000000, maxY: 1000000 }), 1);
            assert.equal(rects().pop().args[0], 24);
            assert.equal(canvas.width, widthBeforeZero);
            assert.equal(
                drawnOperations.find((entry) => entry.operation === 'translate').args[0],
                8
            );
            measureWidth = stubWidth;

            window.HTMLCanvasElement.prototype.getBoundingClientRect = () => ({ width: 480 });
            assert.equal(
                redraw({ yRangeMode: 'manual', minY: -1000000, maxY: 1000000, yLabel: '' }),
                1
            );
            assert.equal(
                drawnOperations.some((entry) => entry.operation === 'translate'),
                false,
                'Expected no y caption translate without a y label'
            );
            const noCaptionMaxYWidth = Math.max(
                ...fillTexts()
                    .slice(0, 5)
                    .map((entry) => stubWidth(entry.args[0]))
            );
            assert.equal(rects().pop().args[0], Math.ceil(noCaptionMaxYWidth) + 8);
        } finally {
            dom.window.close();
        }
    });


    it('renders graph-display series updates on the generated canvas client', async () => {
        const consumer = globalThis.NodeHelperHandoffConsumers['web-runtime'];
        assert.equal(typeof consumer, 'function');



        const result = await consumer({
            group: {
                mergedData: {
                    'webNode:node-root': {
                        id: 'node-root',
                        kind: 'web-root',
                        controls: { title: 'Graph' },
                    },
                    'webNode:node-graph': {
                        id: 'node-graph',
                        kind: 'graph-display',
                        controls: {
                            title: 'Pressure',
                            heightPx: 200,
                            tickCount: 4,
                            lineColor: '#70d6ff',
                            xLabel: 'Time',
                            yLabel: 'kPa',
                            maxPoints: 16,
                        },
                        layout: { parentNodeId: 'node-root', parentOutputIndex: 0 },
                    },
                },
                webserverSpecPatch: {
                    needsWebDataStore: true,
                    requiresPostRefresh: true,
                },
            },
            collection: {
                id: 'collection-graph-client',
                title: 'Graph Client Collection',
                webAssetGenerationMode: 'plain',
            },
        });

        const artifacts = Array.isArray(result?.artifacts) ? result.artifacts : [];
        const indexHtmlArtifact = artifacts.find(
            (artifact) =>
                artifact.targetPath === 'collection/webview/collection-graph-client/index.html'
        );
        const clientScriptArtifact = artifacts.find(
            (artifact) =>
                artifact.targetPath ===
                'collection/webview/collection-graph-client/webview_client.js'
        );
        const layoutModelArtifact = artifacts.find(
            (artifact) => artifact.targetPath === 'collection/webview_layout_model.json'
        );
        const hooksArtifact = artifacts.find(
            (artifact) => artifact.targetPath === 'app/webserver_hooks_generated.py'
        );
        assert.ok(indexHtmlArtifact);
        assert.ok(clientScriptArtifact);
        assert.ok(layoutModelArtifact);
        assert.ok(hooksArtifact);

        const layoutModel = JSON.parse(String(layoutModelArtifact.content));
        const graphElement = Object.values(layoutModel.elements ?? {}).find(
            (element) => element?.nodeId === 'node-graph'
        );
        assert.ok(graphElement, 'Expected the graph node in the layout model');
        assert.ok(graphElement.binding.elementId.includes('_graph_'));
        assert.ok(graphElement.binding.payloadKey.startsWith('wv_bind_graph_'));
        assert.ok(String(hooksArtifact.content).includes('\'kind\': "graph-display",'));

        const indexHtml = String(indexHtmlArtifact.content);
        assert.ok(indexHtml.includes('wv-graph-display'));
        assert.ok(indexHtml.includes('data-wv-title="Pressure"'));
        assert.ok(indexHtml.includes('canvas class="wv-graph-canvas"'));

        const clientScript = String(clientScriptArtifact.content);
        assert.ok(
            clientScript.includes('function applyGraphDisplayUpdate(targetElement, entry) {')
        );
        assert.ok(clientScript.includes('"graph-display": applyGraphDisplayUpdate,'));

        const dom = new JSDOM(indexHtml, {
            runScripts: 'outside-only',
            url: 'http://localhost/',
            pretendToBeVisual: true,
        });
        const { window } = dom;
        const drawnOperations = [];
        const drawContext = new Proxy(
            {},
            {
                get(target, property) {
                    if (property === 'measureText') {
                        return (text) => {
                            drawnOperations.push({ operation: 'measureText', args: [text] });
                            return { width: String(text ?? '').length * 7 };
                        };
                    }
                    return (...args) => {
                        drawnOperations.push({ operation: String(property), args });
                    };
                },
                set(target, property, value) {
                    drawnOperations.push({
                        operation: `set:${String(property)}`,
                        args: [value],
                    });
                    return true;
                },
            }
        );
        window.HTMLCanvasElement.prototype.getContext = () => drawContext;
        window.fetch = async () => ({
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ updates: [] }),
        });
        window.setInterval = () => 1;
        window.clearInterval = () => {};
        window.console = { warn: () => {} };

        window.eval(clientScript);

        const hostElement = window.document.querySelector('.wv-graph-display');
        assert.ok(hostElement);
        const canvas = hostElement.querySelector('canvas.wv-graph-canvas');
        assert.ok(canvas);
        assert.equal(canvas.width, 320);
        assert.equal(canvas.height, 200);
        assert.equal(canvas.style.width, '');
        assert.equal(canvas.style.height, '200px');
        assert.ok(
            drawnOperations.some(
                (entry) =>
                    entry.operation === 'fillText' && entry.args.some((arg) => arg === 'Time')
            )
        );

        drawnOperations.length = 0;
        const appliedCount = window.applyUpdateList([
            {
                elementId: hostElement.id,
                kind: 'graph-display',
                title: 'Live Pressure',
                xValues: [0, 1, 2, 3],
                yValues: [10, 14, 9, 18],
                heightPx: 260,
                tickCount: 4,
                lineColor: '#ff8800',
                xLabel: 't',
                yLabel: 'kPa',
                xRangeMode: 'auto',
                yRangeMode: 'auto',
                maxPoints: 16,
            },
        ]);

        assert.equal(appliedCount, 1);
        assert.equal(hostElement.getAttribute('data-wv-title'), 'Live Pressure');
        assert.equal(hostElement.querySelector('.wv-graph-title').textContent, 'Live Pressure');
        assert.equal(hostElement.getAttribute('data-wv-height-px'), '260');
        assert.equal(hostElement.getAttribute('data-wv-line-color'), '#ff8800');
        assert.equal(canvas.height, 260);
        assert.equal(canvas.style.width, '');
        assert.equal(canvas.style.height, '260px');
        assert.ok(
            drawnOperations.some(
                (entry) => entry.operation === 'set:strokeStyle' && entry.args[0] === '#ff8800'
            )
        );
        assert.ok(
            drawnOperations.some(
                (entry) => entry.operation === 'fillText' && entry.args.some((arg) => arg === 't')
            )
        );

        assert.equal(
            window.applyUpdateList([
                {
                    elementId: hostElement.id,
                    kind: 'graph-display',
                    xValues: [],
                    yValues: [],
                },
            ]),
            1,
            'Expected an empty series entry to be applied without throwing'
        );

        assert.equal(
            window.applyUpdateList([
                {
                    elementId: hostElement.id,
                    kind: 'graph-display',
                    xValues: [0, Number.NaN, 2],
                    yValues: [1, 2, Number.POSITIVE_INFINITY],
                },
            ]),
            1,
            'Expected non-finite series values to be filtered without throwing'
        );

        canvas.remove();
        assert.equal(
            window.applyUpdateList([
                {
                    elementId: hostElement.id,
                    kind: 'graph-display',
                    xValues: [1],
                    yValues: [2],
                },
            ]),
            0,
            'Expected the handler to report false when the canvas is missing'
        );

        dom.window.close();
    });

    it('registers title-content contributor with markup and client update handler surfaces', () => {
        const shared = globalThis.WebviewGeneratorShared;
        const contributor = shared.getNodeKindContributor('title-content', { required: true });

        assert.equal(typeof contributor?.renderMarkup, 'function');
        assert.equal(typeof contributor?.renderClientUpdateHandler, 'function');

        const handlerLines = contributor.renderClientUpdateHandler({ nodeKind: 'title-content' });
        assert.ok(Array.isArray(handlerLines));
        assert.ok(
            handlerLines.some((line) =>
                String(line).includes('function applyTitleContentUpdate(targetElement, entry) {')
            )
        );
    });

    it('uses title-content contributor override for generated applyTitleContentUpdate handler', async () => {
        const shared = globalThis.WebviewGeneratorShared;
        const existing = shared.getNodeKindContributor('title-content');
        assert.ok(existing, 'Expected baseline title-content contributor before override test');

        shared.unregisterNodeKindContributor('title-content');
        try {
            shared.registerNodeKindContributor('title-content', {
                renderMarkup: existing.renderMarkup,
                renderClientUpdateHandler() {
                    return [
                        'function applyTitleContentUpdate(targetElement, entry) {',
                        '  // step9 title-content override marker',
                        '  if (!targetElement || !entry || typeof entry !== "object") {',
                        '    return false;',
                        '  }',
                        '  targetElement.setAttribute("data-step9-title", "true");',
                        '  return true;',
                        '}',
                    ];
                },
            });

            const consumer = globalThis.NodeHelperHandoffConsumers['web-runtime'];
            const result = await consumer({
                group: {
                    mergedData: {
                        'webNode:node-root': {
                            id: 'node-root',
                            kind: 'web-root',
                            controls: { title: 'Step 9 Override' },
                        },
                        'webNode:node-title': {
                            id: 'node-title',
                            kind: 'title-content',
                            controls: { title: 'Status', headingLevel: 3 },
                            layout: {
                                parentNodeId: 'node-root',
                                parentOutputIndex: 0,
                            },
                        },
                    },
                    webserverSpecPatch: {
                        disableCompressedAssets: true,
                    },
                },
                collection: {
                    id: 'collection-step9-override',
                    title: 'Step 9 Override Collection',
                    webAssetGenerationMode: 'plain',
                },
            });

            const artifacts = Array.isArray(result?.artifacts) ? result.artifacts : [];
            const clientArtifact = artifacts.find(
                (artifact) =>
                    artifact.targetPath ===
                    'collection/webview/collection-step9-override/webview_client.js'
            );
            assert.ok(clientArtifact, 'Expected generated client script artifact for step 9 test');
            const clientSource = String(clientArtifact.content || '');
            assert.match(clientSource, /step9 title-content override marker/);
            assert.match(clientSource, /data-step9-title/);
        } finally {
            shared.unregisterNodeKindContributor('title-content');
            shared.registerNodeKindContributor('title-content', existing);
        }
    });

    it('uses contributor-driven update dispatch map instead of hardcoded kind branches', async () => {
        const consumer = globalThis.NodeHelperHandoffConsumers['web-runtime'];
        const result = await consumer({
            group: {
                mergedData: {
                    'webNode:node-root': {
                        id: 'node-root',
                        kind: 'web-root',
                        controls: { title: 'Step 12 Dispatch' },
                    },
                    'webNode:node-content': {
                        id: 'node-content',
                        kind: 'content',
                        controls: { title: 'T', value: 1 },
                        layout: {
                            parentNodeId: 'node-root',
                            parentOutputIndex: 0,
                        },
                    },
                },
                webserverSpecPatch: {
                    disableCompressedAssets: true,
                },
            },
            collection: {
                id: 'collection-step12-dispatch',
                title: 'Step 12 Dispatch Collection',
                webAssetGenerationMode: 'plain',
            },
        });

        const artifacts = Array.isArray(result?.artifacts) ? result.artifacts : [];
        const clientArtifact = artifacts.find(
            (artifact) =>
                artifact.targetPath ===
                'collection/webview/collection-step12-dispatch/webview_client.js'
        );
        assert.ok(clientArtifact, 'Expected generated client script artifact for step 12 test');

        const clientSource = String(clientArtifact.content || '');
        assert.match(clientSource, /const NODE_KIND_UPDATE_HANDLERS = \{/);
        assert.match(clientSource, /"content": applyContentUpdate,/);
        assert.match(clientSource, /"value-table": applyValueTableUpdate,/);
        assert.match(clientSource, /"radar-display": applyRadarDisplayUpdate,/);
        assert.match(clientSource, /"joystick-display": applyJoystickDisplayUpdate,/);
        assert.match(clientSource, /"title-content": applyTitleContentUpdate,/);

        assert.ok(!clientSource.includes('if (kind === "content") {'));
        assert.ok(!clientSource.includes('if (kind === "value-table") {'));
        assert.ok(!clientSource.includes('if (kind === "radar-display") {'));
        assert.ok(!clientSource.includes('if (kind === "joystick-display") {'));
        assert.ok(!clientSource.includes('if (kind === "title-content") {'));
    });

    it('helper handoff consumer generates web assets, manifest/spec, hook module, and runtime flags', async () => {
        const consumer = globalThis.NodeHelperHandoffConsumers['web-runtime'];
        assert.equal(typeof consumer, 'function');

        const result = await consumer({
            group: {
                mergedData: {
                    'webNode:node-root': {
                        id: 'node-root',
                        kind: 'web-root',
                        controls: { title: 'Micro Otter' },
                    },
                    'webNode:node-content': {
                        id: 'node-content',
                        kind: 'content',
                        controls: { title: 'Temperature', value: 22 },
                    },
                    'webNode:node-vtable': {
                        id: 'node-vtable',
                        kind: 'value-table',
                        controls: { rowCount: 3 },
                    },
                    'webNode:node-radar': {
                        id: 'node-radar',
                        kind: 'radar-display',
                        controls: {
                            maxRadiusPx: 48,
                            startAngleDeg: -45,
                            endAngleDeg: 135,
                            pieceCount: 6,
                            fillColor: '#55c9ff',
                            initialRadiusNormalized: 0.25,
                        },
                    },
                    'webNode:node-joystick': {
                        id: 'node-joystick',
                        kind: 'joystick-display',
                        controls: {
                            outerRadiusPx: 44,
                            outerStrokeWidthPx: 2,
                            outerStrokeColor: '#7fb2ff',
                            outerFillColor: '#0e1626',
                            innerRadiusPx: 9,
                            innerFillColor: '#60d8ff',
                            showDegreeMarks: true,
                            degreeMarkIntervalDeg: 30,
                            degreeMarkColor: '#7fa1d6',
                        },
                    },
                },
                webserverSpecPatch: {
                    postRefreshRoute: '/api/webview/refresh',
                    needsWebDataStore: true,
                    requiresPostRefresh: true,
                },
            },
            collection: {
                id: 'collection-1',
                title: 'Main Collection',
            },
        });

        const artifacts = Array.isArray(result?.artifacts) ? result.artifacts : [];
        const targetPaths = artifacts.map((artifact) => artifact.targetPath);
        assert.ok(targetPaths.includes('collection/webview/collection-1/index.html'));
        assert.ok(targetPaths.includes('collection/webview/collection-1/webview_client.js'));
        assert.ok(targetPaths.includes('collection/webview/collection-1/index.html.gz'));
        assert.ok(targetPaths.includes('collection/webview/collection-1/webview_client.js.gz'));
        assert.ok(targetPaths.includes('collection/webview_manifest.json'));
        assert.ok(targetPaths.includes('collection/webview_layout_model.json'));
        assert.ok(targetPaths.includes('app/webserver_hooks_generated.py'));
        assert.ok(targetPaths.includes('collection/webview_runtime_flags.json'));

        const indexGzipArtifact = artifacts.find(
            (artifact) => artifact.targetPath === 'collection/webview/collection-1/index.html.gz'
        );
        const clientScriptGzipArtifact = artifacts.find(
            (artifact) =>
                artifact.targetPath === 'collection/webview/collection-1/webview_client.js.gz'
        );
        assert.ok(indexGzipArtifact?.content instanceof Uint8Array);
        assert.equal(indexGzipArtifact?.contentEncoding, 'gzip');
        assert.equal(indexGzipArtifact?.content?.[0], 0x1f);
        assert.equal(indexGzipArtifact?.content?.[1], 0x8b);
        assert.ok(clientScriptGzipArtifact?.content instanceof Uint8Array);
        assert.equal(clientScriptGzipArtifact?.contentEncoding, 'gzip');

        const manifestArtifact = artifacts.find(
            (artifact) => artifact.targetPath === 'collection/webview_manifest.json'
        );
        assert.ok(manifestArtifact);
        const manifest = JSON.parse(String(manifestArtifact.content));
        assert.equal(manifest?.pageMode, 'single-page-compat');
        assert.equal(manifest?.webserverSpec?.schemaVersion, 'webview-webserver-spec/v1');
        assert.equal(manifest?.webserverSpec?.routes?.indexRoute, '/');
        assert.equal(manifest?.layoutModel?.schemaVersion, 'webview-layout-model/v1');
        assert.ok(manifest?.layoutModel?.elements?.['node:node-content']);
        assert.ok(manifest?.layoutModel?.elements?.['node:node-content']?.binding);
        const staticRoutes = manifest?.webserverSpec?.routes?.staticRoutes || [];
        assert.ok(staticRoutes.some((entry) => entry.route === '/'));
        assert.ok(staticRoutes.some((entry) => entry.route === '/webview/webview_client.js'));
        assert.ok(staticRoutes.some((entry) => entry.route === '/micro-otter-128px-white.svg'));
        assert.ok(staticRoutes.some((entry) => entry.route === '/favicon.ico'));
        const logoRoute = staticRoutes.find(
            (entry) => entry.route === '/micro-otter-128px-white.svg'
        );
        const faviconRoute = staticRoutes.find((entry) => entry.route === '/favicon.ico');
        assert.equal(logoRoute?.fallbackPath, 'html/micro-otter-128px-white.svg');
        assert.ok(logoRoute?.compressedPath == null);
        assert.equal(faviconRoute?.fallbackPath, 'html/micro-otter-head-64px.svg');
        assert.ok(faviconRoute?.compressedPath == null);
        const indexRoute = staticRoutes.find((entry) => entry.route === '/');
        assert.equal(indexRoute?.compressedPath, 'collection/webview/collection-1/index.html.gz');
        assert.equal(indexRoute?.fallbackPath, 'collection/webview/collection-1/index.html');
        assert.equal(indexRoute?.forceCompressedOnly, false);

        const runtimeFlagsArtifact = artifacts.find(
            (artifact) => artifact.targetPath === 'collection/webview_runtime_flags.json'
        );
        assert.ok(runtimeFlagsArtifact);
        const runtimeFlags = JSON.parse(String(runtimeFlagsArtifact.content));
        assert.equal(runtimeFlags?.pageMode, 'single-page-compat');
        assert.equal(runtimeFlags?.needsWebDataStore, true);
        assert.equal(runtimeFlags?.postRefreshRoute, '/api/webview/refresh');
        const runtimeStaticRoutes = runtimeFlags?.staticRoutes || [];
        const runtimeIndexRoute = runtimeStaticRoutes.find((entry) => entry?.route === '/');
        const runtimeClientRoute = runtimeStaticRoutes.find(
            (entry) => entry?.route === '/webview/webview_client.js'
        );
        const runtimeLogoRoute = runtimeStaticRoutes.find(
            (entry) => entry?.route === '/micro-otter-128px-white.svg'
        );
        const runtimeFaviconRoute = runtimeStaticRoutes.find(
            (entry) => entry?.route === '/favicon.ico'
        );
        assert.equal(runtimeIndexRoute?.forceCompressedOnly, false);
        assert.equal(runtimeIndexRoute?.fallbackPath, 'collection/webview/collection-1/index.html');
        assert.equal(runtimeClientRoute?.forceCompressedOnly, false);
        assert.equal(
            runtimeClientRoute?.fallbackPath,
            'collection/webview/collection-1/webview_client.js'
        );
        assert.equal(runtimeLogoRoute?.forceCompressedOnly, false);
        assert.equal(runtimeLogoRoute?.fallbackPath, 'html/micro-otter-128px-white.svg');
        assert.equal(runtimeFaviconRoute?.forceCompressedOnly, false);
        assert.equal(runtimeFaviconRoute?.fallbackPath, 'html/micro-otter-head-64px.svg');

        const hookArtifact = artifacts.find(
            (artifact) => artifact.targetPath === 'app/webserver_hooks_generated.py'
        );
        assert.ok(hookArtifact?.content.includes('handle_post_webview_refresh'));
        assert.ok(hookArtifact?.content.includes('register_extra_routes'));
        assert.ok(hookArtifact?.content.includes('STATIC_ROUTES'));
        assert.ok(hookArtifact?.content.includes('STATIC_ROUTES = ['));
        assert.ok(hookArtifact?.content.includes("'compressed_path'"));
        assert.ok(hookArtifact?.content.includes("'force_compressed_only': False"));
        assert.ok(hookArtifact?.content.includes('from otter_webview.refresh_hook import ('));
        assert.ok(!hookArtifact?.content.includes('libs.webview'));
        assert.ok(
            hookArtifact?.content.includes(
                'handle_post_webview_refresh as _handle_post_webview_refresh'
            )
        );
        assert.ok(
            hookArtifact?.content.includes('register_extra_routes as _register_extra_routes')
        );
        assert.ok(hookArtifact?.content.includes('WEBVIEW_DEBUG = const(0)'));
        assert.ok(hookArtifact?.content.includes('return _register_extra_routes('));
        assert.ok(hookArtifact?.content.includes('return await _handle_post_webview_refresh('));
        assert.ok(hookArtifact?.content.includes('debug_enabled=bool(WEBVIEW_DEBUG)'));
        assert.ok(hookArtifact?.content.includes('REFRESH_BINDINGS = {'));
        assert.ok(hookArtifact?.content.includes('TRANSIENT_VALUE_KEY_PREFIXES = ['));
        assert.ok(hookArtifact?.content.includes('REQUEST_VALUE_NORMALIZERS = ['));
        assert.ok(
            hookArtifact?.content.includes(
                'def _wv_normalize_joystick_frontend_updates(request_payload):'
            )
        );
        assert.ok(
            hookArtifact?.content.includes('request_value_normalizers=REQUEST_VALUE_NORMALIZERS')
        );
        assert.ok(hookArtifact?.content.includes('_wv_normalize_joystick_frontend_updates'));
        assert.ok(hookArtifact?.content.includes('refresh_bindings=REFRESH_BINDINGS'));
        assert.ok(
            hookArtifact?.content.includes('transient_key_prefixes=TRANSIENT_VALUE_KEY_PREFIXES')
        );
        assert.ok(hookArtifact?.content.includes('post_refresh_route=POST_REFRESH_ROUTE'));
        assert.ok(hookArtifact?.content.includes('value-table'));
        assert.ok(hookArtifact?.content.includes('radar-display'));
        assert.ok(hookArtifact?.content.includes("'page_id': None"));
        assert.ok(hookArtifact?.content.includes("'page_id':"));
        assert.ok(!hookArtifact?.content.includes("'node': node_key"));
        assert.ok(!hookArtifact?.content.includes('WVR.'));
        assert.ok(!hookArtifact?.content.includes('set_dom_mount_renderer'));
        assert.ok(!targetPaths.includes('app/web_data_store.py'));
    });

    it('uses web-root refreshIntervalMs control for generated client polling interval', async () => {
        const consumer = globalThis.NodeHelperHandoffConsumers['web-runtime'];
        assert.equal(typeof consumer, 'function');

        const result = await consumer({
            group: {
                mergedData: {
                    'webNode:node-root': {
                        id: 'node-root',
                        kind: 'web-root',
                        controls: { title: 'Polling Demo', refreshIntervalMs: 2500 },
                    },
                    'webNode:node-content': {
                        id: 'node-content',
                        kind: 'content',
                        controls: { title: 'Value', value: 1 },
                    },
                },
                webserverSpecPatch: {
                    postRefreshRoute: '/api/webview/refresh',
                    needsWebDataStore: true,
                    requiresPostRefresh: true,
                },
            },
            collection: {
                id: 'collection-refresh-interval',
                title: 'Refresh Interval Collection',
            },
        });

        const artifacts = Array.isArray(result?.artifacts) ? result.artifacts : [];
        const runtimeFlagsArtifact = artifacts.find(
            (artifact) => artifact.targetPath === 'collection/webview_runtime_flags.json'
        );
        assert.ok(runtimeFlagsArtifact);
        const runtimeFlags = JSON.parse(String(runtimeFlagsArtifact.content));
        const runtimeStaticRoutes = runtimeFlags?.staticRoutes || [];
        const runtimeIndexRoute = runtimeStaticRoutes.find((entry) => entry?.route === '/');
        const runtimeClientRoute = runtimeStaticRoutes.find(
            (entry) => entry?.route === '/webview/webview_client.js'
        );
        const runtimeLogoRoute = runtimeStaticRoutes.find(
            (entry) => entry?.route === '/micro-otter-128px-white.svg'
        );
        const runtimeFaviconRoute = runtimeStaticRoutes.find(
            (entry) => entry?.route === '/favicon.ico'
        );
        assert.equal(runtimeIndexRoute?.forceCompressedOnly, false);
        assert.equal(
            runtimeIndexRoute?.fallbackPath,
            'collection/webview/collection-refresh-interval/index.html'
        );
        assert.equal(runtimeClientRoute?.forceCompressedOnly, false);
        assert.equal(
            runtimeClientRoute?.fallbackPath,
            'collection/webview/collection-refresh-interval/webview_client.js'
        );
        assert.equal(runtimeLogoRoute?.forceCompressedOnly, false);
        assert.equal(runtimeLogoRoute?.fallbackPath, 'html/micro-otter-128px-white.svg');
        assert.equal(runtimeFaviconRoute?.forceCompressedOnly, false);
        assert.equal(runtimeFaviconRoute?.fallbackPath, 'html/micro-otter-head-64px.svg');
    });

    it('clamps web-root refreshIntervalMs control to minimum supported interval', async () => {
        const consumer = globalThis.NodeHelperHandoffConsumers['web-runtime'];
        assert.equal(typeof consumer, 'function');

        const result = await consumer({
            group: {
                mergedData: {
                    'webNode:node-root': {
                        id: 'node-root',
                        kind: 'web-root',
                        controls: { title: 'Clamp Demo', refreshIntervalMs: -5 },
                    },
                },
                webserverSpecPatch: {},
            },
            collection: {
                id: 'collection-refresh-interval-clamped',
                title: 'Refresh Interval Clamp Collection',
            },
        });

        const artifacts = Array.isArray(result?.artifacts) ? result.artifacts : [];
        const runtimeFlagsArtifact = artifacts.find(
            (artifact) => artifact.targetPath === 'collection/webview_runtime_flags.json'
        );
        assert.ok(runtimeFlagsArtifact);
        const runtimeFlags = JSON.parse(String(runtimeFlagsArtifact.content));
        assert.equal(runtimeFlags?.staticRoutes?.[0]?.forceCompressedOnly, false);

        const clientArtifact = artifacts.find(
            (artifact) =>
                artifact.targetPath ===
                'collection/webview/collection-refresh-interval-clamped/webview_client.js'
        );
        assert.ok(clientArtifact, 'Expected generated client script artifact');
        assert.ok(
            String(clientArtifact.content || '').includes('const REFRESH_INTERVAL_MS = 100;'),
            'A negative refreshIntervalMs must reach the client as the 100 ms floor'
        );
    });

    it('clamps web-root refreshIntervalMs without the shared helper handoff', () => {
        const shared = globalThis.WebviewGeneratorShared;
        assert.ok(shared, 'Expected WebviewGeneratorShared global export');
        const strategy = shared.getStructuralNodeKindStrategy('web-root', { required: true });
        assert.equal(typeof strategy?.normalizeControls, 'function');

        const normalize = (controls) => strategy.normalizeControls(controls, {});

        assert.equal(normalize({ refreshIntervalMs: 5 }).refreshIntervalMs, 100);
        assert.equal(normalize({ refreshIntervalMs: 0 }).refreshIntervalMs, 100);
        assert.equal(normalize({ refreshIntervalMs: -250 }).refreshIntervalMs, 100);
        assert.equal(normalize({ refreshIntervalMs: 99.6 }).refreshIntervalMs, 100);
        assert.equal(normalize({ refreshIntervalMs: 100 }).refreshIntervalMs, 100);
        assert.equal(normalize({ refreshIntervalMs: 2500 }).refreshIntervalMs, 2500);
        assert.equal(normalize({ refreshIntervalMs: 999999 }).refreshIntervalMs, 60000);
        assert.equal(normalize({ refreshIntervalMs: 'abc' }).refreshIntervalMs, 1000);
        assert.equal(normalize({}).refreshIntervalMs, 1000);
    });

    it('helper handoff consumer can disable compressed route metadata', async () => {
        const consumer = globalThis.NodeHelperHandoffConsumers['web-runtime'];
        assert.equal(typeof consumer, 'function');

        const result = await consumer({
            group: {
                mergedData: {
                    'webNode:node-root': {
                        id: 'node-root',
                        kind: 'web-root',
                        controls: { title: 'Micro Otter' },
                    },
                },
                webserverSpecPatch: {
                    disableCompressedAssets: true,
                },
            },
            collection: {
                id: 'collection-no-gzip',
                title: 'No Gzip Collection',
            },
        });

        const artifacts = Array.isArray(result?.artifacts) ? result.artifacts : [];
        const targetPaths = artifacts.map((artifact) => artifact.targetPath);
        assert.ok(!targetPaths.includes('app/web_data_store.py'));
        const compressedArtifacts = artifacts.filter(
            (artifact) =>
                typeof artifact.targetPath === 'string' && artifact.targetPath.endsWith('.gz')
        );
        assert.equal(compressedArtifacts.length, 0);
        const manifestArtifact = artifacts.find(
            (artifact) => artifact.targetPath === 'collection/webview_manifest.json'
        );
        assert.ok(manifestArtifact);
        const manifest = JSON.parse(String(manifestArtifact.content));
        const staticRoutes = manifest?.webserverSpec?.routes?.staticRoutes || [];
        staticRoutes.forEach((entry) => {
            assert.equal(
                Object.prototype.hasOwnProperty.call(entry, 'compressedPath'),
                false,
                'compressedPath should be omitted when compressed assets are disabled'
            );
            assert.equal(entry?.varyAcceptEncoding, false);
            assert.equal(entry?.forceCompressedOnly, false);
        });
    });

    it('uses collection webAssetGenerationMode=plain to generate plain web assets only', async () => {
        const consumer = globalThis.NodeHelperHandoffConsumers['web-runtime'];
        assert.equal(typeof consumer, 'function');

        const result = await consumer({
            group: {
                mergedData: {
                    'webNode:node-root': {
                        id: 'node-root',
                        kind: 'web-root',
                        controls: { title: 'Plain Assets' },
                    },
                },
                webserverSpecPatch: {},
            },
            collection: {
                id: 'collection-plain-assets',
                title: 'Plain Assets Collection',
                webAssetGenerationMode: 'plain',
            },
        });

        const artifacts = Array.isArray(result?.artifacts) ? result.artifacts : [];
        const targetPaths = artifacts.map((artifact) => artifact.targetPath);

        assert.ok(targetPaths.includes('collection/webview/collection-plain-assets/index.html'));
        assert.ok(
            targetPaths.includes('collection/webview/collection-plain-assets/webview_client.js')
        );
        assert.ok(
            !targetPaths.includes('collection/webview/collection-plain-assets/index.html.gz')
        );
        assert.ok(
            !targetPaths.includes('collection/webview/collection-plain-assets/webview_client.js.gz')
        );

        const runtimeFlagsArtifact = artifacts.find(
            (artifact) => artifact.targetPath === 'collection/webview_runtime_flags.json'
        );
        assert.ok(runtimeFlagsArtifact);
        const runtimeFlags = JSON.parse(String(runtimeFlagsArtifact.content));
        (runtimeFlags?.staticRoutes || []).forEach((entry) => {
            assert.equal(entry?.compressedPath, null);
            assert.equal(entry?.forceCompressedOnly, false);
        });
    });

    it('builds deterministic layout model bindings and parent-child ordering', async () => {
        const consumer = globalThis.NodeHelperHandoffConsumers['web-runtime'];
        assert.equal(typeof consumer, 'function');

        const result = await consumer({
            group: {
                mergedData: {
                    'webNode:node-root': {
                        id: 'node-root',
                        kind: 'web-root',
                        controls: { title: 'Layout Root' },
                    },
                    'webNode:node-row': {
                        id: 'node-row',
                        kind: 'row',
                        controls: { columnCount: 2 },
                        layout: { parentNodeId: 'node-root', parentOutputIndex: 0 },
                    },
                    'webNode:node-column': {
                        id: 'node-column',
                        kind: 'column',
                        controls: { rowCount: 1 },
                        layout: { parentNodeId: 'node-root', parentOutputIndex: 1 },
                    },
                    'webNode:node-content': {
                        id: 'node-content',
                        kind: 'content',
                        controls: { title: 'Temperature', value: 21 },
                        layout: { parentNodeId: 'node-row', parentOutputIndex: 0 },
                    },
                    'webNode:node-title': {
                        id: 'node-title',
                        kind: 'title-content',
                        controls: { title: 'Status', headingLevel: 2 },
                        layout: { parentNodeId: 'node-row', parentOutputIndex: 1 },
                    },
                },
                webserverSpecPatch: {
                    needsWebDataStore: true,
                    requiresPostRefresh: true,
                },
            },
            collection: {
                id: 'collection-layout',
                title: 'Layout Collection',
            },
        });

        const artifacts = Array.isArray(result?.artifacts) ? result.artifacts : [];
        const layoutArtifact = artifacts.find(
            (artifact) => artifact.targetPath === 'collection/webview_layout_model.json'
        );
        assert.ok(layoutArtifact);

        const indexHtmlGzipArtifact = artifacts.find(
            (artifact) =>
                artifact.targetPath === 'collection/webview/collection-layout/index.html.gz'
        );
        assert.ok(indexHtmlGzipArtifact);
        assert.ok(indexHtmlGzipArtifact.content instanceof Uint8Array);
        assert.ok(
            artifacts.some(
                (artifact) =>
                    artifact.targetPath === 'collection/webview/collection-layout/index.html'
            )
        );

        const layoutModel = JSON.parse(String(layoutArtifact.content));
        assert.equal(layoutModel?.schemaVersion, 'webview-layout-model/v1');
        assert.equal(layoutModel?.root?.id, 'node:node-root');
        assert.deepEqual(layoutModel?.root?.children, ['node:node-row', 'node:node-column']);
        assert.deepEqual(layoutModel?.root?.navigation, ['wv_page_root_node_root']);
        assert.deepEqual(layoutModel?.elements?.['node:node-row']?.children, [
            'node:node-content',
            'node:node-title',
        ]);
        assert.equal(
            layoutModel?.elements?.['node:node-content']?.binding?.elementId,
            'wv_el_content_node_content_s0'
        );
        assert.equal(
            layoutModel?.elements?.['node:node-title']?.binding?.elementId,
            'wv_el_title_node_title_s1'
        );
        assert.equal(
            layoutModel?.elements?.['node:node-content']?.ownerPageId,
            'wv_page_root_node_root'
        );
        assert.equal(layoutModel?.elements?.['node:node-root']?.pageId, 'wv_page_root_node_root');
        assert.equal(layoutModel?.navigation?.schemaVersion, 'webview-navigation-model/v1');
        assert.deepEqual(
            layoutModel?.navigation?.pages?.map((entry) => entry?.pageId),
            ['wv_page_root_node_root']
        );
        assert.equal(layoutModel?.pageBoundaries?.schemaVersion, 'webview-page-boundaries/v1');
        assert.deepEqual(layoutModel?.pageBoundaries?.pages, [
            {
                pageId: 'wv_page_root_node_root',
                rootElementKey: 'node:node-root',
                rootNodeId: 'node-root',
                ownedElementKeys: [
                    'node:node-root',
                    'node:node-row',
                    'node:node-column',
                    'node:node-content',
                    'node:node-title',
                ],
            },
        ]);
        assert.equal(Array.isArray(layoutModel?.diagnostics), true);
        assert.equal(layoutModel?.diagnostics?.length, 0);
    });

    it('emits deterministic page identity metadata for web-root and web-page nodes', async () => {
        const consumer = globalThis.NodeHelperHandoffConsumers['web-runtime'];
        assert.equal(typeof consumer, 'function');

        const consumerContext = {
            group: {
                mergedData: {
                    'webNode:node-page-b': {
                        id: 'node-page-b',
                        kind: 'web-page',
                        controls: { pageName: 'Reports' },
                        layout: { parentNodeId: 'node-root', parentOutputIndex: 1 },
                    },
                    'webNode:node-root': {
                        id: 'node-root',
                        kind: 'web-root',
                        controls: { title: 'Main' },
                    },
                    'webNode:node-page-a': {
                        id: 'node-page-a',
                        kind: 'web-page',
                        controls: { pageName: 'Overview' },
                        layout: { parentNodeId: 'node-root', parentOutputIndex: 0 },
                    },
                    'webNode:node-content': {
                        id: 'node-content',
                        kind: 'content',
                        controls: { title: 'Temperature', value: 25 },
                        layout: { parentNodeId: 'node-page-a', parentOutputIndex: 0 },
                    },
                },
                webserverSpecPatch: {
                    postRefreshRoute: '/api/webview/refresh',
                    needsWebDataStore: true,
                    requiresPostRefresh: true,
                },
            },
            collection: {
                id: 'collection-page-identity',
                title: 'Page Identity Collection',
            },
        };

        const [resultA, resultB] = await Promise.all([
            consumer(consumerContext),
            consumer(consumerContext),
        ]);

        function parseArtifactJson(artifacts, targetPath) {
            const artifact = artifacts.find((entry) => entry?.targetPath === targetPath);
            assert.ok(artifact, `Missing artifact ${targetPath}`);
            return JSON.parse(String(artifact.content));
        }

        const artifactsA = Array.isArray(resultA?.artifacts) ? resultA.artifacts : [];
        const artifactsB = Array.isArray(resultB?.artifacts) ? resultB.artifacts : [];

        const layoutModelA = parseArtifactJson(artifactsA, 'collection/webview_layout_model.json');
        const layoutModelB = parseArtifactJson(artifactsB, 'collection/webview_layout_model.json');
        assert.deepEqual(layoutModelA?.pageIdentity, layoutModelB?.pageIdentity);

        assert.equal(layoutModelA?.pageIdentity?.schemaVersion, 'webview-page-identity/v1');
        assert.equal(layoutModelA?.pageIdentity?.rootPageId, 'wv_page_root_node_root');
        assert.deepEqual(layoutModelA?.pageIdentity?.pageIdsByNodeId, {
            'node-page-a': 'wv_page_page_node_page_a',
            'node-page-b': 'wv_page_page_node_page_b',
            'node-root': 'wv_page_root_node_root',
        });

        assert.equal(layoutModelA?.elements?.['node:node-root']?.pageId, 'wv_page_root_node_root');
        assert.equal(
            layoutModelA?.elements?.['node:node-page-a']?.pageId,
            'wv_page_page_node_page_a'
        );
        assert.equal(
            layoutModelA?.elements?.['node:node-page-b']?.pageId,
            'wv_page_page_node_page_b'
        );
        assert.equal(
            layoutModelA?.elements?.['node:node-content']?.ownerPageId,
            'wv_page_page_node_page_a'
        );
        assert.equal(layoutModelA?.elements?.['node:node-content']?.pageId, undefined);

        assert.equal(layoutModelA?.navigation?.schemaVersion, 'webview-navigation-model/v1');
        assert.deepEqual(
            layoutModelA?.navigation?.pages?.map((entry) => entry?.pageId),
            ['wv_page_root_node_root', 'wv_page_page_node_page_a', 'wv_page_page_node_page_b']
        );
        assert.deepEqual(layoutModelA?.root?.navigation, [
            'wv_page_root_node_root',
            'wv_page_page_node_page_a',
            'wv_page_page_node_page_b',
        ]);

        const pageABoundary = (layoutModelA?.pageBoundaries?.pages || []).find(
            (entry) => entry?.pageId === 'wv_page_page_node_page_a'
        );
        assert.deepEqual(pageABoundary, {
            pageId: 'wv_page_page_node_page_a',
            rootElementKey: 'node:node-page-a',
            rootNodeId: 'node-page-a',
            ownedElementKeys: ['node:node-page-a', 'node:node-content'],
        });

        const runtimeFlagsA = parseArtifactJson(
            artifactsA,
            'collection/webview_runtime_flags.json'
        );
        const runtimeFlagsB = parseArtifactJson(
            artifactsB,
            'collection/webview_runtime_flags.json'
        );
        assert.deepEqual(runtimeFlagsA?.pageIdentity, runtimeFlagsB?.pageIdentity);
        assert.deepEqual(runtimeFlagsA?.pageIdentity, layoutModelA?.pageIdentity);
    });

    it('places the web-root page first in navigation when topologically last', async () => {
        const consumer = globalThis.NodeHelperHandoffConsumers['web-runtime'];
        assert.equal(typeof consumer, 'function');

        const result = await consumer({
            group: {
                mergedData: {
                    'webNode:graph-1:13': {
                        id: '13',
                        graphId: 'graph-1',
                        scopedId: 'graph-1:13',
                        kind: 'web-page',
                        controls: { pageName: 'Controls' },
                    },
                    'webNode:graph-2:4': {
                        id: '4',
                        graphId: 'graph-2',
                        scopedId: 'graph-2:4',
                        kind: 'web-page',
                        controls: { pageName: 'Test' },
                    },
                    'webNode:graph-3:20': {
                        id: '20',
                        graphId: 'graph-3',
                        scopedId: 'graph-3:20',
                        kind: 'web-root',
                        controls: { title: 'Micro Otter' },
                    },
                },
                webserverSpecPatch: {
                    postRefreshRoute: '/api/webview/refresh',
                    needsWebDataStore: true,
                    requiresPostRefresh: true,
                },
            },
            collection: {
                id: 'collection-root-first',
                title: 'Root First Collection',
            },
        });

        const artifacts = Array.isArray(result?.artifacts) ? result.artifacts : [];
        const layoutArtifact = artifacts.find(
            (entry) => entry?.targetPath === 'collection/webview_layout_model.json'
        );
        assert.ok(layoutArtifact, 'Missing layout model artifact');
        const layoutModel = JSON.parse(String(layoutArtifact.content));

        assert.deepEqual(
            layoutModel?.navigation?.pages?.map((entry) => entry?.pageId),
            ['wv_page_root_graph_3_20', 'wv_page_page_graph_1_13', 'wv_page_page_graph_2_4']
        );
        assert.deepEqual(layoutModel?.root?.navigation, [
            'wv_page_root_graph_3_20',
            'wv_page_page_graph_1_13',
            'wv_page_page_graph_2_4',
        ]);
    });

    it('keeps page identities unique when different graphs reuse the same local node ids', async () => {
        const consumer = globalThis.NodeHelperHandoffConsumers['web-runtime'];
        assert.equal(typeof consumer, 'function');

        const result = await consumer({
            group: {
                mergedData: {
                    'webNode:graph-1:1': {
                        id: '1',
                        graphId: 'graph-1',
                        scopedId: 'graph-1:1',
                        kind: 'web-root',
                        controls: { title: 'Main' },
                    },
                    'webNode:graph-2:1': {
                        id: '1',
                        graphId: 'graph-2',
                        scopedId: 'graph-2:1',
                        kind: 'web-page',
                        controls: { pageName: 'Reports' },
                    },
                },
                webserverSpecPatch: {
                    postRefreshRoute: '/api/webview/refresh',
                },
            },
            collection: {
                id: 'collection-graph-scoped-pages',
                title: 'Graph Scoped Pages',
                webAssetGenerationMode: 'plain',
            },
        });

        const artifacts = Array.isArray(result?.artifacts) ? result.artifacts : [];
        const layoutArtifact = artifacts.find(
            (entry) => entry?.targetPath === 'collection/webview_layout_model.json'
        );
        assert.ok(layoutArtifact, 'Missing layout model artifact');
        const layoutModel = JSON.parse(String(layoutArtifact.content));

        assert.equal(layoutModel?.pageIdentity?.rootPageId, 'wv_page_root_graph_1_1');
        assert.deepEqual(layoutModel?.pageIdentity?.pageIdsByNodeId, {
            'graph-1:1': 'wv_page_root_graph_1_1',
            'graph-2:1': 'wv_page_page_graph_2_1',
        });
        assert.ok(layoutModel?.elements?.['node:graph-1:1']);
        assert.ok(layoutModel?.elements?.['node:graph-2:1']);
        assert.equal(layoutModel?.elements?.['node:graph-1:1']?.nodeId, 'graph-1:1');
        assert.equal(layoutModel?.elements?.['node:graph-1:1']?.rawNodeId, '1');
        assert.equal(layoutModel?.elements?.['node:graph-2:1']?.nodeId, 'graph-2:1');
        assert.equal(layoutModel?.elements?.['node:graph-2:1']?.pageId, 'wv_page_page_graph_2_1');
    });

    it('generates root navigation shell and active-page rendering contract in HTML/client assets', async () => {
        const consumer = globalThis.NodeHelperHandoffConsumers['web-runtime'];
        assert.equal(typeof consumer, 'function');

        const result = await consumer({
            group: {
                mergedData: {
                    'webNode:node-root': {
                        id: 'node-root',
                        kind: 'web-root',
                        controls: { title: 'Main' },
                    },
                    'webNode:node-page-a': {
                        id: 'node-page-a',
                        kind: 'web-page',
                        controls: { pageName: 'Overview' },
                        layout: { parentNodeId: 'node-root', parentOutputIndex: 0 },
                    },
                    'webNode:node-page-b': {
                        id: 'node-page-b',
                        kind: 'web-page',
                        controls: { pageName: 'Reports' },
                        layout: { parentNodeId: 'node-root', parentOutputIndex: 1 },
                    },
                    'webNode:node-content': {
                        id: 'node-content',
                        kind: 'content',
                        controls: { title: 'Temperature', value: 25 },
                        layout: { parentNodeId: 'node-page-a', parentOutputIndex: 0 },
                    },
                },
                webserverSpecPatch: {
                    needsWebDataStore: true,
                    requiresPostRefresh: true,
                },
            },
            collection: {
                id: 'collection-page-shell',
                title: 'Page Shell Collection',
                webAssetGenerationMode: 'plain',
            },
        });

        const artifacts = Array.isArray(result?.artifacts) ? result.artifacts : [];
        const indexHtmlArtifact = artifacts.find(
            (artifact) =>
                artifact.targetPath === 'collection/webview/collection-page-shell/index.html'
        );
        const clientScriptArtifact = artifacts.find(
            (artifact) =>
                artifact.targetPath === 'collection/webview/collection-page-shell/webview_client.js'
        );

        assert.ok(indexHtmlArtifact);
        assert.ok(clientScriptArtifact);

        const indexHtml = String(indexHtmlArtifact.content);
        const clientScript = String(clientScriptArtifact.content);

        assert.ok(indexHtml.includes(':root { color-scheme: dark; }'));
        assert.ok(
            indexHtml.includes('background: radial-gradient(circle at top, #121826, #05060a 65%);')
        );
        assert.ok(indexHtml.includes('id="otter-runtime-shell"'));
        assert.ok(indexHtml.includes('id="otter-bg-logo"'));
        assert.ok(indexHtml.includes('#otter-bg-logo { position: absolute;'));
        assert.ok(indexHtml.includes('#otter-bg-logo img { width: min(56vmin, 420px);'));
        assert.ok(indexHtml.includes('opacity: 0.13;'));
        assert.ok(indexHtml.includes('filter: grayscale(1) brightness(0.42) contrast(1.05);'));
        assert.ok(indexHtml.includes('<img src="/micro-otter-128px-white.svg" alt="" />'));
        assert.ok(indexHtml.includes('#otter-dom-root { position: relative; z-index: 1;'));
        assert.ok(
            indexHtml.includes('id="wv-nav-shell" class="wv-shell" data-nav-mode="collapsed"')
        );
        assert.ok(indexHtml.includes('id="wv-page-nav"'));
        assert.ok(indexHtml.includes('id="wv-nav-toggle" class="wv-page-nav-toggle"'));
        assert.ok(indexHtml.includes('aria-label="Toggle navigation"'));
        assert.ok(indexHtml.includes('aria-controls="wv-nav-list"'));
        assert.ok(indexHtml.includes('&#9776;'));
        assert.ok(indexHtml.includes('id="wv-nav-list"'));
        assert.ok(
            indexHtml.includes(
                '#otter-runtime-shell { position: relative; min-height: calc(100vh - clamp(1.5rem, 4vw, 3rem)); width: 100%;'
            )
        );
        assert.ok(
            indexHtml.includes(
                '.wv-shell { position: relative; display: grid; grid-template-columns: 64px 1fr; min-height: 100%; width: 100%; border: 0; border-radius: 0;'
            )
        );
        assert.ok(
            indexHtml.includes(
                '.wv-shell[data-nav-mode="collapsed"] { grid-template-columns: 64px 1fr; }'
            )
        );
        assert.ok(
            indexHtml.includes(
                '.wv-shell[data-nav-mode="expanded"] { grid-template-columns: 220px 1fr; }'
            )
        );
        assert.ok(
            indexHtml.includes(
                '.wv-page-nav { border-right: 0; background: rgba(11, 18, 34, 0.95); padding: 14px 10px; }'
            )
        );
        assert.ok(
            indexHtml.includes(
                '.wv-page-nav-label-compact { display: inline-flex; align-items: center; justify-content: center; min-width: 22px; font-weight: 700; text-transform: uppercase; font-size: 24px; line-height: 1; }'
            )
        );
        assert.ok(
            indexHtml.includes(
                '.wv-shell[data-nav-mode="expanded"] .wv-page-nav-button { justify-content: flex-start; padding: 8px 10px; }'
            )
        );
        assert.ok(
            indexHtml.includes(
                '.wv-shell[data-nav-mode="expanded"] .wv-page-nav-label-full { display: inline; }'
            )
        );
        assert.ok(
            indexHtml.includes(
                '.wv-page-nav-button:focus-visible { outline: 2px solid #97bdff; outline-offset: 2px; }'
            )
        );
        assert.ok(
            indexHtml.includes(
                '.wv-shell::before { content: ""; position: absolute; inset: 0; background: url("/micro-otter-128px-white.svg")'
            )
        );
        assert.ok(indexHtml.includes('.wv-shell > * { position: relative; z-index: 1; }'));
        assert.ok(
            indexHtml.includes(
                '.wv-page-content { min-height: 24px; padding: 16px; width: 100%; overflow: auto; }'
            )
        );
        assert.ok(
            indexHtml.includes(
                '.wv-content { padding: 10px 12px; border: 0; border-radius: 0; background: rgba(17, 24, 43, 0.9); box-shadow: 0 10px 24px rgba(0, 0, 0, 0.26), 0 0 0 1px rgba(170, 210, 255, 0.28), 0 0 22px rgba(126, 190, 255, 0.34); }'
            )
        );
        assert.ok(
            indexHtml.includes(
                '.wv-title-content { padding: 0; border: 0; border-radius: 0; background: transparent; box-shadow: none; }'
            )
        );
        assert.ok(
            indexHtml.includes(
                '.wv-content-row { display: flex; align-items: baseline; justify-content: flex-start; gap: 8px; }'
            )
        );
        assert.ok(indexHtml.includes('data-wv-content-role="title">Temperature</span>'));
        assert.ok(indexHtml.includes('data-wv-content-role="value">25</span>'));
        assert.ok(indexHtml.includes('id="wv_nav_btn_wv_page_root_node_root"'));
        assert.ok(indexHtml.includes('id="wv_nav_btn_wv_page_page_node_page_a"'));
        assert.ok(indexHtml.includes('id="wv_nav_btn_wv_page_page_node_page_b"'));
        assert.ok(indexHtml.includes('class="wv-page-nav-label-compact"'));
        assert.ok(indexHtml.includes('class="wv-page-nav-label-full"'));
        assert.ok(indexHtml.includes('aria-label="Overview"'));
        assert.ok(indexHtml.includes('aria-label="Reports"'));
        assert.ok(indexHtml.includes('>⌂</span><span class="wv-page-nav-label-full">Main</span>'));
        assert.ok(
            indexHtml.includes('>O</span><span class="wv-page-nav-label-full">Overview</span>')
        );
        assert.ok(
            indexHtml.includes('>R</span><span class="wv-page-nav-label-full">Reports</span>')
        );
        assert.ok(!indexHtml.includes('wv_back_btn_'));
        assert.ok(!indexHtml.includes('class="wv-page-back-button"'));
        assert.ok(!indexHtml.includes('data-wv-back-to-main="true"'));
        assert.ok(!indexHtml.includes('data-wv-root-page-id='));
        assert.ok(indexHtml.includes('data-active-page-id="wv_page_root_node_root"'));
        assert.ok(indexHtml.includes('data-nav-mode="collapsed"'));
        assert.ok(indexHtml.includes('data-wv-page-scope="true"'));
        assert.ok(indexHtml.includes('id="wv_page_region_wv_page_root_node_root"'));
        assert.ok(indexHtml.includes('id="wv_page_region_wv_page_page_node_page_a"'));
        assert.ok(indexHtml.includes('id="wv_page_region_wv_page_page_node_page_b"'));
        const dom = new JSDOM(indexHtml);
        const document = dom.window.document;
        const pageRoot = document.getElementById('wv_page_region_wv_page_root_node_root');
        const pageA = document.getElementById('wv_page_region_wv_page_page_node_page_a');
        const pageB = document.getElementById('wv_page_region_wv_page_page_node_page_b');
        assert.ok(pageRoot?.parentElement);
        assert.equal(pageA?.parentElement, pageRoot?.parentElement);
        assert.equal(pageB?.parentElement, pageRoot?.parentElement);
        assert.ok(
            indexHtml.includes(
                'id="wv_page_region_wv_page_page_node_page_a" class="wv-page wv-page-scope"'
            )
        );
        assert.ok(indexHtml.includes('hidden'));

        assert.ok(
            clientScript.includes(
                'let activePageId = rootElement?.getAttribute("data-active-page-id") ?? "";'
            )
        );
        assert.ok(clientScript.includes('const DEFAULT_NAV_MODE = "collapsed";'));
        assert.ok(
            clientScript.includes(
                'const navToggleElement = document.getElementById("wv-nav-toggle");'
            )
        );
        assert.ok(
            clientScript.includes(
                'let navMode = rootElement?.getAttribute("data-nav-mode") ?? DEFAULT_NAV_MODE;'
            )
        );
        assert.ok(clientScript.includes('function applyNavMode(nextMode) {'));
        assert.ok(
            clientScript.includes(
                'nextToggleElement.setAttribute("aria-expanded", navMode === "expanded" ? "true" : "false");'
            )
        );
        assert.ok(clientScript.includes('if (navToggleElement) {'));
        assert.ok(
            clientScript.includes(
                'applyNavMode(navMode === "expanded" ? "collapsed" : "expanded");'
            )
        );
        assert.ok(clientScript.includes('applyNavMode(navMode);'));
        assert.ok(clientScript.includes('function applyPageState(nextPageId) {'));
        assert.ok(
            clientScript.includes(
                'const titleElement = targetElement.querySelector("[data-wv-content-role=title]");'
            )
        );
        assert.ok(
            clientScript.includes(
                'const valueElement = targetElement.querySelector("[data-wv-content-role=value]");'
            )
        );
        assert.ok(clientScript.includes('function applyValueTableUpdate(targetElement, entry) {'));
        assert.ok(clientScript.includes('data-wv-page-target'));
        assert.ok(clientScript.includes(`querySelectorAll('[data-wv-page-scope="true"]')`));
        assert.ok(!clientScript.includes('querySelectorAll("[data-wv-page-scope="true"]")'));
        assert.ok(!clientScript.includes('function handleBackToMainAction(event) {'));
        assert.ok(!clientScript.includes('[data-wv-back-to-main="true"]'));
        assert.ok(!clientScript.includes('data-wv-root-page-id'));
        assert.ok(!clientScript.includes('rootElement.addEventListener("click", (event) => {'));
        assert.ok(clientScript.includes('applyPageState(activePageId);'));
        assert.ok(clientScript.includes('const requestPayload = { activePageId };'));
        assert.ok(clientScript.includes('requestPayload.joystickUpdates = joystickUpdates;'));
        assert.ok(clientScript.includes('body: JSON.stringify(requestPayload),'));
    });

    it('keeps single-page collections on legacy-compatible HTML and refresh contract', async () => {
        const consumer = globalThis.NodeHelperHandoffConsumers['web-runtime'];
        assert.equal(typeof consumer, 'function');

        const result = await consumer({
            group: {
                mergedData: {
                    'webNode:node-root': {
                        id: 'node-root',
                        kind: 'web-root',
                        controls: { title: 'Legacy Single Page' },
                    },
                    'webNode:node-content': {
                        id: 'node-content',
                        kind: 'content',
                        controls: { title: 'Temperature', value: 25 },
                        layout: { parentNodeId: 'node-root', parentOutputIndex: 0 },
                    },
                    'webNode:node-vtable': {
                        id: 'node-vtable',
                        kind: 'value-table',
                        controls: { rowCount: 2 },
                        layout: { parentNodeId: 'node-root', parentOutputIndex: 1 },
                    },
                    'webNode:node-radar': {
                        id: 'node-radar',
                        kind: 'radar-display',
                        controls: {
                            maxRadiusPx: 40,
                            startAngleDeg: -90,
                            endAngleDeg: 90,
                            pieceCount: 8,
                            fillColor: '#66ddff',
                            initialRadiusNormalized: 0.5,
                        },
                        layout: { parentNodeId: 'node-root', parentOutputIndex: 2 },
                    },
                    'webNode:node-joystick': {
                        id: 'node-joystick',
                        kind: 'joystick-display',
                        controls: {
                            outerRadiusPx: 36,
                            outerStrokeWidthPx: 2,
                            outerStrokeColor: '#84b6ff',
                            outerFillColor: '#0f192c',
                            innerRadiusPx: 8,
                            innerFillColor: '#66d7ff',
                            showDegreeMarks: true,
                            degreeMarkIntervalDeg: 45,
                            degreeMarkColor: '#7fa1d6',
                        },
                        layout: { parentNodeId: 'node-root', parentOutputIndex: 3 },
                    },
                },
                webserverSpecPatch: {
                    needsWebDataStore: true,
                    requiresPostRefresh: true,
                },
            },
            collection: {
                id: 'collection-single-page-compat',
                title: 'Single Page Compat Collection',
                webAssetGenerationMode: 'plain',
            },
        });

        const artifacts = Array.isArray(result?.artifacts) ? result.artifacts : [];
        const indexHtmlArtifact = artifacts.find(
            (artifact) =>
                artifact.targetPath ===
                'collection/webview/collection-single-page-compat/index.html'
        );
        const clientScriptArtifact = artifacts.find(
            (artifact) =>
                artifact.targetPath ===
                'collection/webview/collection-single-page-compat/webview_client.js'
        );
        const runtimeFlagsArtifact = artifacts.find(
            (artifact) => artifact.targetPath === 'collection/webview_runtime_flags.json'
        );
        const hookArtifact = artifacts.find(
            (artifact) => artifact.targetPath === 'app/webserver_hooks_generated.py'
        );

        assert.ok(indexHtmlArtifact);
        assert.ok(clientScriptArtifact);
        assert.ok(runtimeFlagsArtifact);
        assert.ok(hookArtifact);

        const indexHtml = String(indexHtmlArtifact.content);
        const clientScript = String(clientScriptArtifact.content);
        const runtimeFlags = JSON.parse(String(runtimeFlagsArtifact.content));

        assert.equal(runtimeFlags?.pageMode, 'single-page-compat');
        assert.ok(indexHtml.includes(':root { color-scheme: dark; }'));
        assert.ok(
            indexHtml.includes('background: radial-gradient(circle at top, #121826, #05060a 65%);')
        );
        assert.ok(indexHtml.includes('id="otter-runtime-shell"'));
        assert.ok(indexHtml.includes('id="otter-bg-logo"'));
        assert.ok(indexHtml.includes('#otter-bg-logo { position: absolute;'));
        assert.ok(indexHtml.includes('#otter-bg-logo img { width: min(56vmin, 420px);'));
        assert.ok(indexHtml.includes('opacity: 0.13;'));
        assert.ok(indexHtml.includes('filter: grayscale(1) brightness(0.42) contrast(1.05);'));
        assert.ok(indexHtml.includes('<img src="/micro-otter-128px-white.svg" alt="" />'));
        assert.ok(
            indexHtml.includes(
                '.wv-content { padding: 10px 12px; border: 0; border-radius: 0; background: rgba(17, 24, 43, 0.9); box-shadow: 0 10px 24px rgba(0, 0, 0, 0.26), 0 0 0 1px rgba(170, 210, 255, 0.28), 0 0 22px rgba(126, 190, 255, 0.34); }'
            )
        );
        assert.ok(
            indexHtml.includes(
                '.wv-title-content { padding: 0; border: 0; border-radius: 0; background: transparent; box-shadow: none; }'
            )
        );
        assert.ok(indexHtml.includes('data-wv-content-role="title">Temperature</span>'));
        assert.ok(indexHtml.includes('data-wv-content-role="value">25</span>'));
        assert.ok(indexHtml.includes('data-node-kind="value-table"'));
        assert.ok(indexHtml.includes('data-wv-row-count="2"'));
        assert.ok(
            indexHtml.includes(
                '<table class="wv-value-table-grid" role="table" aria-label="Value table">'
            )
        );
        assert.ok(indexHtml.includes('<tbody>'));
        assert.ok(indexHtml.includes('<tr class="wv-value-table-row" data-wv-row-index="1">'));
        assert.ok(
            indexHtml.includes('<td class="wv-value-table-label" data-wv-cell-role="label"></td>')
        );
        assert.ok(
            indexHtml.includes('<td class="wv-value-table-value" data-wv-cell-role="value"></td>')
        );
        assert.ok(indexHtml.includes('.wv-value-table { width: fit-content; max-width: 100%; }'));
        assert.ok(
            indexHtml.includes(
                '.wv-value-table-grid tbody, .wv-value-table-grid tr, .wv-value-table-grid td { border: 0; }'
            )
        );
        assert.ok(indexHtml.includes('data-node-kind="radar-display"'));
        assert.ok(indexHtml.includes('class="wv-content wv-radar-display"'));
        assert.ok(indexHtml.includes('data-wv-piece-count="8"'));
        assert.ok(indexHtml.includes('data-wv-radar-role="guides"'));
        assert.ok(indexHtml.includes('data-wv-radar-guide="boundary-min"'));
        assert.ok(indexHtml.includes('data-wv-radar-guide="boundary-max"'));
        assert.ok(indexHtml.includes('data-wv-radar-guide="arc-max"'));
        assert.ok(indexHtml.includes('data-wv-radar-guide="arc-half"'));
        assert.ok(indexHtml.includes('data-wv-radar-role="slices"'));
        assert.ok(indexHtml.includes('id="wv_radar_piece_node_radar_0"'));
        assert.ok(
            indexHtml.includes(
                '.wv-radar-display { display: inline-flex; align-items: center; justify-content: center; padding: 10px; }'
            )
        );
        assert.ok(indexHtml.includes('.wv-radar-guide { fill: none;'));
        assert.ok(indexHtml.includes('data-node-kind="joystick-display"'));
        assert.ok(indexHtml.includes('class="wv-content wv-joystick-display"'));
        assert.ok(indexHtml.includes('data-wv-payload-key="wv_bind_joystick_node_joystick_'));
        assert.ok(indexHtml.includes('data-wv-joystick-recenter-on-release="true"'));
        assert.ok(indexHtml.includes('<rect class="wv-joystick-outer"'));
        assert.ok(!indexHtml.includes('<circle class="wv-joystick-outer"'));
        assert.ok(indexHtml.includes('data-wv-joystick-role="inner"'));
        assert.ok(indexHtml.includes('data-wv-joystick-role="marks"'));
        assert.ok(
            indexHtml.includes(
                '.wv-joystick-display { display: inline-flex; align-items: center; justify-content: center; padding: 10px; touch-action: none; user-select: none; }'
            )
        );
        assert.ok(indexHtml.includes('#otter-dom-root { position: relative; z-index: 1;'));
        assert.ok(indexHtml.includes('id="otter-dom-root"'));
        assert.ok(!indexHtml.includes('id="wv-page-nav"'));
        assert.ok(!indexHtml.includes('id="wv-nav-list"'));
        assert.ok(!indexHtml.includes('data-wv-page-scope="true"'));
        assert.ok(!indexHtml.includes('data-root-page-id='));

        assert.ok(!clientScript.includes('let activePageId ='));
        assert.ok(!clientScript.includes('function applyPageState(nextPageId) {'));
        assert.ok(!clientScript.includes('data-wv-page-target'));
        assert.ok(!clientScript.includes('function handleBackToMainAction(event) {'));
        assert.ok(!clientScript.includes('data-wv-back-to-main'));
        assert.ok(!clientScript.includes('data-wv-root-page-id'));
        assert.ok(!clientScript.includes('const requestPayload = { activePageId };'));
        assert.ok(
            clientScript.includes(
                'const titleElement = targetElement.querySelector("[data-wv-content-role=title]");'
            )
        );
        assert.ok(
            clientScript.includes(
                'const valueElement = targetElement.querySelector("[data-wv-content-role=value]");'
            )
        );
        assert.ok(clientScript.includes('function applyValueTableUpdate(targetElement, entry) {'));
        assert.ok(
            clientScript.includes('function applyRadarDisplayUpdate(targetElement, entry) {')
        );
        assert.ok(
            clientScript.includes(
                'function buildRadarArcPathData(maxRadiusPx, startAngleDeg, endAngleDeg, radiusNormalized) {'
            )
        );
        assert.ok(
            clientScript.includes('function buildRadarBoundaryPathData(maxRadiusPx, angleDeg) {')
        );
        assert.ok(
            clientScript.includes('function applyJoystickDisplayUpdate(targetElement, entry) {')
        );
        assert.ok(
            clientScript.includes('function buildJoystickMarkLines(outerRadiusPx, intervalDeg) {')
        );
        assert.ok(
            clientScript.includes(
                'const slicesElement = targetElement.querySelector("[data-wv-radar-role=slices]");'
            )
        );
        assert.ok(
            clientScript.includes(
                'let guidesElement = targetElement.querySelector("[data-wv-radar-role=guides]");'
            )
        );
        assert.ok(clientScript.includes('const NODE_KIND_UPDATE_HANDLERS = {'));
        assert.ok(clientScript.includes('"radar-display": applyRadarDisplayUpdate,'));
        assert.ok(clientScript.includes('"joystick-display": applyJoystickDisplayUpdate,'));
        assert.ok(clientScript.includes('const requestPayload = {};'));
        assert.ok(clientScript.includes('requestPayload.joystickUpdates = joystickUpdates;'));
        assert.ok(clientScript.includes('function applyRefreshErrorState(errorMessage) {'));
        assert.ok(clientScript.includes('wv-refresh-error-banner'));
        assert.ok(
            clientScript.includes('rootElement.setAttribute("data-refresh-error", message);')
        );
        assert.ok(
            clientScript.includes(
                'const localUserUpdate = Boolean(entry && entry._localUserInput === true);'
            )
        );
        assert.ok(clientScript.includes('if (!localUserUpdate && dragActive) {'));
        assert.ok(clientScript.includes('if (!localUserUpdate && dragEndPending) {'));
        assert.ok(clientScript.includes('function findJoystickElementByPayloadKey(payloadKey) {'));
        assert.ok(
            clientScript.includes(
                'targetElement.setAttribute("data-wv-joystick-drag-active", "true");'
            )
        );
        assert.ok(
            clientScript.includes(
                'targetElement.setAttribute("data-wv-joystick-drag-active", "false");'
            )
        );
        assert.ok(
            clientScript.includes(
                'targetElement.setAttribute("data-wv-joystick-drag-end-pending", "true");'
            )
        );
        assert.ok(
            clientScript.includes(
                'targetElement.setAttribute("data-wv-joystick-drag-end-pending", "false");'
            )
        );
        assert.ok(clientScript.includes('Object.keys(joystickUpdates).forEach((payloadKey) => {'));
        assert.ok(clientScript.includes('body: JSON.stringify(requestPayload),'));
        assert.ok(clientScript.includes('function initializeJoystickInput(targetElement) {'));
        assert.ok(
            clientScript.includes('queueJoystickFrontendUpdate(targetElement, axis1, axis2);')
        );
        assert.ok(clientScript.includes('data-wv-joystick-drag-active'));
        assert.ok(clientScript.includes('data-wv-joystick-drag-end-pending'));
        assert.ok(clientScript.includes('data-wv-joystick-recenter-on-release'));
        assert.ok(clientScript.includes('if (!useUserInput) {'));
        assert.ok(clientScript.includes('if (useUserInput) {'));
        assert.ok(clientScript.includes('if (recenterOnRelease) {'));
        assert.ok(clientScript.includes('outerElement.setAttribute("x", "0");'));
        assert.ok(clientScript.includes('outerElement.setAttribute("y", "0");'));
        assert.ok(clientScript.includes('outerElement.setAttribute("width", String(diameter));'));
        assert.ok(clientScript.includes('outerElement.setAttribute("height", String(diameter));'));
        assert.ok(
            !clientScript.includes('outerElement.setAttribute("cx", String(outerRadiusPx));')
        );
        assert.ok(
            clientScript.includes(
                'const maxDistanceX = Math.max(0, (outerRadiusPx - innerRadiusPx) * scaleX);'
            )
        );
        assert.ok(
            clientScript.includes(
                'const maxDistanceY = Math.max(0, (outerRadiusPx - innerRadiusPx) * scaleY);'
            )
        );
        assert.ok(clientScript.includes('const axis1 = maxDistanceX > 0'));
        assert.ok(clientScript.includes('const axis2 = maxDistanceY > 0'));
        assert.ok(clientScript.includes('const innerY = outerRadiusPx - axis2 * maxDistance;'));
        assert.ok(clientScript.includes('Math.max(-1, Math.min(1, offsetX / maxDistanceX))'));
        assert.ok(clientScript.includes('Math.max(-1, Math.min(1, -offsetY / maxDistanceY))'));
        assert.ok(
            !clientScript.includes(
                'const axisMagnitude = Math.sqrt(axis1 * axis1 + axis2 * axis2);'
            )
        );
        assert.ok(!clientScript.includes('if (axisMagnitude > 1) {'));
        assert.ok(
            !clientScript.includes('const magnitude = Math.sqrt(axis1 * axis1 + axis2 * axis2);')
        );
        assert.ok(!clientScript.includes('if (magnitude > 1) {'));
        assert.ok(!clientScript.includes('const radiusNormalized ='));
        assert.ok(
            !clientScript.includes(
                'const distancePx = Math.sqrt(offsetX * offsetX + offsetY * offsetY);'
            )
        );

        assert.ok(String(hookArtifact.content).includes("'page_id': None"));
    });

    it('toggles nav mode without changing active page selection', async () => {
        const consumer = globalThis.NodeHelperHandoffConsumers['web-runtime'];
        assert.equal(typeof consumer, 'function');

        const result = await consumer({
            group: {
                mergedData: {
                    'webNode:node-root': {
                        id: 'node-root',
                        kind: 'web-root',
                        controls: { title: 'Main' },
                    },
                    'webNode:node-page-a': {
                        id: 'node-page-a',
                        kind: 'web-page',
                        controls: { pageName: 'Overview' },
                        layout: { parentNodeId: 'node-root', parentOutputIndex: 0 },
                    },
                    'webNode:node-page-b': {
                        id: 'node-page-b',
                        kind: 'web-page',
                        controls: { pageName: 'Reports' },
                        layout: { parentNodeId: 'node-root', parentOutputIndex: 1 },
                    },
                },
                webserverSpecPatch: {
                    needsWebDataStore: true,
                    requiresPostRefresh: true,
                },
            },
            collection: {
                id: 'collection-nav-toggle-state',
                title: 'Nav Toggle State Collection',
                webAssetGenerationMode: 'plain',
            },
        });

        const artifacts = Array.isArray(result?.artifacts) ? result.artifacts : [];
        const indexHtmlArtifact = artifacts.find(
            (artifact) =>
                artifact.targetPath === 'collection/webview/collection-nav-toggle-state/index.html'
        );
        const clientScriptArtifact = artifacts.find(
            (artifact) =>
                artifact.targetPath ===
                'collection/webview/collection-nav-toggle-state/webview_client.js'
        );

        assert.ok(indexHtmlArtifact);
        assert.ok(clientScriptArtifact);

        const indexHtml = String(indexHtmlArtifact.content);
        const clientScript = String(clientScriptArtifact.content);
        const dom = new JSDOM(indexHtml, {
            runScripts: 'outside-only',
            url: 'http://localhost/',
            pretendToBeVisual: true,
        });

        const { window } = dom;
        window.fetch = async () => ({
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ updates: [] }),
        });
        window.setInterval = () => 1;
        window.clearInterval = () => {};
        window.console = { warn: () => {} };

        window.eval(clientScript);

        const rootElement = window.document.getElementById('otter-dom-root');
        const navShellElement = window.document.getElementById('wv-nav-shell');
        const navToggleElement = window.document.getElementById('wv-nav-toggle');
        const pageAButton = window.document.getElementById('wv_nav_btn_wv_page_page_node_page_a');

        assert.ok(rootElement);
        assert.ok(navShellElement);
        assert.ok(navToggleElement);
        assert.ok(pageAButton);

        assert.equal(rootElement.getAttribute('data-nav-mode'), 'collapsed');
        assert.equal(navShellElement.getAttribute('data-nav-mode'), 'collapsed');
        assert.equal(navToggleElement.getAttribute('aria-expanded'), 'false');
        assert.equal(rootElement.getAttribute('data-active-page-id'), 'wv_page_root_node_root');

        navToggleElement.click();
        assert.equal(rootElement.getAttribute('data-nav-mode'), 'expanded');
        assert.equal(navShellElement.getAttribute('data-nav-mode'), 'expanded');
        assert.equal(navToggleElement.getAttribute('aria-expanded'), 'true');
        assert.equal(rootElement.getAttribute('data-active-page-id'), 'wv_page_root_node_root');

        pageAButton.click();
        assert.equal(rootElement.getAttribute('data-active-page-id'), 'wv_page_page_node_page_a');

        navToggleElement.click();
        assert.equal(rootElement.getAttribute('data-nav-mode'), 'collapsed');
        assert.equal(navShellElement.getAttribute('data-nav-mode'), 'collapsed');
        assert.equal(navToggleElement.getAttribute('aria-expanded'), 'false');
        assert.equal(rootElement.getAttribute('data-active-page-id'), 'wv_page_page_node_page_a');

        dom.window.close();
    });

    it('generates deterministic HTML and layout artifacts for identical input graphs', async () => {
        const consumer = globalThis.NodeHelperHandoffConsumers['web-runtime'];
        assert.equal(typeof consumer, 'function');

        const consumerContext = {
            group: {
                mergedData: {
                    'webNode:node-root': {
                        id: 'node-root',
                        kind: 'web-root',
                        controls: { title: 'Deterministic Root' },
                    },
                    'webNode:node-row': {
                        id: 'node-row',
                        kind: 'row',
                        controls: { columnCount: 2 },
                        layout: { parentNodeId: 'node-root', parentOutputIndex: 0 },
                    },
                    'webNode:node-content': {
                        id: 'node-content',
                        kind: 'content',
                        controls: { title: 'Humidity', value: 47 },
                        layout: { parentNodeId: 'node-row', parentOutputIndex: 0 },
                    },
                    'webNode:node-title': {
                        id: 'node-title',
                        kind: 'title-content',
                        controls: { title: 'Live', headingLevel: 3 },
                        layout: { parentNodeId: 'node-row', parentOutputIndex: 1 },
                    },
                },
                webserverSpecPatch: {
                    postRefreshRoute: '/api/webview/refresh',
                    needsWebDataStore: true,
                    requiresPostRefresh: true,
                },
            },
            collection: {
                id: 'collection-deterministic',
                title: 'Deterministic Collection',
            },
        };

        const [resultA, resultB] = await Promise.all([
            consumer(consumerContext),
            consumer(consumerContext),
        ]);

        const artifactsA = Array.isArray(resultA?.artifacts) ? resultA.artifacts : [];
        const artifactsB = Array.isArray(resultB?.artifacts) ? resultB.artifacts : [];

        function getArtifactContent(artifacts, targetPath) {
            const artifact = artifacts.find((entry) => entry?.targetPath === targetPath);
            assert.ok(artifact, `Missing artifact ${targetPath}`);
            return String(artifact.content);
        }

        const indexHtmlA = getArtifactContent(
            artifactsA,
            'collection/webview/collection-deterministic/index.html.gz'
        );
        const indexHtmlB = getArtifactContent(
            artifactsB,
            'collection/webview/collection-deterministic/index.html.gz'
        );
        assert.equal(indexHtmlA, indexHtmlB);

        const layoutModelA = getArtifactContent(artifactsA, 'collection/webview_layout_model.json');
        const layoutModelB = getArtifactContent(artifactsB, 'collection/webview_layout_model.json');
        assert.equal(layoutModelA, layoutModelB);

        const hookModuleA = getArtifactContent(artifactsA, 'app/webserver_hooks_generated.py');
        const hookModuleB = getArtifactContent(artifactsB, 'app/webserver_hooks_generated.py');
        assert.equal(hookModuleA, hookModuleB);
    });

    it('emits deterministic diagnostics for malformed layout parent references', async () => {
        const consumer = globalThis.NodeHelperHandoffConsumers['web-runtime'];
        assert.equal(typeof consumer, 'function');

        const result = await consumer({
            group: {
                mergedData: {
                    'webNode:node-root': {
                        id: 'node-root',
                        kind: 'web-root',
                        controls: { title: 'Diagnostics Root' },
                        layout: { parentNodeId: 'node-self', parentOutputIndex: 0 },
                    },
                    'webNode:node-orphan': {
                        id: 'node-orphan',
                        kind: 'row',
                        controls: { columnCount: 1 },
                    },
                    'webNode:node-missing-parent': {
                        id: 'node-missing-parent',
                        kind: 'content',
                        controls: { title: 'Missing Parent', value: 1 },
                        layout: { parentNodeId: 'node-does-not-exist', parentOutputIndex: 0 },
                    },
                },
                webserverSpecPatch: {
                    needsWebDataStore: true,
                    requiresPostRefresh: true,
                },
            },
            collection: {
                id: 'collection-layout-diagnostics',
                title: 'Layout Diagnostics Collection',
            },
        });

        const artifacts = Array.isArray(result?.artifacts) ? result.artifacts : [];
        const layoutArtifact = artifacts.find(
            (artifact) => artifact.targetPath === 'collection/webview_layout_model.json'
        );
        assert.ok(layoutArtifact);

        const layoutModel = JSON.parse(String(layoutArtifact.content));
        const diagnosticCodes = new Set(
            (layoutModel?.diagnostics || []).map((entry) => entry?.code)
        );

        assert.equal(diagnosticCodes.has('root-has-parent'), true);
        assert.equal(diagnosticCodes.has('missing-parent'), true);
        assert.equal(diagnosticCodes.has('parent-not-found'), true);
    });

    it('emits deterministic duplicate-page-id diagnostics when page ids collide', async () => {
        const consumer = globalThis.NodeHelperHandoffConsumers['web-runtime'];
        assert.equal(typeof consumer, 'function');

        const result = await consumer({
            group: {
                mergedData: {
                    'webNode:node-root': {
                        id: 'node-root',
                        kind: 'web-root',
                        controls: { title: 'Diagnostics Root' },
                    },
                    'webNode:node-page-a': {
                        id: 'Page A',
                        kind: 'web-page',
                        controls: { pageName: 'Page A' },
                    },
                    'webNode:node-page-b': {
                        id: 'page-a',
                        kind: 'web-page',
                        controls: { pageName: 'Page B' },
                    },
                },
                webserverSpecPatch: {
                    needsWebDataStore: true,
                    requiresPostRefresh: true,
                },
            },
            collection: {
                id: 'collection-duplicate-page-id',
                title: 'Duplicate Page Id Collection',
            },
        });

        const artifacts = Array.isArray(result?.artifacts) ? result.artifacts : [];
        const layoutArtifact = artifacts.find(
            (artifact) => artifact.targetPath === 'collection/webview_layout_model.json'
        );
        assert.ok(layoutArtifact);

        const layoutModel = JSON.parse(String(layoutArtifact.content));
        const duplicatePageDiagnostics = (layoutModel?.diagnostics || []).filter(
            (entry) => entry?.code === 'duplicate-page-id'
        );

        assert.equal(duplicatePageDiagnostics.length, 1);
        assert.equal(duplicatePageDiagnostics[0]?.pageId, 'wv_page_page_page_a');
        assert.deepEqual(duplicatePageDiagnostics[0]?.nodeIds, ['Page A', 'page-a']);
    });

    it('emits deterministic missing-root-ownership diagnostics when web-root is absent', async () => {
        const consumer = globalThis.NodeHelperHandoffConsumers['web-runtime'];
        assert.equal(typeof consumer, 'function');

        const result = await consumer({
            group: {
                mergedData: {
                    'webNode:node-page-a': {
                        id: 'page-alpha',
                        kind: 'web-page',
                        controls: { pageName: 'Alpha' },
                    },
                },
                webserverSpecPatch: {
                    needsWebDataStore: true,
                    requiresPostRefresh: true,
                },
            },
            collection: {
                id: 'collection-missing-root-ownership',
                title: 'Missing Root Ownership Collection',
            },
        });

        const artifacts = Array.isArray(result?.artifacts) ? result.artifacts : [];
        const layoutArtifact = artifacts.find(
            (artifact) => artifact.targetPath === 'collection/webview_layout_model.json'
        );
        assert.ok(layoutArtifact);

        const layoutModel = JSON.parse(String(layoutArtifact.content));
        const missingRootOwnership = (layoutModel?.diagnostics || []).find(
            (entry) => entry?.code === 'missing-root-ownership'
        );

        assert.ok(missingRootOwnership);
        assert.equal(missingRootOwnership?.reason, 'missing-web-root-node');
    });

    it('emits deterministic invalid-page-navigation-metadata diagnostics', async () => {
        const consumer = globalThis.NodeHelperHandoffConsumers['web-runtime'];
        assert.equal(typeof consumer, 'function');

        const result = await consumer({
            group: {
                mergedData: {
                    'webNode:node-root': {
                        id: 'node-root',
                        kind: 'web-root',
                        controls: { title: 'Diagnostics Root' },
                    },
                    'webNode:node-page-a': {
                        id: 'page-alpha',
                        kind: 'web-page',
                        controls: { pageName: 42 },
                    },
                },
                webserverSpecPatch: {
                    needsWebDataStore: true,
                    requiresPostRefresh: true,
                },
            },
            collection: {
                id: 'collection-invalid-nav-metadata',
                title: 'Invalid Navigation Metadata Collection',
            },
        });

        const artifacts = Array.isArray(result?.artifacts) ? result.artifacts : [];
        const layoutArtifact = artifacts.find(
            (artifact) => artifact.targetPath === 'collection/webview_layout_model.json'
        );
        assert.ok(layoutArtifact);

        const layoutModel = JSON.parse(String(layoutArtifact.content));
        const invalidNavDiagnostics = (layoutModel?.diagnostics || []).filter(
            (entry) => entry?.code === 'invalid-page-navigation-metadata'
        );

        assert.equal(invalidNavDiagnostics.length >= 1, true);
        assert.equal(
            invalidNavDiagnostics.some((entry) => entry?.reason === 'invalid-page-name-type'),
            true
        );
    });

    it('drops compressed route metadata when compression is unavailable', async () => {
        const consumer = globalThis.NodeHelperHandoffConsumers['web-runtime'];
        assert.equal(typeof consumer, 'function');

        const originalCompressionStream = globalThis.CompressionStream;
        try {
            globalThis.CompressionStream = undefined;

            const result = await consumer({
                group: {
                    mergedData: {
                        'webNode:node-root': {
                            id: 'node-root',
                            kind: 'web-root',
                            controls: { title: 'Micro Otter' },
                        },
                    },
                    webserverSpecPatch: {},
                },
                collection: {
                    id: 'collection-compression-unavailable',
                    title: 'Compression Unavailable',
                },
            });

            const artifacts = Array.isArray(result?.artifacts) ? result.artifacts : [];
            const compressedArtifacts = artifacts.filter(
                (artifact) =>
                    typeof artifact.targetPath === 'string' && artifact.targetPath.endsWith('.gz')
            );
            assert.equal(compressedArtifacts.length, 0);

            const manifestArtifact = artifacts.find(
                (artifact) => artifact.targetPath === 'collection/webview_manifest.json'
            );
            assert.ok(manifestArtifact);
            const manifest = JSON.parse(String(manifestArtifact.content));
            const staticRoutes = manifest?.webserverSpec?.routes?.staticRoutes || [];
            staticRoutes.forEach((entry) => {
                assert.equal(
                    Object.prototype.hasOwnProperty.call(entry, 'compressedPath'),
                    false,
                    'compressedPath should be omitted when compression fails'
                );
                assert.equal(entry?.varyAcceptEncoding, false);
            });

            const runtimeFlagsArtifact = artifacts.find(
                (artifact) => artifact.targetPath === 'collection/webview_runtime_flags.json'
            );
            assert.ok(runtimeFlagsArtifact);
            const runtimeFlags = JSON.parse(String(runtimeFlagsArtifact.content));
            (runtimeFlags?.staticRoutes || []).forEach((entry) => {
                assert.equal(entry?.compressedPath, null);
                assert.equal(entry?.forceCompressedOnly, false);
            });

            const hookArtifact = artifacts.find(
                (artifact) => artifact.targetPath === 'app/webserver_hooks_generated.py'
            );
            assert.ok(hookArtifact);
            assert.ok(String(hookArtifact.content).includes("'compressed_path': None"));
            assert.ok(String(hookArtifact.content).includes("'force_compressed_only': False"));
        } finally {
            globalThis.CompressionStream = originalCompressionStream;
        }
    });

    it('registers tile generators with correct types', () => {
        assert.equal(typeof globalThis.NodeInitGenerators?.webviewTile, 'function');
        assert.equal(typeof globalThis.NodeCodeGenerators?.webviewTile, 'function');
        assert.equal(typeof globalThis.NodeHelperGenerators?.webviewTile, 'function');
    });

    it('tile node definition has required webview fields', () => {
        const definitions = JSON.parse(readFileSync(webviewDefinitionsPath, 'utf8'));
        const tileDef = definitions?.nodeTypes?.['web-view-tile'];
        assert.ok(tileDef, 'Expected web-view-tile node definition');
        assert.equal(tileDef.implementations?.python?.type, 'code-generator');
        assert.equal(tileDef.implementations?.python?.value, 'NodeCodeGenerators.webviewTile');
        assert.equal(tileDef.initImplementations?.python?.type, 'code-generator');
        assert.equal(tileDef.initImplementations?.python?.value, 'NodeInitGenerators.webviewTile');
        assert.equal(tileDef.helperImplementations?.python?.type, 'helper-generator');
        assert.equal(
            tileDef.helperImplementations?.python?.value,
            'NodeHelperGenerators.webviewTile'
        );
        assert.equal(tileDef.helperImplementations?.python?.helperGroup, 'web-runtime');
        assert.equal(tileDef.initFunction, 'init_webview');
        assert.equal(tileDef.executionPhase, 'init');
    });

    it('tile init generator emits passthrough assignment', () => {
        const initGenerator = globalThis.NodeInitGenerators.webviewTile;
        const context = {
            ...createContext(),
            inputs: ['node_parent_out0'],
            outputs: ['node_out0'],
            node: { id: 'node-tile-1', type: 'web-view-tile', controlValues: {} },
        };
        const result = initGenerator(context);
        assert.equal(typeof result?.statement, 'string');
        assert.ok(result.statement.includes('node_out0 = node_parent_out0'));
    });

    it('tile loop generator emits no-op comment', () => {
        const loopGenerator = globalThis.NodeCodeGenerators.webviewTile;
        const context = {
            ...createContext(),
            inputs: ['None'],
            outputs: ['node_out0'],
            node: { id: 'node-tile-1', type: 'web-view-tile', controlValues: {} },
        };
        const result = loopGenerator(context);
        assert.equal(typeof result?.statement, 'string');
        assert.ok(result.statement.includes('# webview:'));
        assert.ok(result.statement.includes(':loop'));
    });

    it('tile renderMarkup produces a div with wv-tile class and data attributes', () => {
        const shared = globalThis.WebviewGeneratorShared;
        const implementation = shared.getNodeKindImplementation('web-view-tile');
        assert.ok(implementation, 'Expected web-view-tile implementation registered');
        assert.equal(typeof implementation.renderMarkup, 'function');

        const lines = implementation.renderMarkup({
            indent: '  ',
            childIndent: '    ',
            nodeId: 'node-tile-42',
            element: {
                binding: { elementId: 'wv_el_tile_node-tile-42_s0' },
                controls: { title: '' },
            },
            helpers: {
                escapeHtml: (v) => String(v ?? ''),
                normalizeBindingSegment: (v) => String(v ?? '').replace(/[^a-zA-Z0-9_:-]+/g, '_'),
                renderChildren: () => ['    <p>child</p>'],
            },
        });

        assert.ok(Array.isArray(lines));
        assert.ok(lines.some((l) => String(l).includes('class="wv-tile"')));
        assert.ok(lines.some((l) => String(l).includes('id="wv_el_tile_node-tile-42_s0"')));
        assert.ok(lines.some((l) => String(l).includes('data-node-id="node-tile-42"')));
        assert.ok(lines.some((l) => String(l).includes('<p>child</p>')));
    });

    it('tile renderMarkup includes title span when title is non-empty', () => {
        const shared = globalThis.WebviewGeneratorShared;
        const implementation = shared.getNodeKindImplementation('web-view-tile');

        const lines = implementation.renderMarkup({
            indent: '  ',
            childIndent: '    ',
            nodeId: 'node-tile-43',
            element: {
                binding: { elementId: 'wv_el_tile_node-tile-43_s0' },
                controls: { title: 'Sensor Data' },
            },
            helpers: {
                escapeHtml: (v) => String(v ?? ''),
                normalizeBindingSegment: (v) => String(v ?? ''),
                renderChildren: () => [],
            },
        });

        assert.ok(Array.isArray(lines));
        assert.ok(
            lines.some((l) => String(l).includes('<span class="wv-tile-title">Sensor Data</span>'))
        );
    });

    it('tile renderMarkup omits title span when title is empty', () => {
        const shared = globalThis.WebviewGeneratorShared;
        const implementation = shared.getNodeKindImplementation('web-view-tile');

        const lines = implementation.renderMarkup({
            indent: '  ',
            childIndent: '    ',
            nodeId: 'node-tile-44',
            element: {
                binding: { elementId: 'wv_el_tile_node-tile-44_s0' },
                controls: { title: '' },
            },
            helpers: {
                escapeHtml: (v) => String(v ?? ''),
                normalizeBindingSegment: (v) => String(v ?? ''),
                renderChildren: () => [],
            },
        });

        assert.ok(Array.isArray(lines));
        assert.ok(!lines.some((l) => String(l).includes('wv-tile-title')));
        assert.ok(lines.some((l) => String(l).includes('<!-- empty-tile -->')));
    });

    it('tile renderMarkup uses fallback elementId when binding is absent', () => {
        const shared = globalThis.WebviewGeneratorShared;
        const implementation = shared.getNodeKindImplementation('web-view-tile');

        const lines = implementation.renderMarkup({
            indent: '',
            childIndent: '  ',
            nodeId: 'my-tile',
            element: { controls: { title: '' } },
            helpers: {
                escapeHtml: (v) => String(v ?? ''),
                normalizeBindingSegment: (v) =>
                    String(v ?? '')
                        .trim()
                        .replace(/[^a-zA-Z0-9_:-]+/g, '_') || 'unknown',
                renderChildren: () => [],
            },
        });

        assert.ok(Array.isArray(lines));
        assert.ok(lines.some((l) => String(l).includes('id="wv_el_tile_my-tile"')));
    });

    it('tile renderClientStyleRules returns wv-tile CSS', () => {
        const shared = globalThis.WebviewGeneratorShared;
        const implementation = shared.getNodeKindImplementation('web-view-tile');
        assert.equal(typeof implementation.renderClientStyleRules, 'function');

        const rules = implementation.renderClientStyleRules();
        assert.ok(Array.isArray(rules));
        assert.ok(rules.some((r) => String(r).includes('.wv-tile')));
        assert.ok(rules.some((r) => String(r).includes('.wv-tile-title')));
    });

    it('tile layout model element has binding with tile type code', async () => {
        const consumer = globalThis.NodeHelperHandoffConsumers['web-runtime'];
        assert.equal(typeof consumer, 'function');

        const result = await consumer({
            group: {
                mergedData: {
                    'webNode:node-root': {
                        id: 'node-root',
                        kind: 'web-root',
                        controls: { title: 'Tile Test Root' },
                    },
                    'webNode:node-tile': {
                        id: 'node-tile',
                        kind: 'web-view-tile',
                        controls: { title: 'My Tile' },
                        layout: {
                            parentNodeId: 'node-root',
                            parentOutputIndex: 0,
                        },
                    },
                },
                webserverSpecPatch: {
                    disableCompressedAssets: true,
                },
            },
            collection: {
                id: 'collection-tile-test',
                title: 'Tile Test Collection',
                webAssetGenerationMode: 'plain',
            },
        });

        const artifacts = Array.isArray(result?.artifacts) ? result.artifacts : [];
        const layoutArtifact = artifacts.find(
            (a) => a.targetPath === 'collection/webview_layout_model.json'
        );
        assert.ok(layoutArtifact, 'Expected layout model artifact');

        const layoutModel = JSON.parse(String(layoutArtifact.content));
        const tileElement = layoutModel?.elements?.['node:node-tile'];
        assert.ok(tileElement, 'Expected tile element in layout model');
        assert.ok(tileElement.binding, 'Expected tile binding to be present');
        assert.ok(
            String(tileElement.binding.elementId).includes('tile'),
            'Expected tile type code in elementId'
        );
        assert.equal(tileElement.controls?.title, 'My Tile');
    });

    it('tile HTML markup includes child elements and tile title span', async () => {
        const consumer = globalThis.NodeHelperHandoffConsumers['web-runtime'];

        const result = await consumer({
            group: {
                mergedData: {
                    'webNode:node-root': {
                        id: 'node-root',
                        kind: 'web-root',
                        controls: { title: 'Tile HTML Test' },
                    },
                    'webNode:node-tile': {
                        id: 'node-tile',
                        kind: 'web-view-tile',
                        controls: { title: 'Status' },
                        layout: {
                            parentNodeId: 'node-root',
                            parentOutputIndex: 0,
                        },
                    },
                    'webNode:node-content': {
                        id: 'node-content',
                        kind: 'content',
                        controls: { title: 'Temp', value: 22 },
                        layout: {
                            parentNodeId: 'node-tile',
                            parentOutputIndex: 0,
                        },
                    },
                },
                webserverSpecPatch: {
                    needsWebDataStore: true,
                    requiresPostRefresh: true,
                    disableCompressedAssets: true,
                },
            },
            collection: {
                id: 'collection-tile-html',
                title: 'Tile HTML Collection',
                webAssetGenerationMode: 'plain',
            },
        });

        const artifacts = Array.isArray(result?.artifacts) ? result.artifacts : [];
        const indexHtmlArtifact = artifacts.find(
            (a) => a.targetPath === 'collection/webview/collection-tile-html/index.html'
        );
        assert.ok(indexHtmlArtifact, 'Expected index.html artifact');

        const indexHtml = String(indexHtmlArtifact.content);
        assert.ok(indexHtml.includes('class="wv-tile"'), 'Expected wv-tile class in HTML');
        assert.ok(
            indexHtml.includes('<span class="wv-tile-title">Status</span>'),
            'Expected tile title span'
        );
        assert.ok(indexHtml.includes('.wv-tile {'), 'Expected wv-tile CSS rule');
        assert.ok(indexHtml.includes('.wv-tile-title {'), 'Expected wv-tile-title CSS rule');
    });

    // =========================================================================
    // web-view-number-input tests
    // =========================================================================

    it('registers number-input generators with correct types', () => {
        assert.equal(typeof globalThis.NodeInitGenerators.webviewNumberInput, 'function');
        assert.equal(typeof globalThis.NodeCodeGenerators.webviewNumberInput, 'function');
        assert.equal(typeof globalThis.NodeHelperGenerators.webviewNumberInput, 'function');
    });

    it('number-input node definition has required webview fields', () => {
        const definitions = JSON.parse(readFileSync(webviewDefinitionsPath, 'utf8'));
        const numInputDef = definitions?.nodeTypes?.['web-view-number-input'];
        assert.ok(numInputDef, 'Expected web-view-number-input node definition');
        assert.equal(numInputDef.executionPhase, 'both');
        assert.equal(numInputDef.initFunction, 'init_webview');
        assert.ok(Array.isArray(numInputDef.inputs) && numInputDef.inputs.length === 3);
        assert.ok(Array.isArray(numInputDef.outputs) && numInputDef.outputs.length === 3);
        assert.equal(numInputDef.inputs[0].id, 'parent');
        assert.equal(numInputDef.inputs[1].id, 'title');
        assert.equal(numInputDef.inputs[2].id, 'value');
        assert.equal(numInputDef.outputs[0].id, 'element');
        assert.equal(numInputDef.outputs[1].id, 'value');
        assert.equal(numInputDef.outputs[2].id, 'changed');
        assert.equal(numInputDef.outputs[2].outputType, 'bool');
        const controlIds = (numInputDef.controls || []).map((control) => control.id);
        assert.deepEqual(controlIds, ['minValue', 'maxValue', 'step', 'maxDigits', 'persist']);
        const controlsById = new Map((numInputDef.controls || []).map((c) => [c.id, c]));
        assert.equal(controlsById.get('minValue').default, 0);
        assert.equal(controlsById.get('maxValue').default, 100);
        assert.equal(controlsById.get('step').default, 1);
        assert.equal(controlsById.get('step').min, 0.001);
    });

    it('number-input normalizeControls clamps values and normalizes bounds', () => {
        const impl =
            globalThis.WebviewGeneratorShared.getNodeKindImplementation?.('web-view-number-input');
        assert.equal(impl.normalizeControls({ value: 150 }).value, 100);
        assert.equal(impl.normalizeControls({ value: -5 }).value, 0);

        const swapped = impl.normalizeControls({ minValue: 10, maxValue: 5, value: 7 });
        assert.equal(swapped.minValue, 5);
        assert.equal(swapped.maxValue, 10);
        assert.equal(swapped.value, 7);

        assert.equal(impl.normalizeControls({ step: 0 }).step, 0.001);
        assert.equal(impl.normalizeControls({}).minValue, 0);
        assert.equal(impl.normalizeControls({}).maxValue, 100);
        assert.equal(impl.normalizeControls({}).step, 1);
    });

    it('number-input init generator emits DualInputControl instantiation', () => {
        const initGen = globalThis.NodeInitGenerators.webviewNumberInput;
        const result = initGen({
            ...createContext(),
            inputs: ['node_parent_out0', 'None', 'None'],
            outputs: ['node_numinput_out0', 'node_numinput_out1'],
            outputsMeta: [{ connected: true }, { connected: true }],
            node: {
                id: 'node-numinput',
                type: 'web-view-number-input',
                controlValues: { value: 7, title: 'Speed' },
            },
        });
        assert.equal(typeof result?.statement, 'string');
        assert.ok(result.statement.includes('DualInputControl('));
        assert.ok(result.statement.includes('_wv_numinput'));
        assert.ok(
            result.statement.includes('DualInputControl(7, 0, 100)'),
            'Expected constructor with default bounds'
        );
        assert.ok(result.statement.includes('node_numinput_out0 = node_parent_out0'));
    });

    it('number-input init generator clamps the initial value to the configured bounds', () => {
        const initGen = globalThis.NodeInitGenerators.webviewNumberInput;
        const result = initGen({
            ...createContext(),
            inputs: ['None', 'None', 'None'],
            outputs: ['node_numinput_out0', 'node_numinput_out1'],
            outputsMeta: [{ connected: false }, { connected: false }],
            node: {
                id: 'node-numinput',
                type: 'web-view-number-input',
                controlValues: { value: 150 },
            },
        });
        assert.ok(
            result.statement.includes('DualInputControl(100, 0, 100)'),
            'Expected clamped initial value'
        );

        const customBounds = initGen({
            ...createContext(),
            inputs: ['None', 'None', 'None'],
            outputs: ['node_numinput_out0', 'node_numinput_out1'],
            outputsMeta: [{ connected: false }, { connected: false }],
            node: {
                id: 'node-numinput',
                type: 'web-view-number-input',
                controlValues: { value: 7, minValue: 10, maxValue: 5 },
            },
        });
        assert.ok(
            customBounds.statement.includes('DualInputControl(7, 5, 10)'),
            'Expected swapped bounds and clamped value'
        );
    });

    it('number-input loop generator assigns both outputs and includes conditional publish', () => {
        const loopGen = globalThis.NodeCodeGenerators.webviewNumberInput;
        const result = loopGen({
            ...createContext(),
            inputs: ['node_parent_out0', 'None', 'None'],
            outputs: ['node_numinput_out0', 'node_numinput_out1'],
            outputsMeta: [{ connected: true }, { connected: true }],
            node: {
                id: 'node-numinput',
                type: 'web-view-number-input',
                controlValues: { value: 3.0, title: 'Speed' },
            },
        });
        assert.equal(typeof result?.statement, 'string');
        assert.ok(result.statement.includes('.update('), 'Expected update() call');
        assert.ok(
            result.statement.includes('node_numinput_out1'),
            'Expected value output assignment'
        );
        assert.ok(
            result.statement.includes('node_numinput_out0'),
            'Expected element output assignment'
        );
        assert.ok(result.statement.includes('number-input'), 'Expected kind in publish payload');
        assert.ok(result.statement.includes("'min': 0"), 'Expected min in publish payload');
        assert.ok(result.statement.includes("'max': 100"), 'Expected max in publish payload');
        assert.ok(result.statement.includes("'step': 1"), 'Expected step in publish payload');
        assert.ok(result.statement.includes('.update(3,'), 'Expected fallback default expression');
        assert.ok(result.statement.includes('if '), 'Expected conditional publish');
    });

    it('number-input loop generator assigns the changed output without shifting value', () => {
        const loopGen = globalThis.NodeCodeGenerators.webviewNumberInput;
        const result = loopGen({
            ...createContext(),
            inputs: ['node_parent_out0', 'None', 'None'],
            outputs: ['node_numinput_out0', 'node_numinput_out1', 'node_numinput_out2'],
            outputsMeta: [{ connected: true }, { connected: true }, { connected: true }],
            node: {
                id: 'node-numinput',
                type: 'web-view-number-input',
                controlValues: { value: 3.0, title: 'Speed' },
            },
        });
        assert.equal(typeof result?.statement, 'string');
        assert.ok(
            result.statement.includes('node_numinput_out2 = _wv_numinput_ctrl_'),
            'Expected changed output assignment from the runtime flag'
        );
        assert.ok(
            result.statement.includes('.output_changed'),
            'Expected output_changed property access'
        );
        assert.ok(
            result.statement.includes('node_numinput_out1 = '),
            'Expected value output to stay on index 1'
        );
        assert.ok(
            !result.statement.includes('(no connected changed output)'),
            'Did not expect the missing-changed comment when the output is wired'
        );
    });

    it('number-input loop generator reports a missing changed output', () => {
        const loopGen = globalThis.NodeCodeGenerators.webviewNumberInput;
        const result = loopGen({
            ...createContext(),
            inputs: ['node_parent_out0', 'None', 'None'],
            outputs: ['node_numinput_out0', 'node_numinput_out1'],
            node: {
                id: 'node-numinput',
                type: 'web-view-number-input',
                controlValues: { value: 3.0, title: 'Speed' },
            },
        });
        assert.equal(typeof result?.statement, 'string');
        assert.ok(
            result.statement.includes(
                '# webview:web-view-number-input:loop (no connected changed output)'
            )
        );
        assert.ok(!result.statement.includes('.output_changed'));
    });

    it('number-input loop generator uses connected value input when wired', () => {
        const loopGen = globalThis.NodeCodeGenerators.webviewNumberInput;
        const result = loopGen({
            ...createContext(),
            inputs: ['node_parent_out0', 'None', 'node_sensor_out2'],
            inputSources: [{ fromIndex: 0 }, null, { fromIndex: 2 }],
            outputs: ['node_numinput_out0', 'node_numinput_out1'],
            node: {
                id: 'node-numinput',
                type: 'web-view-number-input',
                controlValues: { value: 0, title: '' },
            },
        });
        assert.ok(
            result.statement.includes('node_sensor_out2'),
            'Expected connected value input expression'
        );
    });

    it('number-input renderMarkup produces correct DOM structure', () => {
        const impl =
            globalThis.WebviewGeneratorShared.getNodeKindImplementation?.('web-view-number-input');
        assert.ok(impl, 'Expected number-input implementation');
        assert.equal(typeof impl.renderMarkup, 'function');

        const lines = impl.renderMarkup({
            indent: '',
            childIndent: '  ',
            nodeId: 'node-numinput',
            element: {
                controls: { maxDigits: 8, title: 'Speed', value: 42 },
                binding: {
                    elementId: 'wv_el_numinput_node_numinput_s0',
                    payloadKey: 'wv_bind_numinput_node_numinput_s0',
                },
            },
            escapeHtml: (v) => String(v),
        });
        assert.ok(Array.isArray(lines) && lines.length >= 3, 'Expected markup lines');
        const markup = lines.join('\n');
        assert.ok(markup.includes('wv-input-control'), 'Expected wv-input-control class');
        assert.ok(markup.includes('wv-number-input'), 'Expected wv-number-input class');
        assert.ok(markup.includes('data-wv-input-kind="number"'), 'Expected input kind attribute');
        assert.ok(markup.includes('data-wv-max-digits="8"'), 'Expected maxDigits data attribute');
        assert.ok(markup.includes('data-wv-min="0"'), 'Expected min data attribute');
        assert.ok(markup.includes('data-wv-max="100"'), 'Expected max data attribute');
        assert.ok(markup.includes('data-wv-step="1"'), 'Expected step data attribute');
        assert.ok(markup.includes('wv_bind_numinput_node_numinput_s0'), 'Expected payload key');
        assert.ok(markup.includes('<label'), 'Expected label element');
        assert.ok(markup.includes('type="number"'), 'Expected number input type');
        assert.ok(markup.includes('min="0"'), 'Expected native min attribute');
        assert.ok(markup.includes('max="100"'), 'Expected native max attribute');
        assert.ok(markup.includes('step="1"'), 'Expected native step attribute');
        assert.ok(markup.includes('value="42"'), 'Expected initial value');
    });

    it('number-input renderMarkup clamps the initial value to the bounds', () => {
        const impl =
            globalThis.WebviewGeneratorShared.getNodeKindImplementation?.('web-view-number-input');
        const markup = impl
            .renderMarkup({
                indent: '',
                childIndent: '  ',
                nodeId: 'node-numinput',
                element: {
                    controls: { minValue: 10, maxValue: 20, step: 2, title: '', value: 90 },
                    binding: { elementId: 'wv_el_n1', payloadKey: 'wv_bind_n1' },
                },
                escapeHtml: (v) => String(v),
            })
            .join('\n');
        assert.ok(markup.includes('data-wv-min="10"'), 'Expected configured min');
        assert.ok(markup.includes('data-wv-max="20"'), 'Expected configured max');
        assert.ok(markup.includes('data-wv-step="2"'), 'Expected configured step');
        assert.ok(markup.includes('value="20"'), 'Expected clamped initial value');
    });

    it('number-input renderMarkup escapes title in label', () => {
        const impl =
            globalThis.WebviewGeneratorShared.getNodeKindImplementation?.('web-view-number-input');
        const lines = impl.renderMarkup({
            indent: '',
            childIndent: '  ',
            nodeId: 'n1',
            element: {
                controls: { maxDigits: 6, title: '<script>xss</script>', value: 0 },
                binding: { elementId: 'wv_el_numinput_n1', payloadKey: 'wv_bind_numinput_n1' },
            },
            escapeHtml: (v) =>
                String(v)
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;'),
        });
        const markup = lines.join('\n');
        assert.ok(!markup.includes('<script>'), 'Expected title to be escaped');
        assert.ok(markup.includes('&lt;script&gt;'), 'Expected escaped title');
    });

    it('number-input renderClientUpdateHandler has correct function name', () => {
        const impl =
            globalThis.WebviewGeneratorShared.getNodeKindImplementation?.('web-view-number-input');
        const lines = impl.renderClientUpdateHandler({ nodeKind: 'web-view-number-input' });
        assert.ok(Array.isArray(lines) && lines.length > 0);
        assert.ok(
            lines[0].startsWith('function applyNumberInputUpdate('),
            'Expected function name'
        );
        const code = lines.join('\n');
        assert.ok(code.includes('inputEl.min'), 'Expected inputEl.min update');
        assert.ok(code.includes('inputEl.max'), 'Expected inputEl.max update');
        assert.ok(code.includes('inputEl.step'), 'Expected inputEl.step update');
        assert.ok(code.includes('data-wv-min'), 'Expected container min attribute update');
        assert.ok(code.includes('data-wv-max'), 'Expected container max attribute update');
        assert.ok(code.includes('data-wv-step'), 'Expected container step attribute update');
    });

    it('number-input renderClientHelpers contains initializeNumberInputs function', () => {
        const impl =
            globalThis.WebviewGeneratorShared.getNodeKindImplementation?.('web-view-number-input');
        const lines = impl.renderClientHelpers({ nodeKind: 'web-view-number-input' });
        assert.ok(Array.isArray(lines) && lines.length > 0);
        const code = lines.join('\n');
        assert.ok(code.includes('function initializeNumberInputs()'), 'Expected helper function');
        assert.ok(code.includes('change'), 'Expected change event listener');
        assert.ok(code.includes('postRefreshWithTimeout('), 'Expected refresh POST');
        assert.ok(code.includes('number-input'), 'Expected kind payload');
        assert.ok(code.includes('inputEl.min'), 'Expected min bound read');
        assert.ok(code.includes('inputEl.max'), 'Expected max bound read');
        assert.ok(code.includes('Math.min('), 'Expected upper clamp');
        assert.ok(code.includes('Math.max('), 'Expected lower clamp');
        assert.ok(code.includes('inputEl.value = clampedValue'), 'Expected clamped write-back');
        assert.ok(code.includes('value: val'), 'Expected clamped payload');
    });

    it('number-input renderClientInitHooks returns single call to initializeNumberInputs', () => {
        const impl =
            globalThis.WebviewGeneratorShared.getNodeKindImplementation?.('web-view-number-input');
        const lines = impl.renderClientInitHooks({ nodeKind: 'web-view-number-input' });
        assert.ok(Array.isArray(lines) && lines.length === 1);
        assert.equal(lines[0], 'initializeNumberInputs();');
    });

    // === string-input ===
    it('registers string-input generators with correct types', () => {
        assert.equal(typeof globalThis.NodeInitGenerators.webviewStringInput, 'function');
        assert.equal(typeof globalThis.NodeCodeGenerators.webviewStringInput, 'function');
        assert.equal(typeof globalThis.NodeHelperGenerators.webviewStringInput, 'function');
    });

    it('string-input node definition has required webview fields', () => {
        const definitions = JSON.parse(readFileSync(webviewDefinitionsPath, 'utf8'));
        const strInputDef = definitions?.nodeTypes?.['web-view-string-input'];
        assert.ok(strInputDef, 'Expected web-view-string-input node definition');
        assert.equal(strInputDef.executionPhase, 'both');
        assert.equal(strInputDef.initFunction, 'init_webview');
        assert.equal(strInputDef.inputs[2].id, 'value');
        assert.equal(strInputDef.inputs[2].allowedTypes[0], 'string');
        assert.equal(strInputDef.outputs[1].outputType, 'string');
        assert.equal(strInputDef.outputs[2].id, 'changed');
        assert.equal(strInputDef.outputs[2].outputType, 'bool');
    });

    it('string-input init generator emits DualInputControl instantiation with string default', () => {
        const initGen = globalThis.NodeInitGenerators.webviewStringInput;
        const result = initGen({
            ...createContext(),
            inputs: ['node_parent_out0', 'None', 'None'],
            outputs: ['node_strinput_out0', 'node_strinput_out1'],
            outputsMeta: [{ connected: true }, { connected: true }],
            node: {
                id: 'node-strinput',
                type: 'web-view-string-input',
                controlValues: { value: 'hello', title: 'Label' },
            },
        });
        assert.equal(typeof result?.statement, 'string');
        assert.ok(result.statement.includes('DualInputControl('));
        assert.ok(result.statement.includes('_wv_strinput'));
        assert.ok(result.statement.includes('"hello"'));
        assert.ok(result.statement.includes('node_strinput_out0 = node_parent_out0'));
    });

    it('string-input loop generator assigns both outputs and includes conditional publish', () => {
        const loopGen = globalThis.NodeCodeGenerators.webviewStringInput;
        const result = loopGen({
            ...createContext(),
            inputs: ['node_parent_out0', 'None', 'None'],
            outputs: ['node_strinput_out0', 'node_strinput_out1'],
            outputsMeta: [{ connected: true }, { connected: true }],
            node: {
                id: 'node-strinput',
                type: 'web-view-string-input',
                controlValues: { value: 'abc', title: 'Label' },
            },
        });
        assert.equal(typeof result?.statement, 'string');
        assert.ok(result.statement.includes('.update('), 'Expected update() call');
        assert.ok(result.statement.includes('node_strinput_out1'), 'Expected value output');
        assert.ok(result.statement.includes('node_strinput_out0'), 'Expected element output');
        assert.ok(result.statement.includes('string-input'), 'Expected kind in publish payload');
        assert.ok(result.statement.includes('if '), 'Expected conditional publish');
    });

    it('string-input loop generator assigns the changed output without shifting value', () => {
        const loopGen = globalThis.NodeCodeGenerators.webviewStringInput;
        const result = loopGen({
            ...createContext(),
            inputs: ['node_parent_out0', 'None', 'None'],
            outputs: ['node_strinput_out0', 'node_strinput_out1', 'node_strinput_out2'],
            outputsMeta: [{ connected: true }, { connected: true }, { connected: true }],
            node: {
                id: 'node-strinput',
                type: 'web-view-string-input',
                controlValues: { value: 'abc', title: 'Label' },
            },
        });
        assert.equal(typeof result?.statement, 'string');
        assert.ok(
            result.statement.includes('node_strinput_out2 = _wv_strinput_ctrl_'),
            'Expected changed output assignment from the runtime flag'
        );
        assert.ok(result.statement.includes('.output_changed'));
        assert.ok(result.statement.includes('node_strinput_out1 = '));
        assert.ok(!result.statement.includes('(no connected changed output)'));
    });

    it('string-input loop generator reports a missing changed output', () => {
        const loopGen = globalThis.NodeCodeGenerators.webviewStringInput;
        const result = loopGen({
            ...createContext(),
            inputs: ['node_parent_out0', 'None', 'None'],
            outputs: ['node_strinput_out0', 'node_strinput_out1'],
            node: {
                id: 'node-strinput',
                type: 'web-view-string-input',
                controlValues: { value: 'abc', title: 'Label' },
            },
        });
        assert.equal(typeof result?.statement, 'string');
        assert.ok(
            result.statement.includes(
                '# webview:web-view-string-input:loop (no connected changed output)'
            )
        );
        assert.ok(!result.statement.includes('.output_changed'));
    });

    it('string-input renderMarkup produces correct DOM structure', () => {
        const impl =
            globalThis.WebviewGeneratorShared.getNodeKindImplementation?.('web-view-string-input');
        assert.ok(impl, 'Expected string-input implementation');
        assert.equal(typeof impl.renderMarkup, 'function');

        const lines = impl.renderMarkup({
            indent: '',
            childIndent: '  ',
            nodeId: 'node-strinput',
            element: {
                controls: { maxLength: 24, title: 'Name', value: 'abc' },
                binding: {
                    elementId: 'wv_el_strinput_node_strinput_s0',
                    payloadKey: 'wv_bind_strinput_node_strinput_s0',
                },
            },
            escapeHtml: (v) => String(v),
        });
        assert.ok(Array.isArray(lines) && lines.length >= 3, 'Expected markup lines');
        const markup = lines.join('\n');
        assert.ok(markup.includes('wv-input-control'), 'Expected wv-input-control class');
        assert.ok(markup.includes('wv-string-input'), 'Expected wv-string-input class');
        assert.ok(markup.includes('data-wv-input-kind="string"'), 'Expected input kind attribute');
        assert.ok(markup.includes('data-wv-max-length="24"'), 'Expected maxLength data attribute');
        assert.ok(markup.includes('wv_bind_strinput_node_strinput_s0'), 'Expected payload key');
        assert.ok(markup.includes('<label'), 'Expected label element');
        assert.ok(markup.includes('type="text"'), 'Expected text input type');
        assert.ok(markup.includes('value="abc"'), 'Expected initial value');
    });

    it('string-input renderMarkup escapes title in label', () => {
        const impl =
            globalThis.WebviewGeneratorShared.getNodeKindImplementation?.('web-view-string-input');
        const lines = impl.renderMarkup({
            indent: '',
            childIndent: '  ',
            nodeId: 'n1',
            element: {
                controls: { maxLength: 20, title: '<b>x</b>', value: '' },
                binding: { elementId: 'wv_el_strinput_n1', payloadKey: 'wv_bind_strinput_n1' },
            },
            escapeHtml: (v) =>
                String(v)
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;'),
        });
        const markup = lines.join('\n');
        assert.ok(!markup.includes('<b>'), 'Expected title to be escaped');
        assert.ok(markup.includes('&lt;b&gt;'), 'Expected escaped title');
    });

    it('string-input renderClientUpdateHandler has correct function name', () => {
        const impl =
            globalThis.WebviewGeneratorShared.getNodeKindImplementation?.('web-view-string-input');
        const lines = impl.renderClientUpdateHandler({ nodeKind: 'web-view-string-input' });
        assert.ok(Array.isArray(lines) && lines.length > 0);
        assert.ok(
            lines[0].startsWith('function applyStringInputUpdate('),
            'Expected function name'
        );
    });

    it('string-input renderClientHelpers submits a string value without Number coercion', () => {
        const impl =
            globalThis.WebviewGeneratorShared.getNodeKindImplementation?.('web-view-string-input');
        const lines = impl.renderClientHelpers({ nodeKind: 'web-view-string-input' });
        assert.ok(Array.isArray(lines) && lines.length > 0);
        const code = lines.join('\n');
        assert.ok(code.includes('function initializeStringInputs()'), 'Expected helper function');
        assert.ok(code.includes('String(inputEl.value)'), 'Expected string coercion');
        assert.ok(!code.includes('Number(inputEl.value)'), 'Expected no Number coercion');
        assert.ok(code.includes('string-input'), 'Expected kind payload');
    });

    it('string-input renderClientInitHooks returns single call to initializeStringInputs', () => {
        const impl =
            globalThis.WebviewGeneratorShared.getNodeKindImplementation?.('web-view-string-input');
        const lines = impl.renderClientInitHooks({ nodeKind: 'web-view-string-input' });
        assert.ok(Array.isArray(lines) && lines.length === 1);
        assert.equal(lines[0], 'initializeStringInputs();');
    });

    // === slider ===
    it('registers slider generators with correct types', () => {
        assert.equal(typeof globalThis.NodeInitGenerators.webviewSlider, 'function');
        assert.equal(typeof globalThis.NodeCodeGenerators.webviewSlider, 'function');
        assert.equal(typeof globalThis.NodeHelperGenerators.webviewSlider, 'function');
    });

    it('slider node definition has required webview fields', () => {
        const definitions = JSON.parse(readFileSync(webviewDefinitionsPath, 'utf8'));
        const sliderDef = definitions?.nodeTypes?.['web-view-slider'];
        assert.ok(sliderDef, 'Expected web-view-slider node definition');
        assert.equal(sliderDef.executionPhase, 'both');
        assert.equal(sliderDef.initFunction, 'init_webview');
        assert.equal(sliderDef.inputs[2].id, 'value');
        assert.equal(sliderDef.outputs[1].outputType, 'float');
        assert.equal(sliderDef.outputs[2].id, 'changed');
        assert.equal(sliderDef.outputs[2].outputType, 'bool');
        const controlIds = sliderDef.controls.map((c) => c.id);
        assert.ok(controlIds.includes('minValue'));
        assert.ok(controlIds.includes('maxValue'));
        assert.ok(controlIds.includes('step'));
    });

    it('slider init generator emits DualInputControl with clamped default', () => {
        const initGen = globalThis.NodeInitGenerators.webviewSlider;
        const result = initGen({
            ...createContext(),
            inputs: ['node_parent_out0', 'None', 'None'],
            outputs: ['node_slider_out0', 'node_slider_out1'],
            outputsMeta: [{ connected: true }, { connected: true }],
            node: {
                id: 'node-slider',
                type: 'web-view-slider',
                controlValues: { value: 250, minValue: 0, maxValue: 100, step: 1, title: 'Speed' },
            },
        });
        assert.equal(typeof result?.statement, 'string');
        assert.ok(result.statement.includes('DualInputControl('));
        assert.ok(result.statement.includes('_wv_slider'));
        assert.ok(result.statement.includes('100'), 'Expected default clamped to maxValue');
        assert.ok(result.statement.includes('node_slider_out0 = node_parent_out0'));
    });

    it('slider loop generator clamps backend value and publishes min/max/step', () => {
        const loopGen = globalThis.NodeCodeGenerators.webviewSlider;
        const result = loopGen({
            ...createContext(),
            inputs: ['node_parent_out0', 'None', 'node_sensor_out2'],
            inputSources: [{ fromIndex: 0 }, null, { fromIndex: 2 }],
            outputs: ['node_slider_out0', 'node_slider_out1'],
            node: {
                id: 'node-slider',
                type: 'web-view-slider',
                controlValues: { value: 0, minValue: 0, maxValue: 100, step: 1, title: '' },
            },
        });
        assert.equal(typeof result?.statement, 'string');
        assert.ok(result.statement.includes('.update('), 'Expected update() call');
        assert.ok(result.statement.includes('min(100'), 'Expected max clamp');
        assert.ok(result.statement.includes('max(0'), 'Expected min clamp');
        assert.ok(result.statement.includes('node_sensor_out2'), 'Expected wired value expression');
        assert.ok(result.statement.includes("'min': 0"), 'Expected min in publish payload');
        assert.ok(result.statement.includes("'max': 100"), 'Expected max in publish payload');
        assert.ok(result.statement.includes("'step': 1"), 'Expected step in publish payload');
        assert.ok(result.statement.includes('if '), 'Expected conditional publish');
    });

    it('slider loop generator assigns the changed output without shifting value', () => {
        const loopGen = globalThis.NodeCodeGenerators.webviewSlider;
        const result = loopGen({
            ...createContext(),
            inputs: ['node_parent_out0', 'None', 'None'],
            outputs: ['node_slider_out0', 'node_slider_out1', 'node_slider_out2'],
            outputsMeta: [{ connected: true }, { connected: true }, { connected: true }],
            node: {
                id: 'node-slider',
                type: 'web-view-slider',
                controlValues: { value: 0, minValue: 0, maxValue: 100, step: 1, title: '' },
            },
        });
        assert.equal(typeof result?.statement, 'string');
        assert.ok(
            result.statement.includes('node_slider_out2 = _wv_slider_ctrl_'),
            'Expected changed output assignment from the runtime flag'
        );
        assert.ok(result.statement.includes('.output_changed'));
        assert.ok(result.statement.includes('node_slider_out1 = '));
        assert.ok(!result.statement.includes('(no connected changed output)'));
    });

    it('slider loop generator reports a missing changed output', () => {
        const loopGen = globalThis.NodeCodeGenerators.webviewSlider;
        const result = loopGen({
            ...createContext(),
            inputs: ['node_parent_out0', 'None', 'None'],
            outputs: ['node_slider_out0', 'node_slider_out1'],
            node: {
                id: 'node-slider',
                type: 'web-view-slider',
                controlValues: { value: 0, minValue: 0, maxValue: 100, step: 1, title: '' },
            },
        });
        assert.equal(typeof result?.statement, 'string');
        assert.ok(
            result.statement.includes(
                '# webview:web-view-slider:loop (no connected changed output)'
            )
        );
        assert.ok(!result.statement.includes('.output_changed'));
    });

    it('slider renderMarkup produces correct DOM structure', () => {
        const impl =
            globalThis.WebviewGeneratorShared.getNodeKindImplementation?.('web-view-slider');
        assert.ok(impl, 'Expected slider implementation');
        assert.equal(typeof impl.renderMarkup, 'function');

        const lines = impl.renderMarkup({
            indent: '',
            childIndent: '  ',
            nodeId: 'node-slider',
            element: {
                controls: { minValue: 0, maxValue: 100, step: 5, title: 'Speed', value: 42 },
                binding: {
                    elementId: 'wv_el_slider_node_slider_s0',
                    payloadKey: 'wv_bind_slider_node_slider_s0',
                },
            },
            escapeHtml: (v) => String(v),
        });
        assert.ok(Array.isArray(lines) && lines.length >= 5, 'Expected markup lines');
        const markup = lines.join('\n');
        assert.ok(markup.includes('wv-slider'), 'Expected wv-slider class');
        assert.ok(markup.includes('data-wv-input-kind="slider"'), 'Expected input kind attribute');
        assert.ok(markup.includes('data-wv-min="0"'), 'Expected min data attribute');
        assert.ok(markup.includes('data-wv-max="100"'), 'Expected max data attribute');
        assert.ok(markup.includes('data-wv-step="5"'), 'Expected step data attribute');
        assert.ok(markup.includes('type="range"'), 'Expected range input type');
        assert.ok(markup.includes('value="42"'), 'Expected initial value');
        assert.ok(markup.includes('wv_bind_slider_node_slider_s0'), 'Expected payload key');
        assert.ok(markup.includes('class="wv-slider-value"'), 'Expected value display element');
        assert.ok(markup.includes('>42</span>'), 'Expected initial value text in display');
    });

    it('slider renderMarkup escapes title in label', () => {
        const impl =
            globalThis.WebviewGeneratorShared.getNodeKindImplementation?.('web-view-slider');
        const lines = impl.renderMarkup({
            indent: '',
            childIndent: '  ',
            nodeId: 'n1',
            element: {
                controls: { minValue: 0, maxValue: 100, step: 1, title: '<i>x</i>', value: 0 },
                binding: { elementId: 'wv_el_slider_n1', payloadKey: 'wv_bind_slider_n1' },
            },
            escapeHtml: (v) =>
                String(v)
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;'),
        });
        const markup = lines.join('\n');
        assert.ok(!markup.includes('<i>'), 'Expected title to be escaped');
        assert.ok(markup.includes('&lt;i&gt;'), 'Expected escaped title');
    });

    it('slider renderClientUpdateHandler has correct function name', () => {
        const impl =
            globalThis.WebviewGeneratorShared.getNodeKindImplementation?.('web-view-slider');
        const lines = impl.renderClientUpdateHandler({ nodeKind: 'web-view-slider' });
        assert.ok(Array.isArray(lines) && lines.length > 0);
        assert.ok(lines[0].startsWith('function applySliderUpdate('), 'Expected function name');
    });

    it('slider renderClientUpdateHandler updates the value display', () => {
        const impl =
            globalThis.WebviewGeneratorShared.getNodeKindImplementation?.('web-view-slider');
        const lines = impl.renderClientUpdateHandler({ nodeKind: 'web-view-slider' });
        const code = lines.join('\n');
        assert.ok(code.includes('span.wv-slider-value'), 'Expected value display query');
        assert.ok(code.includes('valueEl.textContent = newValue'), 'Expected value display update');
    });

    it('slider renderClientHelpers contains debounce logic', () => {
        const impl =
            globalThis.WebviewGeneratorShared.getNodeKindImplementation?.('web-view-slider');
        const lines = impl.renderClientHelpers({ nodeKind: 'web-view-slider' });
        assert.ok(Array.isArray(lines) && lines.length > 0);
        const code = lines.join('\n');
        assert.ok(code.includes('function initializeSliders()'), 'Expected helper function');
        assert.ok(code.includes('setTimeout'), 'Expected debounce timer');
        assert.ok(code.includes('data-wv-slider-debounce-id'), 'Expected debounce id attribute');
        assert.ok(code.includes('input'), 'Expected input event');
        assert.ok(code.includes('slider'), 'Expected kind payload');
        assert.ok(code.includes('span.wv-slider-value'), 'Expected value display update in helper');
        assert.ok(code.includes('valueEl.textContent = inputEl.value'), 'Expected live value sync');
    });

    it('slider renderClientInitHooks returns single call to initializeSliders', () => {
        const impl =
            globalThis.WebviewGeneratorShared.getNodeKindImplementation?.('web-view-slider');
        const lines = impl.renderClientInitHooks({ nodeKind: 'web-view-slider' });
        assert.ok(Array.isArray(lines) && lines.length === 1);
        assert.equal(lines[0], 'initializeSliders();');
    });

    it('slider normalizeControls clamps inverted bounds without crashing', () => {
        const impl =
            globalThis.WebviewGeneratorShared.getNodeKindImplementation?.('web-view-slider');
        const controls = impl.normalizeControls({ minValue: 100, maxValue: 0, step: 0, value: 50 });
        assert.ok(controls.maxValue >= controls.minValue, 'Expected non-inverted bounds');
        assert.ok(controls.step >= 0.001, 'Expected step clamped to minimum');
    });

    // === checkbox ===
    it('registers checkbox generators with correct types', () => {
        assert.equal(typeof globalThis.NodeInitGenerators.webviewCheckbox, 'function');
        assert.equal(typeof globalThis.NodeCodeGenerators.webviewCheckbox, 'function');
        assert.equal(typeof globalThis.NodeHelperGenerators.webviewCheckbox, 'function');
    });

    it('checkbox node definition has required webview fields', () => {
        const definitions = JSON.parse(readFileSync(webviewDefinitionsPath, 'utf8'));
        const checkboxDef = definitions?.nodeTypes?.['web-view-checkbox'];
        assert.ok(checkboxDef, 'Expected web-view-checkbox node definition');
        assert.equal(checkboxDef.executionPhase, 'both');
        assert.equal(checkboxDef.initFunction, 'init_webview');
        assert.equal(checkboxDef.inputs[2].id, 'value');
        assert.equal(checkboxDef.inputs[2].allowedTypes[0], 'bool');
        assert.equal(checkboxDef.outputs[1].outputType, 'bool');
        assert.equal(checkboxDef.outputs[2].id, 'changed');
        assert.equal(checkboxDef.outputs[2].outputType, 'bool');
    });

    it('checkbox init generator emits DualInputControl with boolean default', () => {
        const initGen = globalThis.NodeInitGenerators.webviewCheckbox;
        const result = initGen({
            ...createContext(),
            inputs: ['node_parent_out0', 'None', 'None'],
            outputs: ['node_checkbox_out0', 'node_checkbox_out1'],
            outputsMeta: [{ connected: true }, { connected: true }],
            node: {
                id: 'node-checkbox',
                type: 'web-view-checkbox',
                controlValues: { value: true, title: 'Enabled' },
            },
        });
        assert.equal(typeof result?.statement, 'string');
        assert.ok(result.statement.includes('DualInputControl('));
        assert.ok(result.statement.includes('_wv_checkbox'));
        assert.ok(result.statement.includes('True'));
        assert.ok(result.statement.includes('node_checkbox_out0 = node_parent_out0'));
    });

    it('checkbox loop generator assigns both outputs and publishes checkbox kind', () => {
        const loopGen = globalThis.NodeCodeGenerators.webviewCheckbox;
        const result = loopGen({
            ...createContext(),
            inputs: ['node_parent_out0', 'None', 'None'],
            outputs: ['node_checkbox_out0', 'node_checkbox_out1'],
            outputsMeta: [{ connected: true }, { connected: true }],
            node: {
                id: 'node-checkbox',
                type: 'web-view-checkbox',
                controlValues: { value: false, title: 'Enabled' },
            },
        });
        assert.equal(typeof result?.statement, 'string');
        assert.ok(result.statement.includes('.update('), 'Expected update() call');
        assert.ok(result.statement.includes('node_checkbox_out1'), 'Expected value output');
        assert.ok(result.statement.includes('node_checkbox_out0'), 'Expected element output');
        assert.ok(result.statement.includes('checkbox'), 'Expected kind in publish payload');
        assert.ok(result.statement.includes('if '), 'Expected conditional publish');
    });

    it('checkbox loop generator assigns the changed output without shifting value', () => {
        const loopGen = globalThis.NodeCodeGenerators.webviewCheckbox;
        const result = loopGen({
            ...createContext(),
            inputs: ['node_parent_out0', 'None', 'None'],
            outputs: ['node_checkbox_out0', 'node_checkbox_out1', 'node_checkbox_out2'],
            outputsMeta: [{ connected: true }, { connected: true }, { connected: true }],
            node: {
                id: 'node-checkbox',
                type: 'web-view-checkbox',
                controlValues: { value: false, title: 'Enabled' },
            },
        });
        assert.equal(typeof result?.statement, 'string');
        assert.ok(
            result.statement.includes('node_checkbox_out2 = _wv_checkbox_ctrl_'),
            'Expected changed output assignment from the runtime flag'
        );
        assert.ok(result.statement.includes('.output_changed'));
        assert.ok(result.statement.includes('node_checkbox_out1 = '));
        assert.ok(!result.statement.includes('(no connected changed output)'));
    });

    it('checkbox loop generator reports a missing changed output', () => {
        const loopGen = globalThis.NodeCodeGenerators.webviewCheckbox;
        const result = loopGen({
            ...createContext(),
            inputs: ['node_parent_out0', 'None', 'None'],
            outputs: ['node_checkbox_out0', 'node_checkbox_out1'],
            node: {
                id: 'node-checkbox',
                type: 'web-view-checkbox',
                controlValues: { value: false, title: 'Enabled' },
            },
        });
        assert.equal(typeof result?.statement, 'string');
        assert.ok(
            result.statement.includes(
                '# webview:web-view-checkbox:loop (no connected changed output)'
            )
        );
        assert.ok(!result.statement.includes('.output_changed'));
    });

    it('checkbox renderMarkup emits checked attribute for true state', () => {
        const impl =
            globalThis.WebviewGeneratorShared.getNodeKindImplementation?.('web-view-checkbox');
        assert.ok(impl, 'Expected checkbox implementation');
        const lines = impl.renderMarkup({
            indent: '',
            childIndent: '  ',
            nodeId: 'node-checkbox',
            element: {
                controls: { title: 'Enabled', value: true },
                binding: {
                    elementId: 'wv_el_checkbox_node_checkbox_s0',
                    payloadKey: 'wv_bind_checkbox_node_checkbox_s0',
                },
            },
            escapeHtml: (v) => String(v),
        });
        const markup = lines.join('\n');
        assert.ok(markup.includes('wv-checkbox'), 'Expected wv-checkbox class');
        assert.ok(markup.includes('type="checkbox"'), 'Expected checkbox input type');
        assert.ok(markup.includes(' checked'), 'Expected checked attribute');
        assert.ok(markup.includes('wv_bind_checkbox_node_checkbox_s0'), 'Expected payload key');
    });

    it('checkbox renderMarkup omits checked attribute for false state', () => {
        const impl =
            globalThis.WebviewGeneratorShared.getNodeKindImplementation?.('web-view-checkbox');
        const lines = impl.renderMarkup({
            indent: '',
            childIndent: '  ',
            nodeId: 'node-checkbox',
            element: {
                controls: { title: 'Enabled', value: false },
                binding: {
                    elementId: 'wv_el_checkbox_node_checkbox_s0',
                    payloadKey: 'wv_bind_checkbox_node_checkbox_s0',
                },
            },
            escapeHtml: (v) => String(v),
        });
        const markup = lines.join('\n');
        assert.ok(!markup.includes(' checked'), 'Expected no checked attribute');
    });

    it('checkbox renderClientUpdateHandler sets checked property', () => {
        const impl =
            globalThis.WebviewGeneratorShared.getNodeKindImplementation?.('web-view-checkbox');
        const lines = impl.renderClientUpdateHandler({ nodeKind: 'web-view-checkbox' });
        assert.ok(Array.isArray(lines) && lines.length > 0);
        const code = lines.join('\n');
        assert.ok(lines[0].startsWith('function applyCheckboxUpdate('), 'Expected function name');
        assert.ok(code.includes('inputEl.checked = Boolean(entry.value)'), 'Expected checked set');
    });

    it('checkbox renderClientHelpers submits native boolean payload', () => {
        const impl =
            globalThis.WebviewGeneratorShared.getNodeKindImplementation?.('web-view-checkbox');
        const lines = impl.renderClientHelpers({ nodeKind: 'web-view-checkbox' });
        assert.ok(Array.isArray(lines) && lines.length > 0);
        const code = lines.join('\n');
        assert.ok(code.includes('function initializeCheckboxes()'), 'Expected helper function');
        assert.ok(code.includes('value: inputEl.checked'), 'Expected native boolean payload');
        assert.ok(code.includes('checkbox'), 'Expected kind payload');
    });

    it('checkbox renderClientInitHooks returns single call to initializeCheckboxes', () => {
        const impl =
            globalThis.WebviewGeneratorShared.getNodeKindImplementation?.('web-view-checkbox');
        const lines = impl.renderClientInitHooks({ nodeKind: 'web-view-checkbox' });
        assert.ok(Array.isArray(lines) && lines.length === 1);
        assert.equal(lines[0], 'initializeCheckboxes();');
    });

    // === select ===
    it('registers select generators with correct types', () => {
        assert.equal(typeof globalThis.NodeInitGenerators.webviewSelect, 'function');
        assert.equal(typeof globalThis.NodeCodeGenerators.webviewSelect, 'function');
        assert.equal(typeof globalThis.NodeHelperGenerators.webviewSelect, 'function');
    });

    it('select node definition has required webview fields', () => {
        const definitions = JSON.parse(readFileSync(webviewDefinitionsPath, 'utf8'));
        const selectDef = definitions?.nodeTypes?.['web-view-select'];
        assert.ok(selectDef, 'Expected web-view-select node definition');
        assert.equal(selectDef.executionPhase, 'both');
        assert.equal(selectDef.initFunction, 'init_webview');
        assert.ok(Array.isArray(selectDef.inputs) && selectDef.inputs.length === 19);
        assert.ok(Array.isArray(selectDef.outputs) && selectDef.outputs.length === 4);
        assert.equal(selectDef.outputs[1].outputType, 'any');
        assert.equal(selectDef.outputs[2].outputType, 'string');
        assert.equal(selectDef.outputs[3].id, 'changed');
        assert.equal(selectDef.outputs[3].outputType, 'bool');
        const optionCount = selectDef.controls.find((c) => c.id === 'optionCount');
        assert.ok(optionCount && optionCount.affectsInputs === true);
    });

    it('select init generator emits SelectControl with option lists', () => {
        const initGen = globalThis.NodeInitGenerators.webviewSelect;
        const result = initGen({
            ...createContext(),
            inputs: ['node_parent_out0', 'None', 'None'],
            outputs: ['node_select_out0', 'node_select_out1', 'node_select_out2'],
            outputsMeta: [{ connected: true }, { connected: true }, { connected: true }],
            node: {
                id: 'node-select',
                type: 'web-view-select',
                controlValues: {
                    optionCount: 3,
                    defaultIndex: 1,
                    label_1: 'A',
                    value_1: 'a',
                    label_2: 'B',
                    value_2: 'b',
                    label_3: 'C',
                    value_3: 'c',
                },
            },
        });
        assert.equal(typeof result?.statement, 'string');
        assert.ok(result.statement.includes('SelectControl('));
        assert.ok(result.statement.includes('_wv_select'));
        assert.ok(result.statement.includes('["a", "b", "c"]'));
        assert.ok(result.statement.includes('["A", "B", "C"]'));
        assert.ok(result.statement.includes(', 1)'));
    });

    it('select init generator resolves option values from inputDefaults via cloneNodeForGenerator', () => {
        const initGen = globalThis.NodeInitGenerators.webviewSelect;
        const node = cloneNodeForGenerator({
            id: 'node-select',
            type: 'web-view-select',
            controlValues: { optionCount: 2, defaultIndex: 0 },
            inputDefaults: {
                label_1: 'On',
                value_1: '1',
                label_2: 'Off',
                value_2: '2',
            },
        });

        const result = initGen({
            ...createContext(),
            inputs: ['node_parent_out0', 'None', 'None'],
            outputs: ['node_select_out0', 'node_select_out1', 'node_select_out2'],
            outputsMeta: [{ connected: true }, { connected: true }, { connected: true }],
            node,
        });

        assert.equal(typeof result?.statement, 'string');
        assert.ok(result.statement.includes('SelectControl('));
        assert.ok(
            result.statement.includes('["1", "2"]'),
            'Expected option values resolved from inputDefaults'
        );
        assert.ok(
            result.statement.includes('["On", "Off"]'),
            'Expected option labels resolved from inputDefaults'
        );
        assert.ok(result.statement.includes(', 0)'), 'Expected default index');
    });

    it('throws when a collection contains multiple web-root nodes', async () => {
        const consumer = globalThis.NodeHelperHandoffConsumers['web-runtime'];
        assert.equal(typeof consumer, 'function');

        await assert.rejects(
            consumer({
                group: {
                    mergedData: {
                        'webNode:node-root-1': {
                            id: 'node-root-1',
                            kind: 'web-root',
                            controls: { title: 'Root A' },
                        },
                        'webNode:node-root-2': {
                            id: 'node-root-2',
                            kind: 'web-root',
                            controls: { title: 'Root B' },
                        },
                    },
                    webserverSpecPatch: {},
                },
                collection: {
                    id: 'collection-multi-root',
                    title: 'Multi Root Collection',
                    webAssetGenerationMode: 'plain',
                },
            }),
            /Multiple web-root nodes detected/
        );
    });

    it('generated client script sends initialSync on the first poll only', async () => {
        const consumer = globalThis.NodeHelperHandoffConsumers['web-runtime'];
        assert.equal(typeof consumer, 'function');

        const result = await consumer({
            group: {
                mergedData: {
                    'webNode:node-root': {
                        id: 'node-root',
                        kind: 'web-root',
                        controls: { title: 'Sync Test' },
                    },
                },
                webserverSpecPatch: {},
            },
            collection: {
                id: 'collection-initial-sync',
                title: 'Initial Sync Collection',
                webAssetGenerationMode: 'plain',
            },
        });

        const artifacts = Array.isArray(result?.artifacts) ? result.artifacts : [];
        const clientArtifact = artifacts.find(
            (artifact) =>
                artifact.targetPath ===
                'collection/webview/collection-initial-sync/webview_client.js'
        );
        assert.ok(clientArtifact, 'Expected generated client script artifact');
        const clientSource = String(clientArtifact.content || '');

        assert.ok(clientSource.includes('let hasRequestedInitialSync = false;'));
        assert.ok(clientSource.includes('requestPayload.initialSync = true;'));
        assert.ok(clientSource.includes('hasRequestedInitialSync = true;'));
    });

    it('select loop generator assigns value and label outputs and publishes', () => {
        const loopGen = globalThis.NodeCodeGenerators.webviewSelect;
        const result = loopGen({
            ...createContext(),
            inputs: ['node_parent_out0', 'None', 'None'],
            outputs: ['node_select_out0', 'node_select_out1', 'node_select_out2'],
            node: {
                id: 'node-select',
                type: 'web-view-select',
                controlValues: {
                    optionCount: 2,
                    defaultIndex: 0,
                    label_1: 'On',
                    value_1: 1,
                    label_2: 'Off',
                    value_2: 0,
                },
            },
        });
        assert.equal(typeof result?.statement, 'string');
        assert.ok(result.statement.includes('.update('), 'Expected update() call');
        assert.ok(result.statement.includes('node_select_out1'), 'Expected value output');
        assert.ok(result.statement.includes('node_select_out2'), 'Expected label output');
        assert.ok(result.statement.includes('_option_values'), 'Expected option update');
        assert.ok(result.statement.includes("'kind': 'select'"), 'Expected select kind');
        assert.ok(result.statement.includes('selectedIndex'), 'Expected selectedIndex');
        assert.ok(result.statement.includes('if '), 'Expected conditional publish');
    });

    it('input-control loop generators pass sync epoch to update()', () => {
        const cases = [
            {
                gen: globalThis.NodeCodeGenerators.webviewNumberInput,
                outputs: ['node_out0', 'node_out1'],
                controlValues: { value: 3.0, title: 'Speed' },
            },
            {
                gen: globalThis.NodeCodeGenerators.webviewStringInput,
                outputs: ['node_out0', 'node_out1'],
                controlValues: { value: 'hello', title: 'Label' },
            },
            {
                gen: globalThis.NodeCodeGenerators.webviewSlider,
                outputs: ['node_out0', 'node_out1'],
                controlValues: { value: 0, min: 0, max: 100, step: 1 },
            },
            {
                gen: globalThis.NodeCodeGenerators.webviewCheckbox,
                outputs: ['node_out0', 'node_out1'],
                controlValues: { value: false },
            },
            {
                gen: globalThis.NodeCodeGenerators.webviewSelect,
                outputs: ['node_out0', 'node_out1', 'node_out2'],
                controlValues: {
                    optionCount: 2,
                    defaultIndex: 0,
                    label_1: 'On',
                    value_1: 1,
                    label_2: 'Off',
                    value_2: 0,
                },
            },
        ];

        for (const entry of cases) {
            assert.equal(typeof entry.gen, 'function');
            const result = entry.gen({
                ...createContext(),
                inputs: ['node_parent_out0', 'None', 'None'],
                outputs: entry.outputs,
                node: {
                    id: 'node-input',
                    type: 'web-view-input',
                    controlValues: entry.controlValues,
                },
            });
            assert.equal(typeof result?.statement, 'string');
            assert.ok(
                result.statement.includes(
                    'sync_epoch=web_interface_module.WEB_INTERFACE.get_webview_sync_epoch()'
                ),
                'Expected sync_epoch argument in generated loop code'
            );
        }
    });

    it('select loop generator assigns the changed output without shifting value or label', () => {
        const loopGen = globalThis.NodeCodeGenerators.webviewSelect;
        const result = loopGen({
            ...createContext(),
            inputs: ['node_parent_out0', 'None', 'None'],
            outputs: [
                'node_select_out0',
                'node_select_out1',
                'node_select_out2',
                'node_select_out3',
            ],
            node: {
                id: 'node-select',
                type: 'web-view-select',
                controlValues: {
                    optionCount: 2,
                    defaultIndex: 0,
                    label_1: 'On',
                    value_1: 1,
                    label_2: 'Off',
                    value_2: 0,
                },
            },
        });
        assert.equal(typeof result?.statement, 'string');
        assert.ok(
            result.statement.includes('node_select_out3 = _wv_select_ctrl_'),
            'Expected changed output assignment from the runtime flag'
        );
        assert.ok(result.statement.includes('.output_changed'));
        assert.ok(result.statement.includes('node_select_out1 = '));
        assert.ok(result.statement.includes('node_select_out2 = '));
        assert.ok(!result.statement.includes('(no connected changed output)'));
    });

    it('select loop generator reports a missing changed output', () => {
        const loopGen = globalThis.NodeCodeGenerators.webviewSelect;
        const result = loopGen({
            ...createContext(),
            inputs: ['node_parent_out0', 'None', 'None'],
            outputs: ['node_select_out0', 'node_select_out1', 'node_select_out2'],
            node: {
                id: 'node-select',
                type: 'web-view-select',
                controlValues: {
                    optionCount: 2,
                    defaultIndex: 0,
                    label_1: 'On',
                    value_1: 1,
                    label_2: 'Off',
                    value_2: 0,
                },
            },
        });
        assert.equal(typeof result?.statement, 'string');
        assert.ok(
            result.statement.includes(
                '# webview:web-view-select:loop (no connected changed output)'
            )
        );
        assert.ok(!result.statement.includes('.output_changed'));
    });

    it('select renderMarkup produces select DOM with options', () => {
        const impl =
            globalThis.WebviewGeneratorShared.getNodeKindImplementation?.('web-view-select');
        assert.ok(impl, 'Expected select implementation');
        const lines = impl.renderMarkup({
            indent: '',
            childIndent: '  ',
            nodeId: 'node-select',
            element: {
                controls: {
                    optionCount: 3,
                    defaultIndex: 1,
                    title: 'Mode',
                    label_1: 'A',
                    value_1: 'a',
                    label_2: 'B',
                    value_2: 'b',
                    label_3: 'C',
                    value_3: 'c',
                },
                binding: {
                    elementId: 'wv_el_select_node_select_s0',
                    payloadKey: 'wv_bind_select_node_select_s0',
                },
            },
            escapeHtml: (v) => String(v),
        });
        assert.ok(Array.isArray(lines) && lines.length >= 6, 'Expected markup lines');
        const markup = lines.join('\n');
        assert.ok(markup.includes('wv-select'), 'Expected wv-select class');
        assert.ok(markup.includes('<select'), 'Expected select element');
        assert.ok((markup.match(/<option/g) || []).length === 3, 'Expected 3 options');
        assert.ok(markup.includes(' selected'), 'Expected selected attribute');
        assert.ok(markup.includes('wv_bind_select_node_select_s0'), 'Expected payload key');
    });

    it('select renderClientUpdateHandler rebuilds options', () => {
        const impl =
            globalThis.WebviewGeneratorShared.getNodeKindImplementation?.('web-view-select');
        const lines = impl.renderClientUpdateHandler({ nodeKind: 'web-view-select' });
        assert.ok(Array.isArray(lines) && lines.length > 0);
        const code = lines.join('\n');
        assert.ok(lines[0].startsWith('function applySelectUpdate('), 'Expected function name');
        assert.ok(code.includes('selectedIndex'), 'Expected selectedIndex handling');
    });

    it('select renderClientHelpers submits selectedIndex integer', () => {
        const impl =
            globalThis.WebviewGeneratorShared.getNodeKindImplementation?.('web-view-select');
        const lines = impl.renderClientHelpers({ nodeKind: 'web-view-select' });
        assert.ok(Array.isArray(lines) && lines.length > 0);
        const code = lines.join('\n');
        assert.ok(code.includes('function initializeSelects()'), 'Expected helper function');
        assert.ok(code.includes('index: selectEl.selectedIndex'), 'Expected index payload');
        assert.ok(code.includes('select'), 'Expected kind payload');
    });

    it('select renderClientInitHooks returns single call to initializeSelects', () => {
        const impl =
            globalThis.WebviewGeneratorShared.getNodeKindImplementation?.('web-view-select');
        const lines = impl.renderClientInitHooks({ nodeKind: 'web-view-select' });
        assert.ok(Array.isArray(lines) && lines.length === 1);
        assert.equal(lines[0], 'initializeSelects();');
    });

    it('input-control client helpers use POST_REFRESH_ROUTE, not a hardcoded /refresh', () => {
        const kinds = [
            'web-view-number-input',
            'web-view-string-input',
            'web-view-slider',
            'web-view-checkbox',
            'web-view-select',
        ];
        for (const kind of kinds) {
            const impl = globalThis.WebviewGeneratorShared.getNodeKindImplementation?.(kind);
            assert.ok(impl, `Expected ${kind} implementation`);
            const lines = impl.renderClientHelpers({ nodeKind: kind });
            const code = Array.isArray(lines) ? lines.join('\n') : '';
            assert.ok(
                code.includes('postRefreshWithTimeout('),
                `${kind} should use the shared POST_REFRESH_ROUTE helper`
            );
            assert.ok(!code.includes('fetch("/refresh"'), `${kind} should not hardcode /refresh`);
        }
    });

    it('input-control nodes register a frontend request value normalizer', () => {
        const kinds = [
            'web-view-number-input',
            'web-view-string-input',
            'web-view-slider',
            'web-view-checkbox',
            'web-view-select',
        ];
        for (const kind of kinds) {
            const impl = globalThis.WebviewGeneratorShared.getNodeKindImplementation?.(kind);
            assert.ok(impl, `Expected ${kind} implementation`);
            const normalizers = impl.getRefreshRequestValueNormalizers?.() || [];
            assert.deepEqual(
                normalizers,
                ['_wv_normalize_input_frontend_updates'],
                `${kind} should register the shared input-control normalizer`
            );
            const imports = impl.getRefreshHookImports?.() || [];
            const code = imports.join('\n');
            assert.ok(
                code.includes('def _wv_normalize_input_frontend_updates(request_payload):'),
                `${kind} should emit the normalizer hook import`
            );
        }
    });

    it('number-input layout model element has binding with numinput type code', async () => {
        const consumer = globalThis.NodeHelperHandoffConsumers['web-runtime'];
        const result = await consumer({
            group: {
                mergedData: {
                    'webNode:node-root': {
                        id: 'node-root',
                        kind: 'web-root',
                        controls: { title: 'NumInput Test' },
                    },
                    'webNode:node-numinput': {
                        id: 'node-numinput',
                        kind: 'web-view-number-input',
                        controls: { maxDigits: 6, title: 'Speed', value: 0 },
                        layout: { parentNodeId: 'node-root', parentOutputIndex: 0 },
                    },
                },
                webserverSpecPatch: {
                    needsWebDataStore: true,
                    requiresPostRefresh: true,
                    disableCompressedAssets: true,
                },
            },
            collection: {
                id: 'collection-numinput-test',
                title: 'NumInput Test Collection',
                webAssetGenerationMode: 'plain',
            },
        });

        const layoutModelArtifact = Array.isArray(result?.artifacts)
            ? result.artifacts.find((a) => a.targetPath === 'collection/webview_layout_model.json')
            : null;
        const layoutModel = layoutModelArtifact
            ? JSON.parse(String(layoutModelArtifact.content))
            : null;

        const numInputElement = layoutModel?.elements?.['node:node-numinput'];
        assert.ok(numInputElement, 'Expected number-input layout element');
        assert.ok(
            typeof numInputElement?.binding?.elementId === 'string' &&
                numInputElement.binding.elementId.includes('numinput'),
            'Expected numinput in elementId'
        );
        assert.ok(
            typeof numInputElement?.binding?.payloadKey === 'string' &&
                numInputElement.binding.payloadKey.includes('numinput'),
            'Expected numinput in payloadKey'
        );
    });

    it('number-input HTML markup includes label and input elements', async () => {
        const consumer = globalThis.NodeHelperHandoffConsumers['web-runtime'];
        const result = await consumer({
            group: {
                mergedData: {
                    'webNode:node-root': {
                        id: 'node-root',
                        kind: 'web-root',
                        controls: { title: 'NumInput HTML Test' },
                    },
                    'webNode:node-numinput': {
                        id: 'node-numinput',
                        kind: 'web-view-number-input',
                        controls: { maxDigits: 5, title: 'Temp', value: 23 },
                        layout: { parentNodeId: 'node-root', parentOutputIndex: 0 },
                    },
                },
                webserverSpecPatch: {
                    needsWebDataStore: true,
                    requiresPostRefresh: true,
                    disableCompressedAssets: true,
                },
            },
            collection: {
                id: 'collection-numinput-html',
                title: 'NumInput HTML Collection',
                webAssetGenerationMode: 'plain',
            },
        });

        const indexHtmlArtifact = Array.isArray(result?.artifacts)
            ? result.artifacts.find(
                  (a) => a.targetPath === 'collection/webview/collection-numinput-html/index.html'
              )
            : null;
        assert.ok(indexHtmlArtifact, 'Expected index.html artifact');

        const indexHtml = String(indexHtmlArtifact.content);
        assert.ok(
            indexHtml.includes('class="wv-input-control wv-number-input"'),
            'Expected wv-number-input class in HTML'
        );
        assert.ok(indexHtml.includes('class="wv-input-label"'), 'Expected label class');
        assert.ok(indexHtml.includes('type="number"'), 'Expected number input type');
        assert.ok(indexHtml.includes('data-wv-max-digits="5"'), 'Expected maxDigits attribute');
        assert.ok(indexHtml.includes('.wv-input-control {'), 'Expected CSS rule');
    });

    async function runWebviewHandoff(nodeKind, controls, collectionId) {
        const consumer = globalThis.NodeHelperHandoffConsumers['web-runtime'];
        return await consumer({
            group: {
                mergedData: {
                    'webNode:node-root': {
                        id: 'node-root',
                        kind: 'web-root',
                        controls: { title: `${nodeKind} Test` },
                    },
                    'webNode:node-x': {
                        id: 'node-x',
                        kind: nodeKind,
                        controls,
                        layout: { parentNodeId: 'node-root', parentOutputIndex: 0 },
                    },
                },
                webserverSpecPatch: {
                    needsWebDataStore: true,
                    requiresPostRefresh: true,
                    disableCompressedAssets: true,
                },
            },
            collection: {
                id: collectionId,
                title: `${nodeKind} Collection`,
                webAssetGenerationMode: 'plain',
            },
        });
    }

    function findLayoutElement(result) {
        const layoutModelArtifact = Array.isArray(result?.artifacts)
            ? result.artifacts.find((a) => a.targetPath === 'collection/webview_layout_model.json')
            : null;
        const layoutModel = layoutModelArtifact
            ? JSON.parse(String(layoutModelArtifact.content))
            : null;
        return layoutModel?.elements?.['node:node-x'];
    }

    function findIndexHtml(result) {
        const artifact = Array.isArray(result?.artifacts)
            ? result.artifacts.find((a) => a.targetPath && a.targetPath.endsWith('index.html'))
            : null;
        return artifact ? String(artifact.content) : '';
    }

    it('string-input artifact generation produces strinput binding and text markup', async () => {
        const result = await runWebviewHandoff(
            'web-view-string-input',
            { maxLength: 12, title: 'Name', value: 'abc' },
            'collection-string-input'
        );
        const el = findLayoutElement(result);
        assert.ok(el?.binding?.elementId?.includes('strinput'), 'Expected strinput in elementId');
        assert.ok(el?.binding?.payloadKey?.includes('strinput'), 'Expected strinput in payloadKey');
        const html = findIndexHtml(result);
        assert.ok(
            html.includes('class="wv-input-control wv-string-input"'),
            'Expected wv-string-input class'
        );
        assert.ok(html.includes('type="text"'), 'Expected text input type');
        assert.ok(html.includes('data-wv-max-length="12"'), 'Expected maxLength attribute');
    });

    it('slider artifact generation produces slider binding and range markup', async () => {
        const result = await runWebviewHandoff(
            'web-view-slider',
            { minValue: 0, maxValue: 100, step: 5, title: 'Speed', value: 42 },
            'collection-slider'
        );
        const el = findLayoutElement(result);
        assert.ok(el?.binding?.elementId?.includes('slider'), 'Expected slider in elementId');
        assert.ok(el?.binding?.payloadKey?.includes('slider'), 'Expected slider in payloadKey');
        const html = findIndexHtml(result);
        assert.ok(html.includes('class="wv-input-control wv-slider"'), 'Expected wv-slider class');
        assert.ok(html.includes('type="range"'), 'Expected range input type');
        assert.ok(html.includes('data-wv-min="0"'), 'Expected min attribute');
        assert.ok(html.includes('data-wv-max="100"'), 'Expected max attribute');
        assert.ok(html.includes('data-wv-step="5"'), 'Expected step attribute');
    });

    it('input-control payload keys are included in refresh bindings', async () => {
        const result = await runWebviewHandoff(
            'web-view-slider',
            { minValue: 0, maxValue: 100, step: 5, title: 'Speed', value: 42 },
            'collection-slider-bindings'
        );

        const hookArtifact = Array.isArray(result?.artifacts)
            ? result.artifacts.find((a) => a.targetPath === 'app/webserver_hooks_generated.py')
            : null;
        assert.ok(hookArtifact, 'Expected webserver hook module artifact');
        const hookSource = String(hookArtifact.content || '');
        assert.ok(hookSource.includes('REFRESH_BINDINGS = {'), 'Expected REFRESH_BINDINGS');
        assert.ok(
            hookSource.includes('wv_bind_slider'),
            'Expected slider payload key in REFRESH_BINDINGS'
        );
    });

    it('checkbox artifact generation produces checkbox binding and markup', async () => {
        const result = await runWebviewHandoff(
            'web-view-checkbox',
            { title: 'Enabled', value: true },
            'collection-checkbox'
        );
        const el = findLayoutElement(result);
        assert.ok(el?.binding?.elementId?.includes('checkbox'), 'Expected checkbox in elementId');
        assert.ok(el?.binding?.payloadKey?.includes('checkbox'), 'Expected checkbox in payloadKey');
        const html = findIndexHtml(result);
        assert.ok(
            html.includes('class="wv-input-control wv-checkbox"'),
            'Expected wv-checkbox class'
        );
        assert.ok(html.includes('type="checkbox"'), 'Expected checkbox input type');
        assert.ok(html.includes(' checked'), 'Expected checked attribute');
    });

    it('select artifact generation produces select binding and option markup', async () => {
        const result = await runWebviewHandoff(
            'web-view-select',
            {
                optionCount: 3,
                defaultIndex: 1,
                title: 'Mode',
                label_1: 'A',
                value_1: 'a',
                label_2: 'B',
                value_2: 'b',
                label_3: 'C',
                value_3: 'c',
            },
            'collection-select'
        );
        const el = findLayoutElement(result);
        assert.ok(el?.binding?.elementId?.includes('select'), 'Expected select in elementId');
        assert.ok(el?.binding?.payloadKey?.includes('select'), 'Expected select in payloadKey');
        const html = findIndexHtml(result);
        assert.ok(html.includes('class="wv-input-control wv-select"'), 'Expected wv-select class');
        assert.ok(html.includes('<select'), 'Expected select element');
        assert.ok((html.match(/<option/g) || []).length === 3, 'Expected 3 options');
    });

    it('mixed-node graph generates unique bindings for all six node kinds', async () => {
        const consumer = globalThis.NodeHelperHandoffConsumers['web-runtime'];
        const kinds = [
            'web-view-tile',
            'web-view-number-input',
            'web-view-string-input',
            'web-view-slider',
            'web-view-checkbox',
            'web-view-select',
        ];
        const mergedData = {
            'webNode:node-root': {
                id: 'node-root',
                kind: 'web-root',
                controls: { title: 'Mixed Test' },
            },
        };
        kinds.forEach((kind, index) => {
            mergedData[`webNode:node-${index}`] = {
                id: `node-${index}`,
                kind,
                controls:
                    kind === 'web-view-select'
                        ? { optionCount: 2, label_1: 'A', value_1: 1, label_2: 'B', value_2: 0 }
                        : { title: kind },
                layout: { parentNodeId: 'node-root', parentOutputIndex: 0 },
            };
        });
        const result = await consumer({
            group: {
                mergedData,
                webserverSpecPatch: {
                    needsWebDataStore: true,
                    requiresPostRefresh: true,
                    disableCompressedAssets: true,
                },
            },
            collection: {
                id: 'collection-mixed',
                title: 'Mixed Collection',
                webAssetGenerationMode: 'plain',
            },
        });
        const layoutModelArtifact = Array.isArray(result?.artifacts)
            ? result.artifacts.find((a) => a.targetPath === 'collection/webview_layout_model.json')
            : null;
        const layoutModel = layoutModelArtifact
            ? JSON.parse(String(layoutModelArtifact.content))
            : null;
        const elements = layoutModel?.elements || {};
        const elementIds = Object.values(elements)
            .map((e) => e?.binding?.elementId)
            .filter(Boolean);
        assert.equal(new Set(elementIds).size, elementIds.length, 'Expected unique element ids');
        assert.equal(
            Object.keys(elements).length,
            kinds.length + 1,
            'Expected all six nodes plus the root element'
        );
    });

    it('button renderClientStyleRules adds pressed feedback', () => {
        const impl =
            globalThis.WebviewGeneratorShared.getNodeKindImplementation?.('web-view-button');
        assert.ok(impl, 'Expected web-view-button implementation');
        const rules = impl.renderClientStyleRules({ nodeKind: 'web-view-button' });
        const css = Array.isArray(rules) ? rules.join('\n') : '';
        assert.ok(css.includes('.wv-button:active'));
        assert.ok(css.includes('.wv-button.wv-button-pressed'));
        assert.ok(css.includes('transform: scale(0.96)'));
        assert.ok(css.includes('transition:'));
    });

    it('button renderClientHelpers toggles pressed class via pointer events', () => {
        const impl =
            globalThis.WebviewGeneratorShared.getNodeKindImplementation?.('web-view-button');
        const lines = impl.renderClientHelpers({ nodeKind: 'web-view-button' });
        const code = Array.isArray(lines) ? lines.join('\n') : '';
        assert.ok(code.includes('pointerdown'));
        assert.ok(code.includes('pointerup'));
        assert.ok(code.includes('pointerleave'));
        assert.ok(code.includes('pointercancel'));
        assert.ok(code.includes('wv-button-pressed'));
        assert.ok(code.includes('kind: "button"'));
        assert.ok(code.includes('value: true'));
    });

    const STORE_IMPORT = 'import otter_vars.store as _store';

    function pythonLiteral(value) {
        if (value === null || value === undefined) return 'None';
        if (typeof value === 'number') return String(value);
        if (typeof value === 'boolean') return value ? 'True' : 'False';
        return `'${String(value)}'`;
    }

    function persistContext(overrides = {}) {
        const context = createContext();
        const imports = [];
        context.helpers = {
            ...context.helpers,
            formatLiteral: pythonLiteral,
            registerImport(statement) {
                imports.push(statement);
            },
        };
        context._registeredImports = imports;
        context.inputs = ['node_parent_out0', 'None', 'None'];
        context.inputSources = [{ fromIndex: 0 }, null, null];
        context.outputs = ['node_el_out0', 'node_val_out1'];
        context.graph = { id: 'graph-1', name: null };
        context.node = { id: 'node-9', type: 'content', controlValues: {} };
        return { ...context, ...overrides };
    }

    const persistScalarCases = [
        {
            generator: 'webviewNumberInput',
            nodeType: 'web-view-number-input',
            outVar: '_wv_numinput_out_graph_1_node_9',
            controls: { value: 4, title: 'Speed' },
            literal: '4',
        },
        {
            generator: 'webviewStringInput',
            nodeType: 'web-view-string-input',
            outVar: '_wv_strinput_out_graph_1_node_9',
            controls: { value: 'abc', title: 'Name' },
            literal: "'abc'",
        },
        {
            generator: 'webviewSlider',
            nodeType: 'web-view-slider',
            outVar: '_wv_slider_out_graph_1_node_9',
            controls: { value: 42, minValue: 0, maxValue: 100, step: 1 },
            literal: '42',
        },
        {
            generator: 'webviewCheckbox',
            nodeType: 'web-view-checkbox',
            outVar: '_wv_checkbox_out_graph_1_node_9',
            controls: { value: true },
            literal: 'True',
        },
    ];

    function scalarContext(spec, controlOverrides = {}, extra = {}) {
        return persistContext({
            node: {
                id: 'node-9',
                type: spec.nodeType,
                controlValues: { ...spec.controls, ...controlOverrides },
            },
            ...extra,
        });
    }

    for (const spec of persistScalarCases) {
        it(`${spec.generator} keeps persist off by default`, () => {
            const context = scalarContext(spec);
            const result = globalThis.NodeCodeGenerators[spec.generator](context);

            assert.ok(!result.statement.includes('_store'), 'Expected no store access');
            assert.ok(!context._registeredImports.includes(STORE_IMPORT));
            assert.ok(
                result.statement.includes(spec.literal),
                'Expected the configured literal default in update()'
            );
        });

        it(`${spec.generator} reads and writes the store when persist is on`, () => {
            const context = scalarContext(spec, { persist: true });
            const result = globalThis.NodeCodeGenerators[spec.generator](context);
            const getExpr = `_store.get('_webcontrol', 'graph-1:node-9', ${spec.literal})`;
            const setExpr = `_store.set('_webcontrol', 'graph-1:node-9', ${spec.outVar})`;
            const lines = result.statement.split('\n');
            const updateLine = lines.find((line) => line.includes('.update('));
            const setLine = lines.find((line) => line.includes('_store.set('));

            assert.ok(context._registeredImports.includes(STORE_IMPORT));
            assert.equal(
                context._registeredImports.filter((entry) => entry === STORE_IMPORT).length,
                1,
                'Expected exactly one store import registration'
            );
            assert.ok(updateLine, 'Expected an update() call');
            assert.ok(updateLine.includes(getExpr), 'Expected the store read as update() value');
            assert.equal(setLine, setExpr);
            assert.ok(
                result.statement.indexOf(setExpr) > result.statement.indexOf('.update('),
                'Expected the store write after the update() call'
            );
        });

        it(`${spec.generator} uses the connected value input as store fallback`, () => {
            const context = scalarContext(
                spec,
                { persist: true },
                {
                    inputs: ['node_parent_out0', 'None', 'node_7_out0'],
                    inputSources: [{ fromIndex: 0 }, null, { fromIndex: 2 }],
                }
            );
            const result = globalThis.NodeCodeGenerators[spec.generator](context);

            assert.ok(
                result.statement.includes(
                    "_store.get('_webcontrol', 'graph-1:node-9', node_7_out0)"
                ),
                'Expected the connected input expression as store fallback'
            );
        });
    }

    it('persist uses the bare node id when the graph has no id', () => {
        const context = scalarContext(
            persistScalarCases[0],
            { persist: true },
            {
                graph: { id: null, name: null },
            }
        );
        const result = globalThis.NodeCodeGenerators.webviewNumberInput(context);

        assert.ok(result.statement.includes("_store.get('_webcontrol', 'node-9', 4)"));
        assert.ok(
            result.statement.includes(
                "_store.set('_webcontrol', 'node-9', _wv_numinput_out_node_9)"
            )
        );
    });

    it('persist treats string and number false values as off', () => {
        for (const persist of ['false', 0, '0', '']) {
            const context = scalarContext(persistScalarCases[0], { persist });
            const result = globalThis.NodeCodeGenerators.webviewNumberInput(context);

            assert.ok(!result.statement.includes('_store'), `persist=${persist} should be off`);
            assert.ok(!context._registeredImports.includes(STORE_IMPORT));
        }
    });

    it('persist treats string and number true values as on', () => {
        for (const persist of ['true', 1, '1']) {
            const context = scalarContext(persistScalarCases[0], { persist });
            const result = globalThis.NodeCodeGenerators.webviewNumberInput(context);

            assert.ok(result.statement.includes('_store.get('), `persist=${persist} should be on`);
            assert.ok(result.statement.includes('_store.set('));
            assert.ok(context._registeredImports.includes(STORE_IMPORT));
        }
    });

    const selectOutputs = ['node_el_out0', 'node_val_out1', 'node_label_out2'];
    const SELECT_PERSIST_IDX = '_wv_select_persistidx_graph_1_node_9';
    const SELECT_BACKEND = '_wv_select_backend_graph_1_node_9';
    const SELECT_VALS = '_wv_select_vals_graph_1_node_9';

    function selectContext(controlValues, extra = {}) {
        return persistContext({
            outputs: selectOutputs,
            node: { id: 'node-9', type: 'web-view-select', controlValues },
            ...extra,
        });
    }

    it('select keeps persist off by default', () => {
        const context = selectContext({ optionCount: 2, defaultIndex: 1, value: 'a' });
        const result = globalThis.NodeCodeGenerators.webviewSelect(context);

        assert.ok(!result.statement.includes('_store'), 'Expected no store access');
        assert.ok(!result.statement.includes('_wv_select_persistidx_'));
        assert.ok(!context._registeredImports.includes(STORE_IMPORT));
        assert.ok(result.statement.includes('.update('), 'Expected an update() call');
    });

    it('select persists the selected index through the store', () => {
        const context = selectContext({ optionCount: 2, defaultIndex: 1, persist: true });
        const result = globalThis.NodeCodeGenerators.webviewSelect(context);
        const lines = result.statement.split('\n');

        const preludeIdx = lines.indexOf(
            `${SELECT_PERSIST_IDX} = _store.get('_webcontrol', 'graph-1:node-9', 1)`
        );
        assert.ok(preludeIdx > 0, 'Expected the persist index read');
        assert.equal(lines[preludeIdx + 1], `${SELECT_BACKEND} = ''`);
        assert.equal(
            lines[preludeIdx + 2],
            `if isinstance(${SELECT_PERSIST_IDX}, int) and 0 <= ${SELECT_PERSIST_IDX} < len(${SELECT_VALS}):`
        );
        assert.equal(
            lines[preludeIdx + 3],
            `    ${SELECT_BACKEND} = ${SELECT_VALS}[${SELECT_PERSIST_IDX}]`
        );

        const valsIdx = lines.indexOf(`${SELECT_VALS} = ['', '']`);
        assert.equal(valsIdx, 1, 'Expected the option value list right after the contract comment');
        assert.ok(valsIdx < preludeIdx, 'Expected the option list before the persist prelude');

        const updateIdx = lines.findIndex((line) => line.includes('.update('));
        assert.ok(updateIdx > preludeIdx + 3, 'Expected update() after the persist prelude');
        assert.ok(lines[updateIdx].includes(`.update(${SELECT_BACKEND},`));

        const setLine = lines.find((line) => line.includes('_store.set('));
        assert.equal(
            setLine,
            "_store.set('_webcontrol', 'graph-1:node-9', _wv_select_ctrl_graph_1_node_9._selected_index)"
        );
        assert.ok(
            lines.indexOf(setLine) > updateIdx,
            'Expected the store write after the update() call'
        );
        assert.ok(!setLine.includes('_wv_select_out_'), 'Expected the write-back to use the index');
    });

    it('select persist clamps the default index fallback to the option range', () => {
        const context = selectContext({ optionCount: 2, defaultIndex: 7, persist: true });
        const result = globalThis.NodeCodeGenerators.webviewSelect(context);

        assert.ok(result.statement.includes("_store.get('_webcontrol', 'graph-1:node-9', 1)"));
    });

    it('select persist uses the connected value input for the backend fallback', () => {
        const context = selectContext(
            { optionCount: 1, defaultIndex: 0, persist: true },
            {
                inputs: ['node_parent_out0', 'None', 'node_7_out0'],
                inputSources: [{ fromIndex: 0 }, null, { fromIndex: 2 }],
            }
        );
        const result = globalThis.NodeCodeGenerators.webviewSelect(context);

        assert.ok(result.statement.includes(`${SELECT_BACKEND} = node_7_out0`));
    });

    describe('webview client polling contract', () => {
        it('emits timeout, hidden-tab pause and adaptive backoff in the client', async () => {
            const consumer = globalThis.NodeHelperHandoffConsumers['web-runtime'];
            const result = await consumer({
                group: {
                    mergedData: {
                        'webNode:node-root': {
                            id: 'node-root',
                            kind: 'web-root',
                            controls: { title: 'Polling Contract' },
                        },
                    },
                    webserverSpecPatch: {
                        requiresPostRefresh: true,
                    },
                },
                collection: {
                    id: 'collection-polling-contract',
                    title: 'Polling Contract Collection',
                    webAssetGenerationMode: 'plain',
                },
            });

            const artifacts = Array.isArray(result?.artifacts) ? result.artifacts : [];
            const clientArtifact = artifacts.find(
                (artifact) =>
                    artifact.targetPath ===
                    'collection/webview/collection-polling-contract/webview_client.js'
            );
            assert.ok(clientArtifact, 'Expected generated client script artifact');

            const clientSource = String(clientArtifact.content || '');
            assert.match(clientSource, /REFRESH_TIMEOUT_MS/);
            assert.match(clientSource, /MAX_REFRESH_BACKOFF_MS/);
            assert.match(
                clientSource,
                /REFRESH_SLOW_THRESHOLD_MS = Math\.max\(REFRESH_INTERVAL_MS \* 2, 1000\)/
            );
            assert.match(clientSource, /let lastRefreshDurationMs = 0;/);
            assert.match(clientSource, /function refreshPeriodMs\(\)/);
            assert.match(clientSource, /scheduleNextRefresh\(\);/);
            assert.match(clientSource, /scheduleNextRefresh/);
            assert.match(clientSource, /postRefreshWithTimeout/);
            assert.match(
                clientSource,
                /return \{ ok: response\.ok, status: response\.status, bodyText \};/
            );
            assert.match(clientSource, /document\.hidden/);
            assert.match(clientSource, /visibilitychange/);
            assert.match(clientSource, /AbortController/);
            assert.ok(!clientSource.includes('setInterval'));
            assert.ok(
                !clientSource.includes('window.__wvDebug = true'),
                'The client must not force debug loggers on'
            );
        });

        it('paces completion-chained polls by the device round trip without inflating the interval', async () => {
            const consumer = globalThis.NodeHelperHandoffConsumers['web-runtime'];
            const result = await consumer({
                group: {
                    mergedData: {
                        'webNode:node-root': {
                            id: 'node-root',
                            kind: 'web-root',
                            controls: { title: 'Slow Device', refreshIntervalMs: 100 },
                        },
                    },
                    webserverSpecPatch: {
                        requiresPostRefresh: true,
                    },
                },
                collection: {
                    id: 'collection-slow-device-pacing',
                    title: 'Slow Device Pacing Collection',
                    webAssetGenerationMode: 'plain',
                },
            });

            const artifacts = Array.isArray(result?.artifacts) ? result.artifacts : [];
            const clientArtifact = artifacts.find(
                (artifact) =>
                    artifact.targetPath ===
                    'collection/webview/collection-slow-device-pacing/webview_client.js'
            );
            const indexArtifact = artifacts.find(
                (artifact) =>
                    artifact.targetPath ===
                    'collection/webview/collection-slow-device-pacing/index.html'
            );
            assert.ok(clientArtifact, 'Expected generated client script artifact');
            assert.ok(indexArtifact, 'Expected generated index artifact');

            const clientScript = String(clientArtifact.content || '');
            assert.ok(clientScript.includes('const REFRESH_INTERVAL_MS = 100;'));

            const dom = new JSDOM(String(indexArtifact.content || ''), {
                runScripts: 'outside-only',
                url: 'http://localhost/',
                pretendToBeVisual: true,
            });
            const { window } = dom;

            // Deterministic clock so the assertions describe the scheduler, not the host.
            let clock = 0;
            const timers = [];
            const pollStarts = [];
            let activeRequests = 0;
            let maxConcurrentRequests = 0;
            const deviceRoundTripMs = 250;

            window.Date.now = () => clock;
            Object.defineProperty(window, 'performance', {
                configurable: true,
                value: { now: () => clock },
            });
            window.setTimeout = (handler, delay) => {
                const timer = {
                    id: timers.length + 1,
                    at: clock + Math.max(0, Number(delay) || 0),
                    handler,
                    cancelled: false,
                    fired: false,
                };
                timers.push(timer);
                return timer.id;
            };
            window.clearTimeout = (timerId) => {
                const timer = timers.find((entry) => entry.id === timerId);
                if (timer) {
                    timer.cancelled = true;
                }
            };
            window.fetch = () => {
                activeRequests += 1;
                maxConcurrentRequests = Math.max(maxConcurrentRequests, activeRequests);
                pollStarts.push(clock);
                return new Promise((resolve) => {
                    window.setTimeout(() => {
                        activeRequests -= 1;
                        resolve({
                            ok: true,
                            status: 200,
                            text: () => Promise.resolve(JSON.stringify({ updates: [] })),
                        });
                    }, deviceRoundTripMs);
                });
            };
            window.console = { info: () => {}, warn: () => {}, log: () => {}, table: () => {} };

            const settle = async () => {
                for (let attempt = 0; attempt < 5; attempt += 1) {
                    await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
                }
            };
            const advance = async (durationMs) => {
                const target = clock + durationMs;
                for (;;) {
                    const due = timers
                        .filter((timer) => !timer.cancelled && !timer.fired && timer.at <= target)
                        .sort((left, right) => left.at - right.at || left.id - right.id)[0];
                    if (!due) {
                        break;
                    }
                    clock = due.at;
                    due.fired = true;
                    due.handler();
                    await settle();
                }
                clock = target;
                await settle();
            };

            window.eval(clientScript);
            await settle();
            await advance(3000);

            const stats = window.__wvPerfStats;
            assert.ok(stats, 'Expected the perf harness on the generated client');
            assert.equal(stats.skipped, 0, 'Completion-chained polling must not skip ticks');
            assert.equal(stats.errors, 0);
            assert.equal(maxConcurrentRequests, 1, 'Refreshes must never overlap');
            assert.equal(pollStarts[0], 0);

            const gaps = pollStarts
                .slice(1)
                .map((startedAt, index) => startedAt - pollStarts[index]);
            assert.ok(gaps.length >= 8, `Expected sustained polling, got ${gaps.length} polls`);
            assert.ok(
                gaps.every((gap) => gap >= deviceRoundTripMs - 1),
                `Expected every gap to cover the device round trip, saw ${gaps.join(',')}`
            );
            assert.ok(
                gaps.every((gap) => gap <= deviceRoundTripMs + 5),
                `Expected polling to keep up with the round trip, saw ${gaps.join(',')}`
            );

            const summary = window.__wvPerfSummary();
            assert.equal(summary.refreshIntervalMs, 100);
            assert.equal(
                summary.refreshSlowStreak,
                0,
                'A sub-second round trip must not arm the backoff'
            );

            dom.window.close();
        });

        it('keeps the console silent unless the perf harness is opted in', async () => {
            const consumer = globalThis.NodeHelperHandoffConsumers['web-runtime'];
            const result = await consumer({
                group: {
                    mergedData: {
                        'webNode:node-root': {
                            id: 'node-root',
                            kind: 'web-root',
                            controls: { title: 'Quiet Client', refreshIntervalMs: 100 },
                        },
                    },
                    webserverSpecPatch: {
                        requiresPostRefresh: true,
                    },
                },
                collection: {
                    id: 'collection-quiet-client',
                    title: 'Quiet Client Collection',
                    webAssetGenerationMode: 'plain',
                },
            });

            const artifacts = Array.isArray(result?.artifacts) ? result.artifacts : [];
            const clientArtifact = artifacts.find(
                (artifact) =>
                    artifact.targetPath ===
                    'collection/webview/collection-quiet-client/webview_client.js'
            );
            const indexArtifact = artifacts.find(
                (artifact) =>
                    artifact.targetPath === 'collection/webview/collection-quiet-client/index.html'
            );
            assert.ok(clientArtifact, 'Expected generated client script artifact');
            assert.ok(indexArtifact, 'Expected generated index artifact');

            const clientScript = String(clientArtifact.content || '');
            assert.ok(
                clientScript.includes('localStorage.getItem("wvPerf") === "1"'),
                'Perf logging must be opt-in'
            );

            /**
             * Builds a window running the generated client with console spies.
             * @param {string|null} perfFlag - `wvPerf` storage value, or null to leave it unset.
             * @returns {object} The DOM, window and recorded console calls.
             */
            const buildClientWindow = (perfFlag) => {
                const dom = new JSDOM(String(indexArtifact.content || ''), {
                    runScripts: 'outside-only',
                    url: 'http://localhost/',
                    pretendToBeVisual: true,
                });
                const { window } = dom;
                if (perfFlag !== null) {
                    window.localStorage.setItem('wvPerf', perfFlag);
                }
                const calls = { info: [], warn: [], table: [] };
                window.console = {
                    info: (...args) => calls.info.push(args),
                    warn: (...args) => calls.warn.push(args),
                    table: (...args) => calls.table.push(args),
                    log: () => {},
                    debug: () => {},
                };
                window.fetch = () =>
                    Promise.resolve({
                        ok: true,
                        status: 200,
                        text: () => Promise.resolve(JSON.stringify({ updates: [] })),
                    });
                window.eval(clientScript);
                return { dom, window, calls };
            };

            const quiet = buildClientWindow(null);
            await new Promise((resolve) => globalThis.setTimeout(resolve, 350));

            assert.equal(quiet.calls.info.length, 0, 'The default client must not log cadence');
            assert.equal(quiet.calls.table.length, 0, 'The default client must not log tables');
            assert.ok(
                quiet.window.__wvPerfSummary().polls >= 2,
                'Counters must keep accumulating while logging is off'
            );

            quiet.window.__wvPerfReport();
            assert.equal(quiet.calls.info.length, 1, '__wvPerfReport() logs exactly one snapshot');
            assert.equal(quiet.calls.info[0][0], '[wv-perf]');
            assert.match(String(quiet.calls.info[0][1]), /^summary polls=/);
            assert.equal(quiet.calls.table.length, 1);
            quiet.dom.window.close();

            const verbose = buildClientWindow('1');
            await new Promise((resolve) => globalThis.setTimeout(resolve, 350));

            assert.ok(verbose.calls.info.length > 0, 'wvPerf=1 must re-enable the recv lines');
            assert.equal(verbose.calls.info[0][0], '[wv-perf]');
            assert.match(String(verbose.calls.info[0][1]), /^recv #\d+ /);
            verbose.dom.window.close();
        });

        it('control generators use the shared timeout helper with a rejection guard', async () => {
            const consumer = globalThis.NodeHelperHandoffConsumers['web-runtime'];
            const result = await consumer({
                group: {
                    mergedData: {
                        'webNode:node-root': {
                            id: 'node-root',
                            kind: 'web-root',
                            controls: { title: 'Control Timeout' },
                        },
                        'webNode:node-slider': {
                            id: 'node-slider',
                            kind: 'slider',
                            controls: { label: 'Drive', min: 0, max: 10, step: 1, default: 1 },
                            layout: { parentNodeId: 'node-root', parentOutputIndex: 0 },
                        },
                    },
                    webserverSpecPatch: {
                        requiresPostRefresh: true,
                    },
                },
                collection: {
                    id: 'collection-control-timeout',
                    title: 'Control Timeout Collection',
                    webAssetGenerationMode: 'plain',
                },
            });

            const artifacts = Array.isArray(result?.artifacts) ? result.artifacts : [];
            const clientArtifact = artifacts.find(
                (artifact) =>
                    artifact.targetPath ===
                    'collection/webview/collection-control-timeout/webview_client.js'
            );
            assert.ok(clientArtifact, 'Expected generated client script artifact');

            const clientSource = String(clientArtifact.content || '');
            assert.match(
                clientSource,
                /postRefreshWithTimeout\(\{ \[frontendKey\]: \{ kind: "slider"/
            );
            assert.match(clientSource, /\.catch\(\(\) => \{\}\);/);
        });
    });
});

describe('legacy runtime artifacts', () => {
    it('legacy WebPageRuntime and client script files are removed from package assets', () => {
        assert.equal(existsSync(webviewRuntimePath), false);
        assert.equal(existsSync(webviewClientPath), false);
    });
});

describe('webview graph rules', () => {
    before(async () => {
        clearGraphRules();
        await import(`${pathToFileURL(webviewCapabilitiesPath).href}?test=webview-graph-rules`);
    });

    function webviewNode(id, type, controlValues = {}) {
        return { id, type, controlValues };
    }

    function validate(nodes, collectionNodes) {
        return validateGraphRules({
            graphId: 'g',
            nodes,
            nodeTypesByNodeId: {},
            collectionNodes,
        });
    }

    it('registers the two rules with their declared scopes', () => {
        const rules = getGraphRules().map((rule) => ({ id: rule.id, scope: rule.scope }));
        assert.ok(
            rules.some((rule) => rule.id === 'webview-page-contract' && rule.scope === 'graph')
        );
        assert.ok(
            rules.some(
                (rule) => rule.id === 'webview-root-ownership' && rule.scope === 'collection'
            )
        );
    });

    it('flags two roots with one issue per root and none on page nodes', () => {
        const issues = validate([
            webviewNode('r1', 'webview.web-root'),
            webviewNode('r2', 'webview.web-root'),
            webviewNode('p1', 'webview.web-page'),
        ]);

        const rootIssues = issues.filter(
            (issue) => issue.message === 'Only one Web Root node is allowed per graph.'
        );
        assert.equal(rootIssues.length, 2);
        assert.deepEqual(rootIssues.map((issue) => issue.nodeId).sort(), ['r1', 'r2']);
        assert.equal(
            issues.some((issue) => issue.nodeId === 'p1'),
            false
        );
    });

    it('accepts a single root', () => {
        const issues = validate([
            webviewNode('r1', 'webview.web-root'),
            webviewNode('p1', 'webview.web-page'),
        ]);
        assert.deepEqual(issues, []);
    });

    it('reports missing root ownership on the first page node', () => {
        const issues = validate([
            webviewNode('p1', 'webview.web-page'),
            webviewNode('p2', 'webview.web-page'),
        ]);

        const missing = issues.filter(
            (issue) =>
                issue.message ===
                'Missing root ownership: multi-page contracts require a Web Root node.'
        );
        assert.equal(missing.length, 1);
        assert.equal(missing[0].nodeId, 'p1');
        assert.equal(missing[0].contractIssue, 'missing-root-ownership');
    });

    it('clears the badge when the root lives in another graph', () => {
        const nodes = [
            webviewNode('p1', 'webview.web-page'),
            webviewNode('p2', 'webview.web-page'),
        ];
        const issues = validate(nodes, [...nodes, webviewNode('r1', 'webview.web-root')]);
        assert.deepEqual(issues, []);
    });

    it('flags duplicate page ids on the first page node', () => {
        const issues = validate([
            webviewNode('page-1', 'webview.web-page', { pageName: 'A' }),
            webviewNode('page_1', 'webview.web-page', { pageName: 'B' }),
        ]);

        const duplicates = issues.filter((issue) => issue.message.includes('Duplicate page id'));
        assert.equal(duplicates.length, 1);
        // Anchored to the page node that sorts first (pageNodes[0]); both ids are named.
        assert.ok(['page-1', 'page_1'].includes(duplicates[0].nodeId));
        assert.ok(duplicates[0].message.includes('page-1'));
        assert.ok(duplicates[0].message.includes('page_1'));
    });

    it('reports non-string pageName and title metadata', () => {
        const issues = validate([
            webviewNode('r1', 'webview.web-root', { title: 456 }),
            webviewNode('p1', 'webview.web-page', { pageName: 123 }),
        ]);

        const meta = issues.filter((issue) =>
            issue.message.includes('Invalid page navigation metadata')
        );
        assert.equal(meta.length, 2);
        assert.ok(
            meta.some((issue) => issue.message.includes('node p1: pageName must be a string.'))
        );
        assert.ok(meta.some((issue) => issue.message.includes('node r1: title must be a string.')));
    });

    it('reports nothing for a graph without webview nodes', () => {
        assert.deepEqual(validate([{ id: 'c1', type: 'core.const', controlValues: {} }]), []);
    });

    it('emits the full graph-rule issue shape', () => {
        const issues = validate([
            webviewNode('r1', 'webview.web-root'),
            webviewNode('r2', 'webview.web-root'),
        ]);
        assert.ok(issues.length > 0);
        issues.forEach((issue) => {
            assert.equal(issue.source, 'graphRule');
            assert.equal(issue.capability, null);
            assert.equal(issue.controlId, null);
            assert.equal(issue.inputId, null);
        });
    });
});
