import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDomHarness } from '../helpers/dom-harness.js';
import { NodePaletteView } from '../../src/micro_otter/nodes/html/js/views/node-palette-view.js';
import { IconProvider } from '../../src/micro_otter/nodes/html/js/views/icon-provider.js';

function createRuntime() {
    return {
        nodePackages: [
            {
                id: 'pkg-core',
                name: 'Core Package',
                nodeTypes: new Map([
                    [
                        'const',
                        {
                            id: 'const',
                            title: 'Constant',
                            info: 'Emits constant value',
                            category: 'basic',
                            color: '#4a6fa5',
                        },
                    ],
                    [
                        'print',
                        {
                            id: 'print',
                            title: 'Print',
                            info: 'Print to console output',
                            category: 'debug',
                            color: '#a56c6f',
                        },
                    ],
                ]),
            },
            {
                id: 'pkg-math',
                name: 'Math Package',
                nodeTypes: new Map([
                    [
                        'math',
                        {
                            id: 'math',
                            title: 'Math',
                            info: '',
                            category: 'calculation',
                            color: '#6b8b9e',
                        },
                    ],
                ]),
            },
        ],
    };
}

function createWorkspaceConfig(initial = {}) {
    return {
        nodePalette: {
            organizationMode: 'alphabetical',
            viewSize: 'small',
            favorites: [],
            recentlyUsed: [],
            sectionStates: {},
            ...initial,
        },
    };
}

function createI18nService() {
    const listeners = new Map();
    return {
        currentLocale: 'en',
        t: (_key, fallback) => {
            if (typeof fallback === 'string') {
                return fallback;
            }
            return _key;
        },
        addEventListener(type, handler) {
            listeners.set(type, handler);
        },
        removeEventListener(type) {
            listeners.delete(type);
        },
    };
}

function createViewManagerMock() {
    const calls = [];
    const overlay = {
        on() {
            return () => {};
        },
        close() {},
    };

    return {
        calls,
        overlay,
        addOverlay(view, options) {
            calls.push({ view, options });
            return overlay;
        },
    };
}

/** A collection manager whose active collection exposes one documented function graph. */
function createFunctionGraphCollectionManager() {
    const functionGraph = {
        getId: () => 'fn-1',
        getName: () => 'Scale Values',
        getExecutionType: () => 'function',
        getEnabled: () => true,
        getFunctionCategory: () => 'math',
        getFunctionSignature: () => ({
            category: 'math',
            description: 'does *math*',
            inputs: [{ name: 'pin', types: ['int'], documentation: 'reads **pin**' }],
            outputs: [{ name: 'result', types: ['float'] }],
        }),
    };
    // The graph being edited never lists itself, so the active graph is a different graph.
    const activeGraph = {
        getId: () => 'caller-1',
        getExecutionType: () => 'continuous',
    };
    const collection = {
        getActiveGraph: () => activeGraph,
        getGraphArray: () => [functionGraph],
        on: () => () => {},
    };

    return {
        getActiveCollection: () => collection,
        on: () => () => {},
    };
}

/**
 * Count rendered palette cards that belong to real node types.
 *
 * The Organizational section adds one graph-item entry (a documentation area), which is not a node
 * type: node-type assertions must ignore it.
 * @param {HTMLElement} root - Palette container.
 * @returns {number} Rendered node-type cards.
 */
function countNodeTypeCards(root) {
    return Array.from(root.querySelectorAll('.node-type-ui')).filter(
        (card) => card.getAttribute('data-graph-item') !== 'true'
    ).length;
}

describe('NodePaletteView behavior migration', () => {
    let harness;
    let container;

    beforeEach(() => {
        harness = createDomHarness();

        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        harness.cleanup();
    });

    it('requires runtime and workspace dependencies', () => {
        const workspaceConfig = createWorkspaceConfig();

        assert.throws(() => new NodePaletteView({ workspaceConfig }), /requires deviceRuntime/);

        assert.throws(
            () => new NodePaletteView({ deviceRuntime: createRuntime() }),
            /requires workspaceConfig/
        );
    });

    it('renders node cards and supports debounced search filtering', async () => {
        const view = new NodePaletteView({
            deviceRuntime: createRuntime(),
            workspaceConfig: createWorkspaceConfig(),
            i18nService: createI18nService(),
        });

        view.attachTo(container);

        assert.equal(countNodeTypeCards(container), 3);

        const search = container.querySelector('.node-palette-view__search-input');
        assert.ok(search);

        search.value = 'console';
        search.dispatchEvent(new harness.window.Event('input', { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 220));

        assert.equal(countNodeTypeCards(container), 1);
        view.detach();
    });

    it('switches organization modes via toolbar and groups by package/category', () => {
        const workspaceConfig = createWorkspaceConfig();
        const view = new NodePaletteView({
            deviceRuntime: createRuntime(),
            workspaceConfig,
            i18nService: createI18nService(),
        });

        view.attachTo(container);

        const packageButton = container.querySelector(
            '.node-palette-view__org-button[data-mode="package"]'
        );
        const categoryButton = container.querySelector(
            '.node-palette-view__org-button[data-mode="category"]'
        );

        assert.ok(packageButton);
        assert.ok(categoryButton);

        packageButton.click();
        const packageGroups = container.querySelectorAll('.collapsible-section');
        // Two node packages: the Organizational graph items are pinned above them, not grouped.
        assert.equal(packageGroups.length, 2);
        assert.equal(workspaceConfig.nodePalette.organizationMode, 'package');

        categoryButton.click();
        const categoryGroups = container.querySelectorAll('.collapsible-section');
        // Three node categories, again without an Organizational node group.
        assert.equal(categoryGroups.length, 3);
        assert.equal(workspaceConfig.nodePalette.organizationMode, 'category');

        view.detach();
    });

    it('defaults to grouping by category when no organization mode is stored', () => {
        const view = new NodePaletteView({
            deviceRuntime: createRuntime(),
            workspaceConfig: {},
            i18nService: createI18nService(),
        });

        view.attachTo(container);

        const categoryButton = container.querySelector(
            '.node-palette-view__org-button[data-mode="category"]'
        );
        const alphabeticalButton = container.querySelector(
            '.node-palette-view__org-button[data-mode="alphabetical"]'
        );

        assert.ok(categoryButton);
        assert.ok(alphabeticalButton);
        assert.equal(categoryButton.classList.contains('is-active'), true);
        assert.equal(alphabeticalButton.classList.contains('is-active'), false);

        // Grouped rendering replaces the flat grid container with the section list.
        assert.ok(container.querySelector('.node-palette-view__sections'));
        assert.equal(container.querySelector('.node-palette-view__grid'), null);

        const groupNames = Array.from(
            container.querySelectorAll('.collapsible-section__name')
        ).map((element) => element.textContent);
        assert.deepEqual(groupNames, ['basic', 'calculation', 'debug']);
        assert.equal(countNodeTypeCards(container), 3);

        view.detach();
    });

    it('honors a stored organization mode instead of the category default', () => {
        const view = new NodePaletteView({
            deviceRuntime: createRuntime(),
            workspaceConfig: createWorkspaceConfig({ organizationMode: 'alphabetical' }),
            i18nService: createI18nService(),
        });

        view.attachTo(container);

        const grid = container.querySelector('.node-palette-view__grid');
        const alphabeticalButton = container.querySelector(
            '.node-palette-view__org-button[data-mode="alphabetical"]'
        );

        assert.ok(grid);
        assert.ok(alphabeticalButton);
        assert.equal(alphabeticalButton.classList.contains('is-active'), true);
        assert.equal(container.querySelectorAll('.collapsible-section').length, 0);
        assert.equal(countNodeTypeCards(container), 3);

        view.detach();
    });

    it('toggles view size and persists the selected size', () => {
        const workspaceConfig = createWorkspaceConfig({ viewSize: 'small' });
        const view = new NodePaletteView({
            deviceRuntime: createRuntime(),
            workspaceConfig,
            i18nService: createI18nService(),
        });

        view.attachTo(container);

        const sizeButton = container.querySelector('.node-palette-view__size-toggle');
        const grid = container.querySelector('.node-palette-view__grid');

        assert.ok(sizeButton);
        assert.ok(grid);
        assert.equal(grid.dataset.viewSize, 'small');
        assert.equal(container.querySelectorAll('.node-type-ui__info-indicator').length, 0);

        sizeButton.click();
        const gridAfterToggle = container.querySelector('.node-palette-view__grid');

        assert.ok(gridAfterToggle);
        assert.equal(gridAfterToggle.dataset.viewSize, 'large');
        assert.equal(workspaceConfig.nodePalette.viewSize, 'large');

        const nodeCards = Array.from(container.querySelectorAll('.node-type-ui')).filter(
            (card) => card.getAttribute('data-graph-item') !== 'true'
        );
        assert.equal(nodeCards.length, 3);
        const infoIndicators = nodeCards.flatMap((card) =>
            Array.from(card.querySelectorAll('.node-type-ui__info-indicator'))
        );
        assert.equal(infoIndicators.length, nodeCards.length);
        for (const card of nodeCards) {
            assert.ok(card.classList.contains('node-type-ui--large'));
            assert.equal(card.style.width, '');
            const infoIndicator = card.querySelector('.node-type-ui__info-indicator');
            assert.ok(infoIndicator);
            const infoIcon = infoIndicator.querySelector('.node-type-ui__info-icon');
            assert.ok(infoIcon);
            if (infoIcon instanceof harness.window.HTMLImageElement) {
                assert.equal(infoIcon.getAttribute('src'), IconProvider.get('info'));
            }
        }

        const expectedTooltipByNodeName = new Map([
            ['Constant', 'Emits constant value'],
            ['Print', 'Print to console output'],
            ['Math', 'No description available.'],
        ]);

        for (const card of nodeCards) {
            const name = card.querySelector('.node-type-ui__name')?.textContent || '';
            const infoIndicator = card.querySelector('.node-type-ui__info-indicator');

            assert.ok(expectedTooltipByNodeName.has(name));
            assert.ok(infoIndicator);
            assert.equal(
                infoIndicator.getAttribute('data-tooltip'),
                expectedTooltipByNodeName.get(name)
            );
        }

        view.detach();
    });

    it('shows the node name as a tooltip when hovering a node card', async () => {
        const view = new NodePaletteView({
            deviceRuntime: createRuntime(),
            workspaceConfig: createWorkspaceConfig(),
            i18nService: createI18nService(),
        });

        view.attachTo(container);

        // The Organizational section is rendered first, so pick the first real node card.
        const card = Array.from(container.querySelectorAll('.node-type-ui')).find(
            (candidate) => candidate.getAttribute('data-graph-item') !== 'true'
        );
        assert.ok(card);
        card.dispatchEvent(new harness.window.MouseEvent('mouseover', { bubbles: true }));

        await new Promise((resolve) => setTimeout(resolve, 220));

        const tooltip = document.querySelector('.node-type-ui__info-tooltip');
        assert.ok(tooltip);
        assert.equal(tooltip.textContent, 'Constant');

        view.detach();
    });

    it('opens the node info window when a node card is clicked', () => {
        const viewManager = createViewManagerMock();
        const view = new NodePaletteView({
            deviceRuntime: createRuntime(),
            workspaceConfig: createWorkspaceConfig(),
            i18nService: createI18nService(),
            viewManager,
        });

        view.attachTo(container);

        const nodeCard = Array.from(container.querySelectorAll('.node-type-ui')).find(
            (candidate) => candidate.getAttribute('data-graph-item') !== 'true'
        );
        assert.ok(nodeCard);
        nodeCard.dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));

        assert.equal(viewManager.calls.length, 1);
        const { view: infoView, options } = viewManager.calls[0];

        assert.ok(infoView);
        assert.equal(infoView.nodeName, 'Constant');
        assert.equal(infoView.info, 'Emits constant value');
        assert.equal(options.closeOnOutsideClick, true);
        assert.equal(options.closable, true);

        view.detach();
    });

    it('shows the description and port documentation for a function node', () => {
        const viewManager = createViewManagerMock();
        const view = new NodePaletteView({
            deviceRuntime: createRuntime(),
            workspaceConfig: createWorkspaceConfig({ viewSize: 'large' }),
            i18nService: createI18nService(),
            viewManager,
            collectionManager: createFunctionGraphCollectionManager(),
        });

        view.attachTo(container);

        const nodeCard = Array.from(container.querySelectorAll('.node-type-ui')).find(
            (candidate) =>
                candidate.getAttribute('data-graph-item') !== 'true' &&
                candidate.textContent.includes('Scale Values')
        );
        assert.ok(nodeCard, 'the function node card is rendered');
        nodeCard.dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));

        assert.equal(viewManager.calls.length, 1);
        const { view: infoView } = viewManager.calls[0];

        assert.equal(infoView.nodeName, 'Scale Values');
        assert.equal(infoView.info, 'does *math*');
        assert.equal(infoView.inputs[0].description, 'reads **pin**');

        view.detach();
    });

    it('keeps large-card CSS responsive in narrow containers without inline width overrides', () => {
        const paletteCss = readFileSync(
            new URL(
                '../../src/micro_otter/nodes/html/styles/standard/node-palette-view.css',
                import.meta.url
            ),
            'utf8'
        );
        const nodeTypeCss = readFileSync(
            new URL(
                '../../src/micro_otter/nodes/html/styles/standard/node-type-ui.css',
                import.meta.url
            ),
            'utf8'
        );

        assert.match(
            paletteCss,
            /\.node-palette-view__grid\[data-view-size="large"\]\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\);/
        );
        assert.match(
            paletteCss,
            /\.collapsible-section__grid\[data-view-size="large"\]\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\);/
        );
        assert.match(
            paletteCss,
            /@container\s*\(min-width:\s*360px\)\s*\{[\s\S]*?\.node-palette-view__grid\[data-view-size="large"\][\s\S]*?repeat\(2,\s*minmax\(0,\s*1fr\)\)/
        );
        assert.match(
            nodeTypeCss,
            /\.node-type-ui--large\s*\{[\s\S]*?width:\s*min\(100%,\s*var\(--mo-node-palette-large-card-width,\s*168px\)\);/
        );
        assert.match(nodeTypeCss, /\.node-type-ui--large\s*\{[\s\S]*?min-width:\s*0;/);
        assert.match(
            nodeTypeCss,
            /\.node-type-ui__info-indicator\s*\{[\s\S]*?pointer-events:\s*auto;/
        );
    });

    it('caps small palette tiles so wider panels add columns instead of bigger icons', () => {
        const paletteCss = readFileSync(
            new URL(
                '../../src/micro_otter/nodes/html/styles/standard/node-palette-view.css',
                import.meta.url
            ),
            'utf8'
        );

        const minTileMatch = paletteCss.match(
            /--mo-node-palette-small-card-min-width:\s*(\d+)px;/
        );
        const maxTileMatch = paletteCss.match(
            /--mo-node-palette-small-card-max-width:\s*(\d+)px;/
        );

        assert.ok(minTileMatch, 'small tile min width must be a px value');
        assert.ok(maxTileMatch, 'small tile max width must be a px value');
        assert.equal(minTileMatch[1], '32');
        assert.equal(maxTileMatch[1], '36');
        assert.match(
            paletteCss,
            /--mo-node-palette-small-card-width:\s*clamp\([\s\S]*?var\(--mo-node-palette-small-card-min-width\)[\s\S]*?calc\(20%\s*-\s*6\.4px\)[\s\S]*?var\(--mo-node-palette-small-card-max-width\)[\s\S]*?\);/
        );

        const smallTileSelectors = [
            '.node-palette-view__section-grid',
            '.node-palette-view__grid[data-view-size="small"]',
            '.collapsible-section__grid[data-view-size="small"]',
        ];

        for (const selector of smallTileSelectors) {
            const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            assert.match(
                paletteCss,
                new RegExp(
                    `${escapedSelector}\\s*>\\s*\\*\\s*\\{[\\s\\S]*?width:\\s*var\\(--mo-node-palette-small-card-width\\);`
                ),
                `${selector} must use the shared clamped tile width`
            );
        }

        // A percentage flex basis would force exactly five tiles per row and let the
        // tiles grow without bound while the panel widens.
        assert.doesNotMatch(paletteCss, /flex:\s*0\s+0\s+calc\(20%\s*-\s*6\.4px\)/);
        assert.doesNotMatch(paletteCss, /^ {4}width:\s*44px;$/m);

        // The icon itself must not scale either: the small card keeps the 24px glyph.
        const nodeTypeCss = readFileSync(
            new URL(
                '../../src/micro_otter/nodes/html/styles/standard/node-type-ui.css',
                import.meta.url
            ),
            'utf8'
        );

        assert.match(
            nodeTypeCss,
            /\.node-type-ui--small \.node-type-ui__icon\s*\{[\s\S]*?max-width:\s*24px;[\s\S]*?max-height:\s*24px;/
        );

        // The cap has to buy columns: at the widest pane the palette can occupy (grid
        // gap 8px, 8px padding on each side) as well as at a typical 300px pane more
        // than five tiles must fit per row - that is the whole point of the cap.
        const view = new NodePaletteView({
            deviceRuntime: createRuntime(),
            workspaceConfig: createWorkspaceConfig(),
            i18nService: createI18nService(),
        });
        const gridGap = 8;
        const tileWidth = Number(maxTileMatch[1]);
        const columnsForPane = (paneWidth, chrome) =>
            Math.floor((paneWidth - chrome + gridGap) / (tileWidth + gridGap));

        const maxPaneColumns = columnsForPane(Number(view.maxWidth), 16);
        const typicalPaneColumns = columnsForPane(300, 24); // 8px padding + 8px scrollbar

        assert.ok(
            maxPaneColumns > 5,
            `max tile width ${tileWidth}px fits only ${maxPaneColumns} columns in ${view.maxWidth}px`
        );
        assert.ok(
            typicalPaneColumns > 5,
            `max tile width ${tileWidth}px fits only ${typicalPaneColumns} columns in a 300px pane`
        );
    });

    it('updates favorites and recently used sections through public methods', () => {
        const workspaceConfig = createWorkspaceConfig();
        const view = new NodePaletteView({
            deviceRuntime: createRuntime(),
            workspaceConfig,
            i18nService: createI18nService(),
        });

        view.attachTo(container);

        const favoritesSection = container.querySelector('.node-palette-view__favorites');
        const recentSection = container.querySelector('.node-palette-view__recent');

        assert.ok(favoritesSection);
        assert.ok(recentSection);
        assert.equal(favoritesSection.style.display, 'none');
        assert.equal(recentSection.style.display, 'none');

        view.toggleFavorite('const');
        view.onNodeTypeUsed('math');

        assert.deepEqual(workspaceConfig.nodePalette.favorites, ['const']);
        assert.deepEqual(workspaceConfig.nodePalette.recentlyUsed, ['math']);
        assert.equal(favoritesSection.style.display, 'block');
        assert.equal(recentSection.style.display, 'block');

        view.detach();
    });

    it('serializes and deserializes with dependencies from context', () => {
        const runtime = createRuntime();
        const workspaceConfig = createWorkspaceConfig();

        const original = new NodePaletteView({
            id: 'palette-test',
            deviceRuntime: runtime,
            workspaceConfig,
            i18nService: createI18nService(),
        });

        const data = original.serialize();
        const restored = NodePaletteView.deserialize(data, null, {
            deviceRuntime: runtime,
            workspaceConfig,
            i18nService: createI18nService(),
        });

        assert.equal(data.type, 'NodePaletteView');
        assert.equal(restored.id, 'palette-test');
        assert.equal(restored.title, 'Node Palette');
    });
});
