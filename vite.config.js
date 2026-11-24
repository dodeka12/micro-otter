// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { fileURLToPath } from 'url';
import { dirname, relative, resolve } from 'path';
import fs from 'fs';
import { createDeviceDataProxy } from './tools/vite-device-backend.mjs';
import { readProjectVersion } from './tools/project-version.mjs';

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
    },
    
    build: {
        // Repo-root build folder, so `npm run build` lands where the local server
        // looks (see `resolve_static_root` in `tools/server_capabilities.py`).
        outDir: '../../../_dist/webapp',
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
