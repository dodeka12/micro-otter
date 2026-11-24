import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { readFileSync } from 'node:fs';

import { Transpiler } from '../../src/micro_otter/nodes/html/js/proc/transpiler.js';

const audioDefsPath = path.resolve(
    'src/micro_otter/nodes/device/node_pkgs/audio/node_definitions.json'
);
const powerDefsPath = path.resolve(
    'src/micro_otter/nodes/device/node_pkgs/power/node_definitions.json'
);
const audioManifestPath = path.resolve(
    'src/micro_otter/nodes/device/node_pkgs/audio/manifest.json'
);
const powerManifestPath = path.resolve(
    'src/micro_otter/nodes/device/node_pkgs/power/manifest.json'
);
const audioGeneratorsPath = path.resolve(
    'src/micro_otter/nodes/device/node_pkgs/audio/node_generators.js'
);
const powerGeneratorsPath = path.resolve(
    'src/micro_otter/nodes/device/node_pkgs/power/node_generators.js'
);

class MockNodeData {
    constructor({ id, type, inputs = [], outputs = [], controls = [], controlValues = {} }) {
        this.id = id;
        this.type = type;
        this.title = type;
        this.inputs = inputs;
        this.outputs = outputs;
        this.controls = controls;
        this.controlValues = controlValues;
        this.inputDefaults = {};
    }

    getId() {
        return this.id;
    }

    getType() {
        return this.type;
    }
}

class MockNodeGraph {
    constructor(id, name) {
        this.id = id;
        this.name = name;
        this.nodes = new Map();
        this.connections = [];
    }

    getId() {
        return this.id;
    }

    getName() {
        return this.name;
    }

    getTriggerInterval() {
        return 100;
    }

    getNodes() {
        const result = {};
        this.nodes.forEach((node, nodeId) => {
            result[nodeId] = node;
        });
        return result;
    }

    addNode(nodeId, node) {
        this.nodes.set(nodeId, node);
    }

    getConnections() {
        return this.connections.slice();
    }

    addConnection(connection) {
        this.connections.push({ ...connection });
    }
}

class MockCollection {
    constructor(id) {
        this.id = id;
        this.graphs = new Map();
    }

    getId() {
        return this.id;
    }

    getVersion() {
        return '1.0.0';
    }

    getVersionString() {
        return '1.0.0';
    }

    getTitle() {
        return this.id;
    }

    getGraphs() {
        const result = {};
        this.graphs.forEach((graph, graphId) => {
            result[graphId] = graph;
        });
        return result;
    }

    addGraph(graphId, graph) {
        this.graphs.set(graphId, graph);
    }
}

class MockRuntime {
    constructor() {
        this.definitions = new Map();
    }

    addNodeDefinition(type, definition) {
        this.definitions.set(type, definition);
    }

    getNodeType(type) {
        return this.definitions.get(type) || null;
    }
}

function loadJson(filePath) {
    return JSON.parse(readFileSync(filePath, 'utf8'));
}

function resolveMpAssets(manifest, nodeType) {
    const variants = manifest.variants || {};
    const wildcard = [];
    const specific = [];
    for (const variant of Object.values(variants)) {
        const mp = variant.mpAssets || {};
        if (Array.isArray(mp['*'])) {
            wildcard.push(...mp['*']);
        }
        if (Array.isArray(mp[nodeType])) {
            specific.push(...mp[nodeType]);
        }
    }
    return [...wildcard, ...specific];
}

function buildRuntime() {
    const runtime = new MockRuntime();
    const audioDefs = loadJson(audioDefsPath).nodeTypes;
    const powerDefs = loadJson(powerDefsPath).nodeTypes;
    const audioManifest = loadJson(audioManifestPath);
    const powerManifest = loadJson(powerManifestPath);

    for (const [type, def] of Object.entries(audioDefs)) {
        runtime.addNodeDefinition(type, {
            ...def,
            packageId: 'audio',
            mpAssets: resolveMpAssets(audioManifest, type),
            mpModuleRoots: audioManifest.mpModuleRoots || [''],
        });
    }
    for (const [type, def] of Object.entries(powerDefs)) {
        runtime.addNodeDefinition(type, {
            ...def,
            packageId: 'power',
            mpAssets: resolveMpAssets(powerManifest, type),
            mpModuleRoots: powerManifest.mpModuleRoots || [''],
        });
    }
    return runtime;
}

function buildNode(type, id, runtime, controlValues = {}) {
    const def = runtime.getNodeType(type);
    const inputs = (def.inputs || []).map((input) => ({ ...input }));
    const outputs = (def.outputs || []).map((output) => ({ ...output }));
    const controls = (def.controls || []).map((control) => ({ ...control }));
    return new MockNodeData({ id, type, inputs, outputs, controls, controlValues });
}

function buildReferenceGraph(runtime) {
    const graph = new MockNodeGraph('audio', 'VoiceDistort');
    graph.addNode('1', buildNode('i2s-input', '1', runtime));
    graph.addNode('2', buildNode('overdrive', '2', runtime));
    graph.addNode('3', buildNode('bitcrusher', '3', runtime));
    graph.addNode('4', buildNode('ring-mod', '4', runtime));
    graph.addNode('5', buildNode('gain', '5', runtime));
    graph.addNode('6', buildNode('i2s-output', '6', runtime));
    graph.addNode('7', buildNode('battery-monitor', '7', runtime));

    // audio.block chain: mic -> overdrive -> bitcrusher -> ring-mod -> gain -> speaker
    graph.addConnection({ fromNode: '1', fromIndex: 0, toNode: '2', toIndex: 0 });
    graph.addConnection({ fromNode: '2', fromIndex: 0, toNode: '3', toIndex: 0 });
    graph.addConnection({ fromNode: '3', fromIndex: 0, toNode: '4', toIndex: 0 });
    graph.addConnection({ fromNode: '4', fromIndex: 0, toNode: '5', toIndex: 0 });
    graph.addConnection({ fromNode: '5', fromIndex: 0, toNode: '6', toIndex: 0 });

    return graph;
}

describe('audio/power transpiler integration', () => {
    let originalSelf;
    let originalWindow;
    let originalNodeCodeGenerators;
    let originalNodeInitGenerators;
    let originalNodeHelperGenerators;

    before(async () => {
        originalSelf = globalThis.self;
        originalWindow = globalThis.window;
        originalNodeCodeGenerators = globalThis.NodeCodeGenerators;
        originalNodeInitGenerators = globalThis.NodeInitGenerators;
        originalNodeHelperGenerators = globalThis.NodeHelperGenerators;

        globalThis.self = globalThis;
        delete globalThis.window;
        globalThis.NodeCodeGenerators = {};
        globalThis.NodeInitGenerators = {};
        globalThis.NodeHelperGenerators = {};

        await import(`${pathToFileURL(audioGeneratorsPath).href}?test=audio-integration`);
        await import(`${pathToFileURL(powerGeneratorsPath).href}?test=power-integration`);
    });

    after(() => {
        if (originalSelf === undefined) delete globalThis.self;
        else globalThis.self = originalSelf;
        if (originalWindow === undefined) delete globalThis.window;
        else globalThis.window = originalWindow;
        if (originalNodeCodeGenerators === undefined) delete globalThis.NodeCodeGenerators;
        else globalThis.NodeCodeGenerators = originalNodeCodeGenerators;
        if (originalNodeInitGenerators === undefined) delete globalThis.NodeInitGenerators;
        else globalThis.NodeInitGenerators = originalNodeInitGenerators;
        if (originalNodeHelperGenerators === undefined) delete globalThis.NodeHelperGenerators;
        else globalThis.NodeHelperGenerators = originalNodeHelperGenerators;
    });

    it('transpiles the reference voice-distort graph with correct chain ordering', async () => {
        const runtime = buildRuntime();
        const collection = new MockCollection('voice');
        collection.addGraph('audio', buildReferenceGraph(runtime));

        const transpiler = new Transpiler({ logger: { log: () => {}, debug: () => {} } });
        const result = await transpiler.transpile(collection, { deviceRuntime: runtime });
        const normalized = result.code.replace(/\s+/g, ' ');

        // shared init_audio registers source -> filters -> sink; instance names carry the
        // graph scope (`voicedistort`) so a second graph cannot overwrite them.
        assert.match(normalized, /async def init_audio\(\):/);
        assert.match(normalized, /AUDIO_CHAIN = AudioChain\(\)/);
        assert.match(normalized, /AUDIO_CHAIN\.add_source\(_i2s_in_voicedistort_1\)/);
        assert.match(normalized, /AUDIO_CHAIN\.add_filter\(_od_voicedistort_2\)/);
        assert.match(normalized, /AUDIO_CHAIN\.add_filter\(_bit_voicedistort_3\)/);
        assert.match(normalized, /AUDIO_CHAIN\.add_filter\(_ring_voicedistort_4\)/);
        assert.match(normalized, /AUDIO_CHAIN\.add_filter\(_gain_voicedistort_5\)/);
        assert.match(normalized, /AUDIO_CHAIN\.set_sink\(_i2s_out_voicedistort_6\)/);

        // filters register in wiring order
        const odIdx = normalized.indexOf('add_filter(_od_voicedistort_2)');
        const bitIdx = normalized.indexOf('add_filter(_bit_voicedistort_3)');
        const ringIdx = normalized.indexOf('add_filter(_ring_voicedistort_4)');
        const gainIdx = normalized.indexOf('add_filter(_gain_voicedistort_5)');
        assert.ok(odIdx >= 0 && bitIdx > odIdx && ringIdx > bitIdx && gainIdx > ringIdx);

        // task start after sink registration
        const sinkIdx = normalized.indexOf('set_sink(_i2s_out_voicedistort_6)');
        const taskIdx = normalized.indexOf('asyncio.create_task(_audio_task())');
        assert.ok(sinkIdx >= 0 && taskIdx > sinkIdx);

        // loop parameter copies and metering
        assert.match(normalized, /_od_voicedistort_2\.drive = /);
        assert.match(normalized, /_bit_voicedistort_3\.bits = /);
        assert.match(normalized, /_ring_voicedistort_4\.frequency = /);
        assert.match(normalized, /_gain_voicedistort_5\.volume = /);
        assert.match(normalized, /_i2s_in_voicedistort_1\.level/);
        assert.match(normalized, /_bat_7\.update\(\)/);
        assert.match(normalized, /_bat_7\.voltage/);
        assert.match(normalized, /_bat_7\.warn/);
        assert.match(normalized, /_bat_7\.low/);

        // imports present
        assert.ok(result.code.includes('from otter_audio_viper.audio_chain import AudioChain'));
        assert.ok(result.code.includes('from otter_audio_viper.i2s_input import I2SInput'));
        assert.ok(result.code.includes('from otter_audio_viper.ring_mod import RingMod'));
        assert.ok(result.code.includes('from otter_power.battery import BatteryMonitor'));

        // no unresolved template placeholders
        assert.doesNotMatch(normalized, /\{\{/);
    });

    it('resolves audio and power package assets via mpAssets', async () => {
        const runtime = buildRuntime();
        const collection = new MockCollection('voice');
        collection.addGraph('audio', buildReferenceGraph(runtime));

        const transpiler = new Transpiler({ logger: { log: () => {}, debug: () => {} } });
        const result = await transpiler.transpile(collection, { deviceRuntime: runtime });

        const packages = result.assets?.packages || {};
        assert.ok(packages.audio, 'expected audio package assets');
        assert.ok(packages.power, 'expected power package assets');

        const audioFiles = (packages.audio.files || []).join('\n');
        for (const file of [
            'audio_chain.py',
            'i2s_input.py',
            'i2s_output.py',
            'overdrive.py',
            'bitcrusher.py',
            'ring_mod.py',
            'gain.py',
        ]) {
            assert.ok(audioFiles.includes(file), `audio assets missing ${file}`);
        }

        const powerFiles = (packages.power.files || []).join('\n');
        assert.ok(powerFiles.includes('battery.py'), 'power assets missing battery.py');
    });

    it('transpiles an oscillator-driven graph (generator as the only source)', async () => {
        const runtime = buildRuntime();
        const graph = new MockNodeGraph('osc', 'Oscillator');
        graph.addNode('1', buildNode('oscillator', '1', runtime));
        graph.addNode('2', buildNode('bitcrusher', '2', runtime));
        graph.addNode('3', buildNode('i2s-output', '3', runtime));
        graph.addConnection({ fromNode: '1', fromIndex: 0, toNode: '2', toIndex: 0 });
        graph.addConnection({ fromNode: '2', fromIndex: 0, toNode: '3', toIndex: 0 });

        const collection = new MockCollection('osc');
        collection.addGraph('audio', graph);

        const transpiler = new Transpiler({ logger: { log: () => {}, debug: () => {} } });
        const result = await transpiler.transpile(collection, { deviceRuntime: runtime });
        const normalized = result.code.replace(/\s+/g, ' ');

        assert.match(normalized, /_osc_oscillator_1 = Oscillator\(/);
        assert.match(normalized, /AUDIO_CHAIN\.add_source\(_osc_oscillator_1\)/);
        assert.match(normalized, /AUDIO_CHAIN\.add_filter\(_bit_oscillator_2\)/);
        assert.match(normalized, /AUDIO_CHAIN\.set_sink\(_i2s_out_oscillator_3\)/);
    });

    it('transpiles an i2s-input through an oscillator mix-in filter', async () => {
        const runtime = buildRuntime();
        const graph = new MockNodeGraph('osc-fx', 'Oscillator Filter');
        graph.addNode('1', buildNode('i2s-input', '1', runtime));
        graph.addNode('2', buildNode('oscillator', '2', runtime));
        graph.addNode('3', buildNode('i2s-output', '3', runtime));
        graph.addConnection({ fromNode: '1', fromIndex: 0, toNode: '2', toIndex: 0 });
        graph.addConnection({ fromNode: '2', fromIndex: 0, toNode: '3', toIndex: 0 });

        const collection = new MockCollection('osc-fx');
        collection.addGraph('audio', graph);

        const transpiler = new Transpiler({ logger: { log: () => {}, debug: () => {} } });
        const result = await transpiler.transpile(collection, { deviceRuntime: runtime });
        const normalized = result.code.replace(/\s+/g, ' ');

        assert.match(normalized, /AUDIO_CHAIN\.add_source\(_i2s_in_oscillator_filter_1\)/);
        assert.match(normalized, /_osc_oscillator_filter_2 = Oscillator\(/);
        assert.match(normalized, /AUDIO_CHAIN\.add_filter\(_osc_oscillator_filter_2\)/);
        assert.match(normalized, /AUDIO_CHAIN\.set_sink\(_i2s_out_oscillator_filter_3\)/);
        assert.doesNotMatch(normalized, /AUDIO_CHAIN\.set_source\(_osc_oscillator_filter_2\)/);
        assert.doesNotMatch(normalized, /AUDIO_CHAIN\.add_source\(_osc_oscillator_filter_2\)/);
    });

    it('transpiles a square-fuzz chain with its mix control', async () => {
        const runtime = buildRuntime();
        const graph = new MockNodeGraph('fuzz', 'Square Fuzz');
        graph.addNode('1', buildNode('i2s-input', '1', runtime));
        graph.addNode('2', buildNode('square-fuzz', '2', runtime));
        graph.addNode('3', buildNode('i2s-output', '3', runtime));
        graph.addConnection({ fromNode: '1', fromIndex: 0, toNode: '2', toIndex: 0 });
        graph.addConnection({ fromNode: '2', fromIndex: 0, toNode: '3', toIndex: 0 });

        const collection = new MockCollection('fuzz');
        collection.addGraph('audio', graph);

        const transpiler = new Transpiler({ logger: { log: () => {}, debug: () => {} } });
        const result = await transpiler.transpile(collection, { deviceRuntime: runtime });
        const normalized = result.code.replace(/\s+/g, ' ');

        assert.match(normalized, /AUDIO_CHAIN\.add_filter\(_fuzz_square_fuzz_2\)/);
        assert.ok(result.code.includes('from otter_audio_viper.square_fuzz import SquareFuzz'));
        // loop-phase copies follow the node's input order
        const levelIdx = normalized.indexOf('_fuzz_square_fuzz_2.level = ');
        const mixIdx = normalized.indexOf('_fuzz_square_fuzz_2.mix = ');
        const envelopeIdx = normalized.indexOf('_fuzz_square_fuzz_2.envelopeFollow = ');
        const enabledIdx = normalized.indexOf('_fuzz_square_fuzz_2.enabled = ');
        assert.ok(
            levelIdx >= 0 && mixIdx > levelIdx && envelopeIdx > mixIdx
                && enabledIdx > envelopeIdx,
            'expected level -> mix -> envelopeFollow -> enabled assignments'
        );
        assert.match(normalized, /_fuzz_square_fuzz_2\.mix = 0\.5/);
    });

    it('transpiles a bitcrusher -> downsampler lo-fi chain', async () => {
        const runtime = buildRuntime();
        const graph = new MockNodeGraph('lofi', 'Lo-Fi');
        graph.addNode('1', buildNode('i2s-input', '1', runtime));
        graph.addNode('2', buildNode('bitcrusher', '2', runtime));
        graph.addNode('3', buildNode('downsampler', '3', runtime));
        graph.addNode('4', buildNode('i2s-output', '4', runtime));
        graph.addConnection({ fromNode: '1', fromIndex: 0, toNode: '2', toIndex: 0 });
        graph.addConnection({ fromNode: '2', fromIndex: 0, toNode: '3', toIndex: 0 });
        graph.addConnection({ fromNode: '3', fromIndex: 0, toNode: '4', toIndex: 0 });

        const collection = new MockCollection('lofi');
        collection.addGraph('audio', graph);

        const transpiler = new Transpiler({ logger: { log: () => {}, debug: () => {} } });
        const result = await transpiler.transpile(collection, { deviceRuntime: runtime });
        const normalized = result.code.replace(/\s+/g, ' ');

        assert.ok(result.code.includes('from otter_audio_viper.bitcrusher import Bitcrusher'));
        assert.ok(result.code.includes('from otter_audio_viper.downsampler import Downsampler'));
        assert.match(normalized, /_ds_lo_fi_3 = Downsampler\(rate=16000\)/);
        assert.match(normalized, /AUDIO_CHAIN\.add_filter\(_bit_lo_fi_2\)/);
        assert.match(normalized, /AUDIO_CHAIN\.add_filter\(_ds_lo_fi_3\)/);

        assert.match(normalized, /_bit_lo_fi_2\.bits = 4/);
        assert.match(normalized, /_bit_lo_fi_2\.mix = 1/);
        assert.match(normalized, /_ds_lo_fi_3\.hold = 4/);
        assert.match(normalized, /_ds_lo_fi_3\.mix = 1/);
        assert.match(normalized, /_ds_lo_fi_3\.antiAlias = True/);
    });

    it('emits the AUDIO_CHAIN bootstrap before unwired filters that sort before the source', async () => {
        const runtime = buildRuntime();
        const graph = new MockNodeGraph('noise-first', 'Noise First');
        graph.addNode('1', buildNode('noise', '1', runtime));
        graph.addNode('2', buildNode('i2s-input', '2', runtime));
        graph.addNode('3', buildNode('i2s-output', '3', runtime));
        // The noise block input is intentionally left unwired, so it is a root that
        // sorts before the i2s-input source. AUDIO_CHAIN must still be initialized
        // before the filter registers (previously this raised NameError on device).
        graph.addConnection({ fromNode: '2', fromIndex: 0, toNode: '3', toIndex: 0 });

        const collection = new MockCollection('noise-first');
        collection.addGraph('audio', graph);

        const transpiler = new Transpiler({ logger: { log: () => {}, debug: () => {} } });
        const result = await transpiler.transpile(collection, { deviceRuntime: runtime });
        const normalized = result.code.replace(/\s+/g, ' ');

        const chainIdx = normalized.indexOf('AUDIO_CHAIN = AudioChain()');
        const filterIdx = normalized.indexOf('add_filter(_noise_noise_first_1)');
        assert.ok(chainIdx >= 0, 'expected AUDIO_CHAIN bootstrap');
        assert.ok(filterIdx >= 0, 'expected noise filter registration');
        assert.ok(
            chainIdx < filterIdx,
            'AUDIO_CHAIN must be created before filters register against it'
        );
    });

    it('keeps same-id audio instances apart across graphs', async () => {
        const runtime = buildRuntime();

        // Node ids restart in every graph, so both sources are id `1`; only the graph scope
        // separates the two module-level instances inside the merged init_audio function.
        const buildMicGraph = (id, name, sampleRate) => {
            const graph = new MockNodeGraph(id, name);
            graph.addNode(
                '1',
                buildNode('i2s-input', '1', runtime, { sampleRate, dataPin: 7 })
            );
            graph.addNode('2', buildNode('i2s-output', '2', runtime));
            graph.addConnection({ fromNode: '1', fromIndex: 0, toNode: '2', toIndex: 0 });
            return graph;
        };

        const collection = new MockCollection('two-mics');
        collection.addGraph('a', buildMicGraph('a', 'Mic A', 8000));
        collection.addGraph('b', buildMicGraph('b', 'Mic B', 16000));

        const transpiler = new Transpiler({ logger: { log: () => {}, debug: () => {} } });
        const result = await transpiler.transpile(collection, { deviceRuntime: runtime });
        const normalized = result.code.replace(/\s+/g, ' ');

        assert.match(normalized, /async def mic_a\(\):/);
        assert.match(normalized, /async def mic_b\(\):/);

        assert.match(normalized, /_i2s_in_mic_a_1 = I2SInput\([^)]*rate=8000/);
        assert.match(normalized, /_i2s_in_mic_b_1 = I2SInput\([^)]*rate=16000/);
        assert.ok(!normalized.includes('_i2s_in_1 ='));

        // Both sources stay registered: no second assignment overwrote the first.
        assert.match(normalized, /AUDIO_CHAIN\.add_source\(_i2s_in_mic_a_1\)/);
        assert.match(normalized, /AUDIO_CHAIN\.add_source\(_i2s_in_mic_b_1\)/);
    });
});
