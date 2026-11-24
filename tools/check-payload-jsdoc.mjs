import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(
    process.env.PAYLOAD_CHECK_ROOT || 'src/micro_otter/nodes/html/js'
);

function collectSourceFiles(directory, output = []) {
    const entries = fs.readdirSync(directory, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            collectSourceFiles(fullPath, output);
            continue;
        }
        if (entry.isFile() && (fullPath.endsWith('.js') || fullPath.endsWith('.ts'))) {
            output.push(fullPath);
        }
    }
    return output;
}

function lineNumberAt(text, index) {
    return text.slice(0, index).split(/\r?\n/).length;
}

function validateFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const findings = [];
    const payloadClassRegex =
        /(\/\*\*[\s\S]*?\*\/)\s*(?:export\s+)?class\s+(\w+Payload)\s+extends\s+AppPayload\s*\{/g;

    for (const match of content.matchAll(payloadClassRegex)) {
        const classDoc = match[1] ?? '';
        const className = match[2] ?? 'UnknownPayload';
        const classIndex = match.index ?? 0;
        const classLine = lineNumberAt(content, classIndex);
        const paramRegex = /@param\s+\{[^}]+\}\s+([^\s*]+)([^\n]*)/g;
        for (const param of classDoc.matchAll(paramRegex)) {
            const paramName = param[1] ?? '(unknown)';
            const trailing = (param[2] ?? '').trim();
            if (!trailing.startsWith('- ')) {
                findings.push({
                    filePath,
                    className,
                    classLine,
                    paramName,
                });
            }
        }
    }

    return findings;
}

function toWorkspaceRelative(filePath) {
    return path.relative(process.cwd(), filePath).split(path.sep).join('/');
}

function main() {
    if (!fs.existsSync(ROOT)) {
        console.error(`Payload JSDoc check failed: source root not found: ${ROOT}`);
        process.exit(1);
    }

    const sourceFiles = collectSourceFiles(ROOT);
    const findings = sourceFiles.flatMap((filePath) => validateFile(filePath));

    if (findings.length > 0) {
        console.error('Payload JSDoc check failed. Add short descriptions to these @param entries:');
        for (const finding of findings) {
            console.error(
                `- ${toWorkspaceRelative(finding.filePath)}:${finding.classLine} ${finding.className} @param ${finding.paramName}`
            );
        }
        process.exit(1);
    }

    console.log(
        'Payload JSDoc check passed: all payload @param entries include short descriptions (JavaScript/TypeScript).'
    );
}

main();
