// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { FirmwareBuildView } from '../../../src/micro_otter/nodes/html/js/views/firmware-build-view.js';
import {
    BOARD_CATALOG,
    createFakeClient,
    createOptions,
    createRuntime,
    createStore,
    readySnapshot,
    setupDom,
    teardownDom,
    tick,
} from './fixtures.js';

function buttonByText(root, text) {
    return [...root.querySelectorAll('button')].find(
        (button) => button.textContent === text || button.title === text
    );
}

describe('FirmwareBuildView content views', () => {
    let dom;
    let container;

    beforeEach(() => {
        ({ dom, container } = setupDom());
        global.fetch = async (url) => {
            if (String(url).includes('/api/serial-ports')) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => [{ device: '/dev/ttyUSB0', label: 'USB0' }],
                };
            }
            return { ok: true, status: 200, json: async () => BOARD_CATALOG };
        };
    });

    afterEach(() => {
        teardownDom({ dom, container });
    });

    async function mount(options) {
        const view = new FirmwareBuildView(options);
        view.attachTo(container);
        await tick();
        await tick();
        options.jobClient?.emitFrame({
            type: 'result',
            job: 'list',
            status: 'succeeded',
            payload: { entries: [] },
        });
        if (options.jobClient) {
            options.jobClient.sent.length = 0;
        }
        return view;
    }

    describe('target info table', () => {
        it('renders board/port/chip/offset rows', async () => {
            const view = await mount(createOptions({ store: createStore(readySnapshot()), runtime: createRuntime() }));
            const info = container.querySelector('.firmware-build-view__info');
            const table = info.querySelector('.data-table-view');
            assert.ok(table);
            assert.ok(info.textContent.includes('ESP32 Dev Module'));
            assert.ok(info.textContent.includes('esp32'));
            assert.ok(info.textContent.includes('0x0'));
            assert.ok(info.textContent.includes('firmwareBuild.target.flashOffset'));
            view.detach();
        });

        it('renders noMapping when the target has no compile mapping', async () => {
            const view = await mount(
                createOptions({ store: createStore(readySnapshot()), runtime: createRuntime({ getCompileTarget: () => null }) })
            );
            const info = container.querySelector('.firmware-build-view__info');
            assert.ok(info.textContent.includes('firmwareBuild.target.noMapping'));
            view.detach();
        });

        it('renders noRuntime when no runtime is active', async () => {
            const view = await mount(createOptions({ store: createStore(readySnapshot()), runtime: null }));
            const info = container.querySelector('.firmware-build-view__info');
            assert.ok(info.textContent.includes('firmwareBuild.target.noRuntime'));
            view.detach();
        });
    });

    describe('job log', () => {
        it('renders stdout verbatim and marks stderr lines in the build log', async () => {
            const client = createFakeClient();
            const view = await mount(
                createOptions({ store: createStore(readySnapshot()), runtime: createRuntime(), client })
            );

            buttonByText(container, 'firmwareBuild.build.start').click();
            await tick();
            client.emitFrame({ type: 'output', job: 'compile', stream: 'stdout', text: 'hello\n' });
            client.emitFrame({ type: 'output', job: 'compile', stream: 'stderr', text: 'oops\n' });

            const log = container.querySelector('.firmware-build-view__build-log');
            assert.ok(log.querySelector('.view-code'));
            assert.ok(log.querySelector('.view-code code'));
            assert.ok(log.textContent.includes('hello'));
            assert.ok(log.textContent.includes('[stderr] oops'));
            assert.equal(log.hidden, false);
            view.detach();
        });

        it('keeps the build log hidden while there is no output', async () => {
            await mount(createOptions({ store: createStore(readySnapshot()), runtime: createRuntime() }));
            assert.equal(container.querySelector('.firmware-build-view__build-log').hidden, true);
        });
    });


    describe('outcome summary lines', () => {
        it('prints a succeeded build summary as info lines in the build log', async () => {
            const client = createFakeClient();
            const view = await mount(
                createOptions({ store: createStore(readySnapshot()), runtime: createRuntime(), client })
            );

            buttonByText(container, 'firmwareBuild.build.start').click();
            await tick();
            client.emitFrame({
                type: 'result',
                job: 'compile',
                status: 'succeeded',
                payload: {
                    paths: { firmwarePublishedArtifact: '/x/y.bin' },
                    metadata: { firmwarePublishStatus: 'published', firmwareArtifactSizeBytes: 2048 },
                    runtime: { version: '1.11.0' },
                },
            });

            const log = container.querySelector('.firmware-build-view__build-log');
            assert.ok(log.textContent.includes('info: firmwareBuild.build.artifact: /x/y.bin'));
            assert.ok(log.textContent.includes('info: firmwareBuild.build.publishStatus: published'));
            assert.ok(log.textContent.includes('info: firmwareBuild.build.runtimeVersion: 1.11.0'));
            assert.ok(log.textContent.includes('info: firmwareBuild.build.artifactSize: 2 KiB'));
            view.detach();
        });

        it('prints one Packages line naming the frozen variants', async () => {
            const client = createFakeClient();
            const view = await mount(
                createOptions({ store: createStore(readySnapshot()), runtime: createRuntime(), client })
            );

            buttonByText(container, 'firmwareBuild.build.start').click();
            await tick();
            client.emitFrame({
                type: 'result',
                job: 'compile',
                status: 'succeeded',
                payload: {
                    metadata: {
                        packageVariants: { pulse: 'viper', hello: 'py' },
                    },
                },
            });

            const log = container.querySelector('.firmware-build-view__build-log');
            const lines = log.textContent
                .split('\n')
                .filter((line) => line.startsWith('info: firmwareBuild.build.packages'));
            assert.deepEqual(lines, [
                'info: firmwareBuild.build.packages: pulse@viper, hello@py',
            ]);
            view.detach();
        });

        it('prints no Packages line when the payload records no variant', async () => {
            const client = createFakeClient();
            const view = await mount(
                createOptions({ store: createStore(readySnapshot()), runtime: createRuntime(), client })
            );

            buttonByText(container, 'firmwareBuild.build.start').click();
            await tick();
            client.emitFrame({
                type: 'result',
                job: 'compile',
                status: 'succeeded',
                payload: { metadata: { packageVariants: {} } },
            });

            const log = container.querySelector('.firmware-build-view__build-log');
            assert.ok(!log.textContent.includes('firmwareBuild.build.packages'));
            view.detach();
        });

        it('labels an unpublished artifact in the build log', async () => {
            const client = createFakeClient();
            const view = await mount(
                createOptions({ store: createStore(readySnapshot()), runtime: createRuntime(), client })
            );

            buttonByText(container, 'firmwareBuild.build.start').click();
            await tick();
            client.emitFrame({
                type: 'result',
                job: 'compile',
                status: 'succeeded',
                payload: { paths: { firmwareArtifact: '/x/y.bin' } },
            });

            const log = container.querySelector('.firmware-build-view__build-log');
            assert.ok(log.textContent.includes('firmwareBuild.build.artifactUnpublished'));
            view.detach();
        });

        it('prints failed-result error rows with their hint in the build log', async () => {
            const client = createFakeClient();
            const view = await mount(
                createOptions({ store: createStore(readySnapshot()), runtime: createRuntime(), client })
            );

            buttonByText(container, 'firmwareBuild.build.start').click();
            await tick();
            client.emitFrame({
                type: 'result',
                job: 'compile',
                status: 'failed',
                payload: { errors: [{ code: 'flash-tool-missing', message: 'x', hint: 'install esptool' }] },
            });

            const log = container.querySelector('.firmware-build-view__build-log');
            assert.ok(log.textContent.includes('firmwareBuild.errors.flash-tool-missing'));
            assert.ok(log.textContent.includes('install esptool'));
            view.detach();
        });

        it('prints an error frame in the build log', async () => {
            const client = createFakeClient();
            const view = await mount(
                createOptions({ store: createStore(readySnapshot()), runtime: createRuntime(), client })
            );

            buttonByText(container, 'firmwareBuild.build.start').click();
            await tick();
            client.emitFrame({ type: 'error', code: 'build-timeout', message: 'x', hint: 'raise budget' });

            const log = container.querySelector('.firmware-build-view__build-log');
            assert.ok(log.textContent.includes('firmwareBuild.errors.build-timeout'));
            assert.ok(log.textContent.includes('raise budget'));
            view.detach();
        });


        it('prints a deploy summary as info lines in the deploy log', async () => {
            const client = createFakeClient();
            const view = await mount(
                createOptions({ store: createStore(readySnapshot()), runtime: createRuntime(), client })
            );

            document.body
                .querySelector(
                    '.firmware-build-view__dropdown-menu--port .dropdown-control__option[data-value="/dev/ttyUSB0"]'
                )
                .click();
            buttonByText(container, 'firmwareBuild.deploy.start').click();
            await tick();
            client.emitFrame({
                type: 'result',
                job: 'deploy',
                status: 'succeeded',
                payload: {
                    firmware: { path: '/f.bin', sizeBytes: 1024, sha256: 'a'.repeat(64) },
                    board: { id: 'wroom_32', chip: 'ESP32' },
                    port: '/dev/ttyUSB0',
                },
            });

            const log = container.querySelector('.firmware-build-view__deploy-log');
            assert.ok(log.textContent.includes('info: firmwareBuild.deploy.summaryImage: /f.bin'));
            assert.ok(log.textContent.includes('info: firmwareBuild.deploy.summarySize: 1 KiB'));
            assert.ok(log.textContent.includes('info: firmwareBuild.deploy.summaryBoard: wroom_32'));
            view.detach();
        });

        it('prints scan warnings in the build log', async () => {
            const client = createFakeClient();
            const view = await mount(
                createOptions({ store: createStore(readySnapshot()), runtime: createRuntime(), client })
            );

            buttonByText(container, 'firmwareBuild.packages.refresh').click();
            await tick();
            client.emitFrame({
                type: 'result',
                job: 'scan',
                status: 'succeeded',
                payload: { warnings: ['folder a is missing a manifest'] },
            });

            const log = container.querySelector('.firmware-build-view__build-log');
            assert.ok(log.textContent.includes('warning: folder a is missing a manifest'));
            view.detach();
        });
    });

});
