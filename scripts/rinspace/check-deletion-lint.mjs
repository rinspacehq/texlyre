// SPDX-License-Identifier: AGPL-3.0-or-later
import { execFileSync } from 'node:child_process';
import { copyFile, mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ESLint } from 'eslint';

// These existing modules had not been included in the zero-warning CI scope.
// Keep their exact inherited diagnostics visible; reject every current error
// and any warning without the same source context in the reviewed baseline.
const baseline = 'e2a46de702e93309d750fcfa828d1d700c6c3291';
const files = [
	'src/services/FileStoreService.ts',
	'src/services/WriteTargetService.ts',
	'src/contexts/FileTreeContext.tsx',
];
const eslint = new ESLint();
const originalRoot = await mkdtemp(path.join(tmpdir(), 'texlyre-deletion-lint-'));
let inheritedWarnings = 0;
const unexpected = [];

function fingerprint(message, source) {
	const lines = source.split('\n');
	return JSON.stringify([
		message.ruleId,
		message.message,
		lines.slice(Math.max(0, message.line - 3), message.line + 2),
	]);
}

try {
	// The type-aware parser reads its project files. Give it an independent
	// physical baseline rather than lintText under the current file's path.
	const archive = execFileSync('git', ['archive', baseline, 'src', 'extras', 'texlyre.config.ts'], { maxBuffer: 32 * 1024 * 1024 });
	execFileSync('tar', ['-x', '-C', originalRoot], { input: archive });
	for (const config of ['.gitignore', 'eslint.config.js', 'package.json', 'tsconfig.json', 'tsconfig.node.json', 'tsconfig.test.json']) {
		await copyFile(config, path.join(originalRoot, config));
	}
	await symlink(path.resolve('node_modules'), path.join(originalRoot, 'node_modules'), 'dir');
	const originalEslint = new ESLint({ cwd: originalRoot });
	for (const file of files) {
		const originalFile = path.join(originalRoot, file);
		const original = await readFile(originalFile, 'utf8');
		const source = await readFile(file, 'utf8');
		if (await eslint.isPathIgnored(file)) throw new Error(`Deletion module is unexpectedly ignored: ${file}`);
		const [oldResult] = await originalEslint.lintFiles(originalFile);
		const [result] = await eslint.lintText(source, { filePath: file });
		const allowed = new Map();
		for (const message of oldResult.messages.filter((entry) => entry.severity === 1)) {
			const key = fingerprint(message, original);
			allowed.set(key, (allowed.get(key) ?? 0) + 1);
		}
		for (const message of result.messages) {
			const key = fingerprint(message, source);
			if (message.severity === 1 && (allowed.get(key) ?? 0) > 0) {
				allowed.set(key, allowed.get(key) - 1);
				inheritedWarnings++;
			} else {
				unexpected.push({ file, ruleId: message.ruleId, severity: message.severity, line: message.line, message: message.message });
			}
		}
	}
} finally {
	// Only the newly created, generated source baseline is removed.
	await rm(originalRoot, { recursive: true, force: true });
}
console.log(JSON.stringify({ baseline, files, inheritedWarnings, unexpected }));
if (unexpected.length > 0) process.exitCode = 1;
