// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { fileURLToPath } from 'url';
import { dirname, relative, resolve } from 'path';
import fs from 'fs';
import { createDeviceDataProxy } from './tools/vite-device-backend.mjs';
import { readProjectVersion } from './tools/project-version.mjs';
import { hostedCspPlugin } from './tools/vite-hosted-csp.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEVICE_NODE_PKGS_DIR = resolve(__dirname, 'src/micro_otter/nodes/device/node_pkgs');
const TRANSPILE_DEBUG_DUMP_ROUTE = '/__debug/transpile-dump';
const TRANSPILE_DEBUG_DUMP_ROOT = resolve(__dirname, 'ldev/debug-dumps');
const MAX_DEBUG_DUMP_BYTES = 10 * 1024 * 1024;

function toPosixPath(value) {
    return String(value || '').replace(/\\/g, '/');
}

function createSlug(value, fallback = 'unknown') {
    const normalized = String(value || '')
        .trim()
        .replace(/[^a-zA-Z0-9._-]+/g, '-')
        .replace(/^-+/, '')
        .replace(/-+$/, '');
    return normalized || fallback;
}

function createDumpId(payload) {
    const nowIso = new Date().toISOString();
    const timestamp = nowIso
        .replace(/[:.]/g, '-')
        .replace('T', '_')
        .replace('Z', '');
    const collectionId = createSlug(payload?.collection?.id, 'collection');
    return `${timestamp}_${collectionId}`;
}

function sanitizeArtifactPath(targetPath) {
    const normalized = toPosixPath(targetPath).trim().replace(/^\/+/, '');
    if (!normalized) {
        throw new Error('Artifact targetPath is required');
    }

    if (!(normalized.startsWith('app/') || normalized.startsWith('collection/'))) {
        throw new Error(`Artifact path '${normalized}' must be under app/ or collection/`);
    }

    const segments = normalized.split('/').filter(Boolean);
    if (segments.some((segment) => segment === '.' || segment === '..')) {
        throw new Error(`Artifact path '${normalized}' contains invalid traversal segments`);
    }

    return segments.join('/');
}

function isPathInside(basePath, candidatePath) {
    const rel = relative(basePath, candidatePath);
    if (!rel) {
        return true;
    }
    return !rel.startsWith('..') && !rel.includes('..\\') && !rel.includes('../');
}

/**
 * True when this `vite build` produces a hosted bundle (`mo webapp build` sets it).
 *
 * The single source of the flag: `define` and the CSP plugin both read this const, so a build
 * can never ship the hosted globals with the local CSP policy or the other way round.
 */
const hosted = process.env.MICRO_OTTER_HOSTED === '1';

/** Output directory of `npm run build`: the wheel payload a local install serves. */
const LOCAL_OUT_DIR = '_dist/webapp';

/** Output directory of a hosted build when `--out` / `MICRO_OTTER_WEBAPP_OUT` is not given. */
const HOSTED_OUT_DIR = '_dist/webapp-hosted';

/**
 * Resolve the build output directory from the environment.
 *
 * Relative values are taken relative to the repository root — the directory a caller types paths
 * against — and returned absolute, so the guard below and Vite agree on the target. Vite would
 * otherwise resolve `outDir` against its own root (`src/micro_otter/nodes`) and write
 * `MICRO_OTTER_WEBAPP_OUT=_dist/webapp` somewhere else entirely.
 *
 * @returns {string} Absolute `build.outDir`.
 */
function resolveOutDir() {
    const requested = (process.env.MICRO_OTTER_WEBAPP_OUT ?? '').trim();
    return resolve(__dirname, requested || (hosted ? HOSTED_OUT_DIR : LOCAL_OUT_DIR));
}

/**
 * The wheel payload directory a hosted build must never touch.
 *
 * @returns {string} Absolute path of `_dist/webapp`.
 */
function wheelPayloadDir() {
    return resolve(__dirname, LOCAL_OUT_DIR);
}

/**
 * Refuse a hosted build that would overwrite the wheel payload.
 *
 * `_dist/webapp` is packed into the wheel and checked by `tools/inspect_wheel.py`; a hosted bundle
 * there would ship `webapp-build.json` and the `/firmware` page inside every install. Called with
 * the final, Vite-resolved `build.outDir`, so `--outDir` cannot slip past the config value either.
 *
 * @param {string} outDir - Absolute output directory Vite is about to write.
 * @throws {Error} When a hosted build targets `_dist/webapp` or a path inside it.
 */
function assertOutDirIsSafe(outDir) {
    if (!hosted) {
        return;
    }
    if (isPathInside(wheelPayloadDir(), outDir)) {
        throw new Error(
            'Refusing to write a hosted build into _dist/webapp (the wheel payload); ' +
                'pass MICRO_OTTER_WEBAPP_OUT'
        );
    }
}

/**
 * Guard the hosted output directory at the last moment before Vite writes.
 *
 * `configResolved` receives the merged build config, so the check sees the value from
 * `MICRO_OTTER_WEBAPP_OUT` and the one from `vite build --outDir` alike.
 *
 * @returns {import('vite').Plugin} A build-only plugin that fails the build on an unsafe target.
 */
function hostedOutDirGuardPlugin() {
    return {
        name: 'micro-otter-hosted-out-dir-guard',
        apply: 'build',
        configResolved(config) {
            assertOutDirIsSafe(resolve(config.root, config.build.outDir));
        },
    };
}

function decodeArtifactContent(encoded) {
    const kind = encoded?.kind;
    const value = encoded?.value;

    if (kind === 'text') {
        return Buffer.from(String(value ?? ''), 'utf8');
    }

    if (kind === 'base64') {
        return Buffer.from(String(value ?? ''), 'base64');
    }

    throw new Error(`Unsupported artifact content encoding kind '${String(kind)}'`);
}

function readJsonRequestBody(req) {
    return new Promise((resolveBody, rejectBody) => {
        let totalBytes = 0;
        const chunks = [];

        req.on('data', (chunk) => {
            const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            totalBytes += bufferChunk.length;

            if (totalBytes > MAX_DEBUG_DUMP_BYTES) {
                rejectBody(new Error('Debug dump payload exceeds maximum size limit'));
                req.destroy();
                return;
            }

            chunks.push(bufferChunk);
        });

        req.on('end', () => {
            try {
                const rawBody = Buffer.concat(chunks).toString('utf8');
                resolveBody(rawBody ? JSON.parse(rawBody) : {});
            } catch (error) {
                rejectBody(error);
            }
        });

        req.on('error', (error) => rejectBody(error));
    });
}

function sendJson(res, statusCode, payload) {
    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(payload));
}

function writeTranspileDebugDump(payload) {
    if (payload?.schemaVersion !== 'transpile-debug-dump/v1') {
        throw new Error('Unsupported debug dump payload schemaVersion');
    }

    const dumpId = createDumpId(payload);
    const dumpRoot = resolve(TRANSPILE_DEBUG_DUMP_ROOT, dumpId);
    const filesRoot = resolve(dumpRoot, 'files');
    fs.mkdirSync(filesRoot, { recursive: true });

    const transpileCode = typeof payload?.transpile?.code === 'string' ? payload.transpile.code : '';
    const codePath = resolve(filesRoot, 'app/main_loop.py');
    fs.mkdirSync(dirname(codePath), { recursive: true });
    fs.writeFileSync(codePath, transpileCode, 'utf8');

    const artifacts = Array.isArray(payload?.transpile?.generatedArtifacts)
        ? payload.transpile.generatedArtifacts
        : [];

    const artifactSummaries = [];
    let artifactCount = 0;
    for (const artifact of artifacts) {
        const safeTargetPath = sanitizeArtifactPath(artifact?.targetPath);
        const destination = resolve(filesRoot, safeTargetPath);

        if (!isPathInside(filesRoot, destination)) {
            throw new Error(`Resolved path escapes dump root: ${safeTargetPath}`);
        }

        fs.mkdirSync(dirname(destination), { recursive: true });
        fs.writeFileSync(destination, decodeArtifactContent(artifact?.content));
        artifactCount += 1;
        artifactSummaries.push({
            targetPath: safeTargetPath,
            contentType: String(artifact?.contentType || 'application/octet-stream'),
            contentEncoding: String(artifact?.contentEncoding || 'identity'),
            role: String(artifact?.role || 'generated-artifact'),
        });
    }

    const metadata = {
        schemaVersion: 'transpile-debug-dump-record/v1',
        dumpId,
        createdAtIso: new Date().toISOString(),
        collection: payload?.collection || null,
        sourcePayloadSchemaVersion: payload?.schemaVersion || null,
        transpile: {
            codePath: 'files/app/main_loop.py',
            generatedArtifactCount: artifactCount,
            generatedArtifacts: artifactSummaries,
            helperHandoffSummary: payload?.transpile?.helperHandoffSummary || null,
        },
    };
    fs.writeFileSync(resolve(dumpRoot, 'dump-metadata.json'), JSON.stringify(metadata, null, 2), 'utf8');

    return {
        dumpId,
        dumpDirectory: toPosixPath(relative(__dirname, dumpRoot)),
        filesWritten: artifactCount + 2,
        artifactsWritten: artifactCount,
    };
}

function transpileDebugDumpPlugin() {
    return {
        name: 'micro-otter-transpile-debug-dump',
        apply: 'serve',
        configureServer(server) {
            server.middlewares.use(async (req, res, next) => {
                const requestPath = String(req.url || '').split('?')[0];
                if (req.method !== 'POST' || requestPath !== TRANSPILE_DEBUG_DUMP_ROUTE) {
                    next();
                    return;
                }

                try {
                    const payload = await readJsonRequestBody(req);
                    const result = writeTranspileDebugDump(payload);
                    sendJson(res, 200, {
                        success: true,
                        ...result,
                    });
                } catch (error) {
                    sendJson(res, 400, {
                        success: false,
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
            });
        },
    };
}

/**
 * Write `html/version.json` into the production bundle.
 *
 * The file used to be a committed source asset copied by `vite-plugin-static-copy`. It is a build
 * output now (nothing version-related is tracked), so there is no source file left to copy; the
 * bundle is its only static host and `/api/version` covers the dev server. See
 * `readProjectVersion` in `tools/project-version.mjs` for the version's producer.
 *
 * @param {string} version - Version hatch-vcs stamped at install/build time.
 * @returns {import('vite').Plugin} A build-only plugin that runs after the bundle is written.
 */
function webappVersionFilePlugin(version) {
    let root = null;
    let outDir = null;

    return {
        name: 'micro-otter-version-stamp',
        apply: 'build',
        configResolved(config) {
            // Vite 7 hands these over unresolved: `outDir` stays relative to `root`.
            root = config.root;
            outDir = config.build.outDir;
        },
        closeBundle() {
            const versionFile = resolve(root, outDir, 'html', 'version.json');
            fs.mkdirSync(dirname(versionFile), { recursive: true });
            fs.writeFileSync(versionFile, `${JSON.stringify({ version }, null, 2)}\n`, 'utf-8');
        },
    };
}

const appVersion = readProjectVersion(__dirname);
const buildOutDir = resolveOutDir();
assertOutDirIsSafe(buildOutDir);

export default defineConfig({
    root: 'src/micro_otter/nodes',
    server: {
        proxy: {
            '/serial': {
                target: 'ws://127.0.0.1:8000',
                ws: true,
                changeOrigin: true,
            },
            // Firmware job endpoint: sibling of /serial, same bridge, one job per
            // connection. See docs/dev/firmware-compile/firmware-build-websocket-protocol.md
            '/firmware': {
                target: 'ws://127.0.0.1:8000',
                ws: true,
                changeOrigin: true,
            },
            '/api': {
                target: 'http://127.0.0.1:8000',
                changeOrigin: true,
            },
            // `/device` is answered by Vite from the source tree — `device/capabilities/*.json`
            // needs Vite's JSON→ES-module transform, which a raw `application/json` response
            // would shadow. Only the three request shapes that are not files reach the backend:
            // the merged package index, a runtime manifest, and an installed add-on's assets.
            // See `tools/vite-device-backend.mjs`.
            '/device/': createDeviceDataProxy(DEVICE_NODE_PKGS_DIR),
        },
    },
    
    // Define global constants for build-time optimization
    define: {
        // Set minimum log level based on build mode
        // - 'debug' in development: all logs enabled
        // - 'warn' in production: only warn/error logs (debug/info removed by tree-shaking)
        __MIN_LOG_LEVEL__: JSON.stringify(
            process.env.NODE_ENV === 'production' ? 'warn' : 'debug'
        ),
        'globalThis.__MICRO_OTTER_APP_VERSION__': JSON.stringify(appVersion),
        // Hosted build mode (see `src/micro_otter/nodes/html/js/core/build-mode.ts`).
        // `npm run build` leaves both values `false` / `''`: the local bundle keeps probing the
        // Micro-Otter server. The hosted values arrive from `mo webapp build`, which sets
        // `MICRO_OTTER_HOSTED=1` and optionally `MICRO_OTTER_WEBAPP_DOCS_URL` — never from a
        // hand-typed env, and never from `import.meta.env`.
        'globalThis.__MICRO_OTTER_HOSTED__': JSON.stringify(hosted),
        'globalThis.__MICRO_OTTER_DOCS_URL__': JSON.stringify(
            process.env.MICRO_OTTER_WEBAPP_DOCS_URL ?? ''
        ),
    },
    
    build: {
        // Repo-root build folder, so `npm run build` lands where the local server
        // looks (see `resolve_static_root` in `tools/server_capabilities.py`).
        // `mo webapp build` overrides it with `MICRO_OTTER_WEBAPP_OUT`; `_dist/webapp`
        // is refused for a hosted build (see `assertOutDirIsSafe`).
        outDir: buildOutDir,
        emptyOutDir: true,
        
        // Enable minification with terser for better dead code elimination
        minify: 'terser',
        terserOptions: {
            compress: {
                // Remove unreachable code (debug/info logs in production)
                dead_code: true,
                drop_debugger: true,
            },
        },
        
        rollupOptions: {
            input: {
                main: resolve(__dirname, 'src/micro_otter/nodes/index.html'),
            },
        },
    },
    plugins: [
        // First, so the `<meta http-equiv="Content-Security-Policy">` lands at the start of `<head>`,
        // ahead of the stylesheet links it governs. A no-op unless `MICRO_OTTER_HOSTED=1`.
        hostedCspPlugin({ hosted }),
        // Second, so an unsafe hosted `--outDir` fails before any asset is written.
        hostedOutDirGuardPlugin(),
        transpileDebugDumpPlugin(),
        webappVersionFilePlugin(appVersion),
        // Copy runtime-only static assets into the production build output. Keep only
        // the build-time plugin: `vite-plugin-static-copy` also registers a dev-only
        // middleware that serves these files as raw static assets from disk, before
        // Vite's transform middleware. That shadows Vite's JSON→ES-module transform
        // and breaks the `device/capabilities/*.json` imports in capability-registry.ts.
        // In dev, Vite serves everything from its own root, so that dev middleware is
        // redundant and harmful there.
        //   - `device/` — fetched at runtime (manifests, targets, node packages, …).
        //   - `html/{icons,locales,styles,vendor}` — fetched at runtime (icons, i18n, themes,
        //     vendored marked/prism). `html/version.json` is not copied: nothing provides it on
        //     disk any more, `webappVersionFilePlugin` writes it after the bundle is built.
        ...viteStaticCopy({
            targets: [
                {
                    src: 'device',
                    dest: '.',
                },
                {
                    src: 'html/icons',
                    dest: 'html',
                },
                {
                    src: 'html/locales',
                    dest: 'html',
                },
                {
                    src: 'html/styles',
                    dest: 'html',
                },
                {
                    src: 'html/vendor',
                    dest: 'html',
                },
            ],
        }).filter((plugin) => plugin.apply !== 'serve'),
    ],
});
