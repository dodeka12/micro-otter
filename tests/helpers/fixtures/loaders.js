import fs from 'node:fs/promises';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');

export function resolveRepoPath(...segments) {
    return path.join(REPO_ROOT, ...segments);
}

export async function loadJsonFixture(...segments) {
    const filePath = resolveRepoPath(...segments);
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content);
}

export function cloneFixture(value) {
    return JSON.parse(JSON.stringify(value));
}
