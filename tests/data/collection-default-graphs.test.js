import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { Collection } from '../../src/micro_otter/nodes/html/js/data/collection.js';

describe('collection default graphs', () => {
    it('creates Init then Graph 1 with Graph 1 active', () => {
        const collection = new Collection({ id: '11111111-1111-4111-8111-111111111111' });
        const graphs = collection.getGraphArray();
        assert.equal(graphs.length, 2);
        assert.equal(graphs[0].getName(), 'Init');
        assert.equal(graphs[0].getExecutionType(), 'startup');
        assert.equal(graphs[1].getName(), 'Graph 1');
        assert.equal(graphs[1].getExecutionType(), 'continuous');
        assert.equal(collection.getActiveGraphIdx(), 1);
    });

    it('ships Init first with activeGraphId graph-1 in default.json', () => {
        const data = JSON.parse(
            readFileSync(path.resolve('src/micro_otter/nodes/device/graphs/default.json'), 'utf8')
        );
        assert.equal(data.graphs[0].name, 'Init');
        assert.equal(data.graphs[0].executionType, 'startup');
        assert.equal(data.graphs[1].name, 'Graph 1');
        assert.equal(data.activeGraphId, 'graph-1');
    });
});
