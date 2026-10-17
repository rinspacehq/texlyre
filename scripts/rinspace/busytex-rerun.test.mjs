// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
const {
	MARKER, ORIGINAL_PATTERNS, ORIGINAL_LOOP, RERUN_PATTERNS, RERUN_LOOP,
	createPatchedBusytexPipeline,
} = require('./apply-busytex-rerun-overlay.cjs');
const { sha256 } = require('./apply-runtime-overlays.cjs');
const needsRerun = log => RERUN_PATTERNS.some(pattern => log.includes(pattern));

// Execute the exact build-overlay loop, not an independently reimplemented policy.
function rerun(logs) {
	const calls = [];
	const context = {
		max_tex_passes: 3,
		error_messages_all: ['Fatal error occurred', 'No pages of output.'],
		_needs_rerun: needsRerun,
		final_cmd: ['pdflatex', '--output-format=pdf'],
		exit_code: 0, last_log: '',
		run(command, errors) {
			calls.push({ command, errors });
			return logs[calls.length - 1] ?? logs.at(-1);
		},
	};
	runInNewContext(RERUN_LOOP, context);
	return { calls, code: context.exit_code, log: context.last_log };
}

test('normal rerunfilecheck package loading and unchanged outline info are not warnings', () => {
	const log = `Package: rerunfilecheck 2025/06/21 v1.11 Rerun checks for auxiliary files
Package rerunfilecheck Info: File 'book.out' has not changed.
(rerunfilecheck)             Checksum: D41D8CD98F00B204E9800998ECF8427E.`;
	assert.equal(needsRerun(log), false);
	assert.equal(rerun([{ exit_code: 0, log }]).calls.length, 1);
});

test('real multiline outline, labels, undefined references and longtable warnings still rerun', () => {
	for (const warning of [
		`Package rerunfilecheck Warning: File 'book.out' has changed.
(rerunfilecheck)                Rerun to get outlines right
(rerunfilecheck)                or use package bookmark.`,
		'LaTeX Warning: Label(s) may have changed. Rerun to get cross-references right.',
		'LaTeX Warning: There were undefined references.',
		'Package longtable Warning: Table widths have changed. Rerun LaTeX.',
		'Package hyperref Warning: Please run LaTeX again.',
	]) {
		assert.equal(needsRerun(warning), true);
		assert.equal(rerun([{ exit_code: 0, log: warning }, { exit_code: 0, log: '' }]).calls.length, 2);
	}
});

test('stable initial sources still get a second TeX pass for toc/lof/lot, bibliography or index', () => {
	// The unchanged initial/BibTeX/makeindex stages precede this mandatory loop.
	const { calls } = rerun([{ exit_code: 0, log: 'No warnings.' }]);
	assert.equal(calls.length, 1, 'one rerun after the initial TeX pass');
	assert.ok(calls.every(call => call.command.includes('--output-format=pdf')));
	assert.ok(calls.every(call => call.errors.includes('No pages of output.')));
});

test('pdfTeX convergence emits the final PDF without another redundant final pass', () => {
	assert.equal(rerun([{ exit_code: 0, log: '' }]).calls.length, 1);
});

test('genuinely unsettled references retain the existing three-extra-pass bound', () => {
	const { calls, code } = rerun([{ exit_code: 0, log: 'There were undefined references' }]);
	assert.equal(calls.length, 3);
	assert.equal(code, 0);
});

test('a failed TeX pass stops immediately and preserves its log and exit code', () => {
	const result = rerun([{ exit_code: 1, log: 'Fatal error occurred' }]);
	assert.equal(result.calls.length, 1);
	assert.equal(result.code, 1);
	assert.equal(result.log, 'Fatal error occurred');
});

test('source overlay changes only the two reviewed anchors and rejects drift or reapplication', () => {
	const source = `// retained upstream source\n${ORIGINAL_PATTERNS}\n// retained middle\n${ORIGINAL_LOOP}\n// retained end`;
	const patched = createPatchedBusytexPipeline(source, sha256(source));
	assert.match(patched, new RegExp(MARKER));
	assert.ok(patched.startsWith('// retained upstream source'));
	assert.ok(patched.includes('// retained middle'));
	assert.ok(patched.endsWith('// retained end'));
	assert.ok(!patched.includes("'rerunfilecheck'"));
	assert.throws(() => createPatchedBusytexPipeline(source), /source changed/);
	assert.throws(() => createPatchedBusytexPipeline(patched, sha256(patched)), /already applied/);
	for (const changed of [source.replace(ORIGINAL_LOOP, ''), source + ORIGINAL_PATTERNS]) {
		assert.throws(() => createPatchedBusytexPipeline(changed, sha256(changed)), /anchor changed or duplicated/);
	}
});

test('every production build applies the locked source overlay after Vite', async () => {
	const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
	for (const name of ['build', 'build:prod', 'build:local']) {
		assert.match(pkg.scripts[name], /vite build && node scripts\/rinspace\/apply-runtime-overlays\.cjs && node scripts\/rinspace\/apply-busytex-rerun-overlay\.cjs$/);
	}
});
