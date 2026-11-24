import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { IconProvider } from '../../src/micro_otter/nodes/html/js/views/icon-provider.js';

describe('IconProvider.describeIcon', () => {
    it('classifies an mdi: value as an MDI glyph', () => {
        assert.deepEqual(IconProvider.describeIcon('mdi:function'), {
            kind: 'mdi',
            value: 'mdi:function',
        });
    });

    it('classifies a registered icon name as an image with its resolved source', () => {
        const result = IconProvider.describeIcon('add');
        assert.equal(result.kind, 'image');
        assert.equal(result.src, IconProvider.get('add'));
    });

    it('classifies a data: image URI as an image', () => {
        const value = 'data:image/svg+xml;base64,PHN2Zy8+';
        assert.deepEqual(IconProvider.describeIcon(value), { kind: 'image', src: value });
    });

    it('classifies a path ending in an image extension as an image', () => {
        assert.deepEqual(IconProvider.describeIcon('/x.png'), { kind: 'image', src: '/x.png' });
    });

    it('classifies an emoji as text', () => {
        assert.deepEqual(IconProvider.describeIcon('⚠️'), { kind: 'text', glyph: '⚠️' });
    });

    it('classifies a foreign icon set as text, never an image URL', () => {
        // `ph:`/`hue:` are `<set>:<name>` values, not URLs, even though they look like URI schemes.
        assert.deepEqual(IconProvider.describeIcon('ph:house'), { kind: 'text', glyph: 'ph:house' });
    });

    it('classifies mdi: before the generic isImageSource scheme match', () => {
        // `isImageSource` matches `mdi:` as a generic URI scheme, so without the mdi-first check
        // this value would be classified as an image and printed as a (broken) <img>.
        assert.equal(IconProvider.isImageSource('mdi:function'), true);
        assert.equal(IconProvider.describeIcon('mdi:function').kind, 'mdi');
    });
});
