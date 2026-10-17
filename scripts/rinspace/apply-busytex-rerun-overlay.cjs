// SPDX-License-Identifier: AGPL-3.0-or-later
// Reviewed source overlay for the separately byte-locked BusyTeX 1.4.0 archive.
const assert = require('node:assert/strict');
const { readFile, writeFile } = require('node:fs/promises');
const path = require('node:path');
const { sha256 } = require('./apply-runtime-overlays.cjs');

const PIPELINE_PATH = 'core/busytex/busytex_pipeline.js';
const UPSTREAM_SHA256 = '4855e8fec24e8df952e1080d902791752bcdf283f4fae15811c371dd3ba3389e';
const MARKER = 'rinspace-busytex-rerun-v1';

const ORIGINAL_PATTERNS = `        this.rerun_patterns = [
            'Rerun to get',
            'Rerun LaTeX',
            'rerunfilecheck',
            'Label(s) may have changed',
            'There were undefined references',
            'run LaTeX again',
        ];`;

const RERUN_PATTERNS = [
	'Rerun to get',
	'Rerun LaTeX',
	'Label(s) may have changed',
	'There were undefined references',
	'run LaTeX again',
];

const ORIGINAL_LOOP = `                for (let pass = 0; pass < this.max_tex_passes; pass++) {
                    const is_last_pass = pass === this.max_tex_passes - 1;
                    const cmd = is_last_pass ? final_cmd : nonfinal;
                    const error_messages = is_last_pass ? this.error_messages_all : this.error_messages_fatal;

                    ({ exit_code, log: last_log } = run(cmd, error_messages));

                    if (exit_code != 0)
                        break;

                    if (!this._needs_rerun(last_log)) {
                        if (cmd !== final_cmd) {
                            ({ exit_code, log: last_log } = run(final_cmd, this.error_messages_all));
                        }
                        break;
                    }
                }`;

// Retain at least one pass after the initial run: a new .toc/.lof/.lot, .bbl
// or .ind can require it without a rerun warning. Every rerun emits final
// output, so convergence never requires a separate identical typesetting pass.
const RERUN_LOOP = `                // ${MARKER}
                for (let pass = 0; pass < this.max_tex_passes; pass++) {
                    ({ exit_code, log: last_log } = run(final_cmd, this.error_messages_all));
                    if (exit_code != 0 || !this._needs_rerun(last_log))
                        break;
                }`;

function replaceOnce(source, before, after) {
	assert.equal(source.split(before).length, 2, 'BusyTeX patch anchor changed or duplicated');
	return source.replace(before, () => after);
}

function createPatchedBusytexPipeline(source, expectedSha256 = UPSTREAM_SHA256) {
	assert.equal(sha256(source), expectedSha256, 'BusyTeX pipeline source changed; re-review required');
	assert.ok(!source.includes(MARKER), 'BusyTeX rerun overlay already applied');
	const patterns = `        this.rerun_patterns = ${JSON.stringify(RERUN_PATTERNS, null, 4).replaceAll('\n', '\n        ')};`;
	return replaceOnce(replaceOnce(source, ORIGINAL_PATTERNS, patterns), ORIGINAL_LOOP, RERUN_LOOP);
}

async function applyBusytexRerunOverlay(distDir = path.resolve(__dirname, '../../dist')) {
	const filename = path.join(distDir, PIPELINE_PATH);
	const patched = createPatchedBusytexPipeline(await readFile(filename, 'utf8'));
	await writeFile(filename, patched, 'utf8');
	return { file: PIPELINE_PATH, upstreamSha256: UPSTREAM_SHA256, artifactSha256: sha256(patched) };
}

if (require.main === module) {
	applyBusytexRerunOverlay().then(result => console.log(JSON.stringify(result))).catch(error => {
		console.error(`BusyTeX rerun overlay failed: ${error.message}`);
		process.exitCode = 1;
	});
}

module.exports = {
	PIPELINE_PATH, UPSTREAM_SHA256, MARKER, ORIGINAL_PATTERNS, RERUN_PATTERNS,
	ORIGINAL_LOOP, RERUN_LOOP, createPatchedBusytexPipeline, applyBusytexRerunOverlay,
};
