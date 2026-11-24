import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    DOCUMENTATION_AREA_HEADER_HEIGHT_WORLD,
    DOCUMENTATION_AREA_RESIZE_HANDLE_WORLD,
    hitTestDocumentationAreas,
} from '../../src/micro_otter/nodes/html/js/views/documentation-area-hit-test.js';

function area(id, bounds) {
    return { id, title: id, markdown: '', color: '#4a90d9', bounds };
}

const BASELINE = { x: 100, y: 100, width: 200, height: 150 };

describe('hitTestDocumentationAreas', () => {
    it('classifies header, body and resize zones', () => {
        const areas = [area('1', BASELINE)];

        assert.deepEqual(hitTestDocumentationAreas({ x: 150, y: 105 }, areas, 1), {
            areaId: '1',
            zone: 'header',
        });
        assert.deepEqual(hitTestDocumentationAreas({ x: 150, y: 200 }, areas, 1), {
            areaId: '1',
            zone: 'body',
        });
        assert.deepEqual(hitTestDocumentationAreas({ x: 295, y: 245 }, areas, 1), {
            areaId: '1',
            zone: 'resize',
        });
    });

    it('returns null outside every area', () => {
        const areas = [area('1', BASELINE)];

        assert.equal(hitTestDocumentationAreas({ x: 99, y: 105 }, areas, 1), null);
        assert.equal(hitTestDocumentationAreas({ x: 301, y: 105 }, areas, 1), null);
        assert.equal(hitTestDocumentationAreas({ x: 150, y: 99 }, areas, 1), null);
        assert.equal(hitTestDocumentationAreas({ x: 150, y: 251 }, areas, 1), null);
    });

    it('counts the exact bottom-right corner as the resize zone', () => {
        const areas = [area('1', BASELINE)];

        assert.equal(
            hitTestDocumentationAreas({ x: 300, y: 250 }, areas, 1)?.zone,
            'resize'
        );
    });

    it('resolves overlapping areas to the last painted one', () => {
        const areas = [area('back', BASELINE), area('front', { ...BASELINE, x: 120 })];

        assert.equal(hitTestDocumentationAreas({ x: 150, y: 200 }, areas, 1)?.areaId, 'front');
        assert.equal(hitTestDocumentationAreas({ x: 105, y: 200 }, areas, 1)?.areaId, 'back');
    });

    it('scales the header and handle inversely with the zoom level', () => {
        const areas = [area('1', BASELINE)];
        const headerHeight = DOCUMENTATION_AREA_HEADER_HEIGHT_WORLD;
        const handle = DOCUMENTATION_AREA_RESIZE_HANDLE_WORLD;

        // At scale 2 the header covers half the world distance.
        assert.equal(
            hitTestDocumentationAreas({ x: 150, y: BASELINE.y + headerHeight * 0.75 }, areas, 2)
                ?.zone,
            'body'
        );
        assert.equal(
            hitTestDocumentationAreas({ x: 150, y: BASELINE.y + headerHeight * 0.75 }, areas, 1)
                ?.zone,
            'header'
        );

        // At scale 0.5 the handle covers twice the world distance.
        const handlePoint = {
            x: BASELINE.x + BASELINE.width - handle * 1.5,
            y: BASELINE.y + BASELINE.height - handle * 1.5,
        };
        assert.equal(hitTestDocumentationAreas(handlePoint, areas, 0.5)?.zone, 'resize');
        assert.equal(hitTestDocumentationAreas(handlePoint, areas, 1)?.zone, 'body');
    });

    it('falls back to scale 1 for invalid input and ignores empty lists', () => {
        const areas = [area('1', BASELINE)];

        assert.equal(hitTestDocumentationAreas({ x: 150, y: 105 }, areas, 0)?.zone, 'header');
        assert.equal(hitTestDocumentationAreas({ x: 150, y: 105 }, [], 1), null);
        assert.equal(hitTestDocumentationAreas(null, areas, 1), null);
    });
});
