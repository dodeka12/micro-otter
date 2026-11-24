import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import DocumentationArea, {
    DOCUMENTATION_AREA_BORDER_ALPHA,
    DOCUMENTATION_AREA_DEFAULT_COLOR,
    DOCUMENTATION_AREA_DEFAULT_FONT_SIZE,
    DOCUMENTATION_AREA_DEFAULT_SIZE,
    DOCUMENTATION_AREA_FILL_ALPHA,
    DOCUMENTATION_AREA_MIN_SIZE,
    areaBoundsEqual,
    normalizeAreaBounds,
    normalizeAreaColor,
    normalizeAreaFontSize,
} from '../../src/micro_otter/nodes/html/js/data/documentation-area.js';

describe('documentation-area: constants', () => {
    it('exports the translucency constants used at render time', () => {
        assert.equal(DOCUMENTATION_AREA_FILL_ALPHA, 0.16);
        assert.equal(DOCUMENTATION_AREA_BORDER_ALPHA, 0.65);
        assert.equal(DOCUMENTATION_AREA_DEFAULT_COLOR, '#4a90d9');
        assert.equal(DOCUMENTATION_AREA_DEFAULT_FONT_SIZE, 'normal');
        assert.deepEqual({ ...DOCUMENTATION_AREA_DEFAULT_SIZE }, { width: 320, height: 200 });
        assert.deepEqual({ ...DOCUMENTATION_AREA_MIN_SIZE }, { width: 120, height: 80 });
    });
});

describe('documentation-area: normalizeAreaColor', () => {
    it('accepts #rrggbb in upper and lower case', () => {
        assert.equal(normalizeAreaColor('#4A90D9'), '#4a90d9');
        assert.equal(normalizeAreaColor('#abc123'), '#abc123');
    });

    it('expands #rgb to #rrggbb', () => {
        assert.equal(normalizeAreaColor('#ABC'), '#aabbcc');
        assert.equal(normalizeAreaColor(' #fa0 '), '#ffaa00');
    });

    it('rejects alpha channels, colour names and empty input', () => {
        for (const value of ['rgba(1,2,3,0.5)', 'red', '', null, undefined, 42, '#abcd']) {
            assert.equal(normalizeAreaColor(value), DOCUMENTATION_AREA_DEFAULT_COLOR);
        }
    });
});

describe('documentation-area: normalizeAreaFontSize', () => {
    it('accepts the three supported presets', () => {
        assert.equal(normalizeAreaFontSize('small'), 'small');
        assert.equal(normalizeAreaFontSize('normal'), 'normal');
        assert.equal(normalizeAreaFontSize('large'), 'large');
    });

    it('falls back to normal for malformed input', () => {
        for (const value of ['huge', 'Small', '', null, undefined, 42, {}]) {
            assert.equal(normalizeAreaFontSize(value), DOCUMENTATION_AREA_DEFAULT_FONT_SIZE);
        }
    });
});

describe('documentation-area: normalizeAreaBounds', () => {
    it('clamps a too-small size up to the minimum', () => {
        const bounds = normalizeAreaBounds({ x: 10, y: 20, width: 5, height: 1 });

        assert.deepEqual(bounds, { x: 10, y: 20, width: 120, height: 80 });
    });

    it('keeps a valid size untouched', () => {
        const bounds = normalizeAreaBounds({ x: -40, y: 12.5, width: 400, height: 250 });

        assert.deepEqual(bounds, { x: -40, y: 12.5, width: 400, height: 250 });
    });

    it('coerces non-finite and missing values', () => {
        const bounds = normalizeAreaBounds({ x: NaN, y: Infinity, width: 'abc', height: null });

        assert.deepEqual(bounds, {
            x: 0,
            y: 0,
            width: DOCUMENTATION_AREA_DEFAULT_SIZE.width,
            height: DOCUMENTATION_AREA_DEFAULT_SIZE.height,
        });
    });

    it('falls back to the default size for a zero-size or non-object input', () => {
        assert.deepEqual(normalizeAreaBounds(undefined), {
            x: 0,
            y: 0,
            width: DOCUMENTATION_AREA_DEFAULT_SIZE.width,
            height: DOCUMENTATION_AREA_DEFAULT_SIZE.height,
        });
        assert.deepEqual(normalizeAreaBounds({ width: 0, height: 0 }).width, 320);
    });
});

describe('documentation-area: areaBoundsEqual', () => {
    it('compares all four fields', () => {
        const base = { x: 1, y: 2, width: 3, height: 4 };

        assert.equal(areaBoundsEqual(base, { ...base }), true);
        for (const key of ['x', 'y', 'width', 'height']) {
            assert.equal(areaBoundsEqual(base, { ...base, [key]: 99 }), false, key);
        }
    });
});

describe('documentation-area: instance', () => {
    it('applies defaults for an empty payload', () => {
        const area = DocumentationArea.fromData({});

        assert.equal(area.id, '');
        assert.equal(area.title, '');
        assert.equal(area.markdown, '');
        assert.equal(area.color, DOCUMENTATION_AREA_DEFAULT_COLOR);
        assert.equal(area.fontSize, 'normal');
        assert.deepEqual(area.bounds, { x: 0, y: 0, width: 320, height: 200 });
    });

    it('tolerates malformed fields', () => {
        const area = DocumentationArea.fromData({
            id: 7,
            title: 12,
            markdown: null,
            color: 'rgba(0,0,0,1)',
            fontSize: 'gigantic',
            bounds: 'nope',
        });

        assert.equal(area.id, '');
        assert.equal(area.title, '');
        assert.equal(area.markdown, '');
        assert.equal(area.color, DOCUMENTATION_AREA_DEFAULT_COLOR);
        assert.equal(area.fontSize, 'normal');
        assert.deepEqual(area.bounds, { x: 0, y: 0, width: 320, height: 200 });
    });

    it('returns a detached copy from toData()', () => {
        const area = DocumentationArea.fromData({
            id: '3',
            title: 'Title',
            markdown: '**body**',
            color: '#123456',
            fontSize: 'large',
            bounds: { x: 1, y: 2, width: 300, height: 200 },
        });

        const data = area.toData();
        assert.equal(data.fontSize, 'large');
        data.bounds.x = 999;
        data.title = 'changed';
        assert.equal(area.bounds.x, 1);
        assert.equal(area.title, 'Title');

        area.setBounds({ x: 5, y: 6, width: 300, height: 200 });
        area.setFontSize('small');
        assert.equal(data.bounds.x, 999);
        assert.equal(data.fontSize, 'large');
    });

    it('setters normalize and return the instance', () => {
        const area = new DocumentationArea();

        assert.equal(area.setId(' 9 '), area);
        assert.equal(area.setTitle('T').setMarkdown('M').setColor('#ABC').setFontSize('large'), area);

        assert.equal(area.id, '9');
        assert.equal(area.color, '#aabbcc');
        assert.equal(area.fontSize, 'large');
        assert.deepEqual(area.toData().bounds, { x: 0, y: 0, width: 320, height: 200 });
    });
});
