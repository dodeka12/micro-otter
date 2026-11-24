import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const capabilitiesPath = path.resolve('src/micro_otter/nodes/device/node_pkgs/vars/node_capabilities.js');

async function loadHandlers() {
    const handlers = new Map();
    const module = await import(`${pathToFileURL(capabilitiesPath).href}?test=vars-capabilities`);
    await module.registerCapabilityChecks((nodeTypeId, handler) => handlers.set(nodeTypeId, handler));
    return handlers;
}

describe('vars capability checks', () => {
    it('registers the signal-post check', async () => {
        const handlers = await loadHandlers();
        assert.equal(handlers.size, 1);
        assert.ok(handlers.has('vars.signal-post'), 'expected a vars.signal-post handler');
    });

    it('accepts a valid signal name', async () => {
        const handlers = await loadHandlers();
        const check = handlers.get('vars.signal-post');
        const issues = check({ nodeData: { id: 'n1', controlValues: { signal: 'radar-run' } } });
        assert.deepEqual(issues, []);
    });

    it('accepts a blank signal name as the disabled (not set) state', async () => {
        const handlers = await loadHandlers();
        const check = handlers.get('vars.signal-post');
        const issues = check({ nodeData: { id: 'n1', controlValues: { signal: '' } } });
        assert.deepEqual(issues, []);
    });

    it('reports an over-long signal name as an error', async () => {
        const handlers = await loadHandlers();
        const check = handlers.get('vars.signal-post');
        const issues = check({
            nodeData: { id: 'n1', controlValues: { signal: 'a'.repeat(65) } },
        });
        assert.equal(issues.length, 1);
        assert.match(issues[0].message, /longer than 64 characters/);
    });

    it('reports an ambiguous signal name as a warning', async () => {
        const handlers = await loadHandlers();
        const check = handlers.get('vars.signal-post');
        const issues = check({
            nodeData: { id: 'n1', controlValues: { signal: 'has space' } },
        });
        assert.equal(issues.length, 1);
        assert.equal(issues[0].severity, 'warn');
        assert.match(issues[0].message, /outside \[A-Za-z0-9\._-\]/);
    });

    it('resolves the sentinel through customSignal before validating', async () => {
        const handlers = await loadHandlers();
        const check = handlers.get('vars.signal-post');
        const blank = check({
            nodeData: { id: 'n1', controlValues: { signal: '__new__', customSignal: '' } },
        });
        assert.deepEqual(blank, []);

        const valid = check({
            nodeData: { id: 'n1', controlValues: { signal: '__new__', customSignal: 'motion' } },
        });
        assert.deepEqual(valid, []);
    });
});
