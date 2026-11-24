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

function toWorkspaceRelative(filePath) {
    return path.relative(process.cwd(), filePath).split(path.sep).join('/');
}

function lineNumberAt(text, index) {
    return text.slice(0, index).split(/\r?\n/).length;
}

function findMatchingParen(source, openParenIndex) {
    let depth = 0;
    for (let index = openParenIndex; index < source.length; index += 1) {
        const ch = source[index];
        if (ch === '(') {
            depth += 1;
        } else if (ch === ')') {
            depth -= 1;
            if (depth === 0) {
                return index;
            }
        }
    }
    return -1;
}

function splitTopLevelArgs(rawArgs) {
    const args = [];
    let current = '';
    let parenDepth = 0;
    let bracketDepth = 0;
    let braceDepth = 0;

    for (let index = 0; index < rawArgs.length; index += 1) {
        const ch = rawArgs[index];
        if (ch === '(') parenDepth += 1;
        if (ch === ')') parenDepth -= 1;
        if (ch === '[') bracketDepth += 1;
        if (ch === ']') bracketDepth -= 1;
        if (ch === '{') braceDepth += 1;
        if (ch === '}') braceDepth -= 1;

        if (ch === ',' && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
            args.push(current.trim());
            current = '';
            continue;
        }

        current += ch;
    }

    if (current.trim()) {
        args.push(current.trim());
    }

    return args;
}

function isLiteralPayloadExpression(expression) {
    if (!expression) return false;
    const trimmed = expression.trim();

    return (
        trimmed.startsWith('{') ||
        trimmed.startsWith('[') ||
        trimmed.startsWith("'") ||
        trimmed.startsWith('"') ||
        trimmed.startsWith('`') ||
        /^-?\d/.test(trimmed) ||
        trimmed === 'true' ||
        trimmed === 'false' ||
        trimmed === 'null' ||
        trimmed === 'undefined'
    );
}

function validateFile(filePath) {
    const source = fs.readFileSync(filePath, 'utf8');
    const findings = [];

    const isAppDomainEmitterFile =
        source.includes('extends AppEventEmitter') ||
        source.includes('new AppEvent(') ||
        source.includes('AppPayload');

    if (!isAppDomainEmitterFile) {
        return findings;
    }

    const callPatterns = [
        { name: '.emit(', regex: /\.emit\s*\(/g, payloadArgIndex: 1 },
        { name: '._emit(', regex: /\._emit\s*\(/g, payloadArgIndex: 1 },
        { name: 'new AppEvent(', regex: /new\s+AppEvent\s*\(/g, payloadArgIndex: 1 },
    ];

    for (const { name, regex, payloadArgIndex } of callPatterns) {
        for (const match of source.matchAll(regex)) {
            const openParenIndex = (match.index ?? 0) + match[0].lastIndexOf('(');
            const closeParenIndex = findMatchingParen(source, openParenIndex);
            if (closeParenIndex < 0) {
                continue;
            }

            const rawArgs = source.slice(openParenIndex + 1, closeParenIndex);
            const args = splitTopLevelArgs(rawArgs);
            const payloadArg = args[payloadArgIndex];

            if (isLiteralPayloadExpression(payloadArg)) {
                findings.push({
                    filePath,
                    line: lineNumberAt(source, match.index ?? 0),
                    callType: name,
                    payloadArg,
                });
            }
        }
    }

    return findings;
}

function main() {
    if (!fs.existsSync(ROOT)) {
        console.error(`Event payload emission check failed: source root not found: ${ROOT}`);
        process.exit(1);
    }

    const sourceFiles = collectSourceFiles(ROOT);
    const findings = sourceFiles.flatMap((filePath) => validateFile(filePath));

    if (findings.length > 0) {
        console.error('Event payload emission check failed. Use typed AppPayload instances instead of literal/ad-hoc payloads:');
        for (const finding of findings) {
            console.error(
                `- ${toWorkspaceRelative(finding.filePath)}:${finding.line} ${finding.callType} payload=${finding.payloadArg}`
            );
        }
        process.exit(1);
    }

    console.log(
        'Event payload emission check passed: no literal/ad-hoc payload emissions detected (JavaScript/TypeScript).'
    );
}

main();
