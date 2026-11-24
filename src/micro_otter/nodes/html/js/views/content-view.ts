import { ViewBase } from './view-base.js';

type ViewBaseOptions = ConstructorParameters<typeof ViewBase>[0];

export interface ContentViewOptions {
    renderFn?: () => HTMLElement;
    i18nService?: ViewBaseOptions extends { i18nService?: infer T } ? T : unknown;
    logger?: ViewBaseOptions extends { logger?: infer T } ? T : unknown;
    title?: string;
}

/**
 * ContentView - Simple ViewBase wrapper that renders content via a render function.
 * Used for wrapping HTML content in collapsible panels and other container views.
 */
export class ContentView extends ViewBase {
    private _renderFn: () => HTMLElement;
    private _renderedElement: HTMLElement | null;

    /**
     * @param {object} options
     * @param {Function} options.renderFn - Function that returns an HTMLElement to render
     * @param {object|null} [options.i18nService] - I18n service instance
     * @param {object|null} [options.logger] - Logger instance
     * @param {string} [options.title='Content'] - View title metadata
     */
    constructor({ renderFn, i18nService = null, logger = null, title = 'Content' }: ContentViewOptions = {}) {
        super({
            title,
            i18nService,
            logger,
        });

        if (typeof renderFn !== 'function') {
            throw new Error('ContentView requires a renderFn function');
        }

        this._renderFn = renderFn;
        this._renderedElement = null;
    }

    render(container: HTMLElement): void {
        this._renderedElement = this._renderFn();

        if (!(this._renderedElement instanceof HTMLElement)) {
            throw new Error('ContentView renderFn must return an HTMLElement');
        }

        const wrapper = document.createElement('div');
        wrapper.className = 'content-view-wrapper';
        wrapper.appendChild(this._renderedElement);

        container.replaceChildren(wrapper);
    }

    override beforeDetach(): void {
        this._renderedElement = null;
        super.beforeDetach();
    }
}
