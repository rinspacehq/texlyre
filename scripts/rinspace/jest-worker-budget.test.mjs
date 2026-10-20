// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../../', import.meta.url));
const config = require('../../jest.config.cjs');

test('CI retains all tests and V8 coverage with one recyclable worker', () => {
	const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
	assert.match(pkg.scripts['test:ci'], /--ci\b/);
	assert.match(pkg.scripts['test:ci'], /--coverage\b/);
	assert.match(pkg.scripts['test:ci'], /--maxWorkers=1\b/);
	assert.doesNotMatch(pkg.scripts['test:ci'], /--runInBand|--detectOpenHandles/);
	assert.equal(config.workerIdleMemoryLimit, '768MB');
	assert.equal(config.coverageProvider, 'v8');
	assert.deepEqual(config.collectCoverageFrom, ['src/**/*.{ts,tsx}', '!src/**/*.d.ts', '!src/vite-env.d.ts']);
	assert.deepEqual(config.roots, ['<rootDir>/tests']);
	assert.deepEqual(config.testMatch, ['**/__tests__/**/*.ts?(x)', '**/?(*.)+(spec|test).ts?(x)']);
});

test('the installed Jest actually recycles a single worker without overlapping tests', (t) => {
	const directory = mkdtempSync(path.join(os.tmpdir(), 'rinspace-jest-worker-budget-'));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	const ledger = path.join(directory, 'events.jsonl');
	const fixtureConfig = path.join(directory, 'jest.fixture.cjs');
	writeFileSync(fixtureConfig, `module.exports = ${JSON.stringify({
		rootDir: directory, roots: [directory], testMatch: ['**/*.case.cjs'],
		testEnvironment: 'node', transform: {}, cache: false,
		moduleFileExtensions: ['js', 'cjs', 'json', 'node'],
		maxWorkers: 1, workerIdleMemoryLimit: '1MB', collectCoverage: false,
	})};\n`);
	for (let index = 0; index < 3; index++) {
		writeFileSync(path.join(directory, `${index}.case.cjs`), `
const fs = require('node:fs');
const record = type => fs.appendFileSync(process.env.RINSPACE_TEST_WORKER_LEDGER,
  JSON.stringify({type, pid:process.pid, file:${index}}) + '\\n');
test('synthetic serial worker case ${index}', () => {
  record('start');
  try { expect(process.env.JEST_WORKER_ID).toBe('1'); expect(6 * 7).toBe(42); }
  finally { record('end'); }
});\n`);
	}
	const execution = spawnSync(process.execPath, [path.join(root, 'node_modules/jest/bin/jest.js'), '--ci', '--config', fixtureConfig], {
		cwd: root, encoding: 'utf8', timeout: 60000, maxBuffer: 1 << 20,
		env: { PATH: process.env.PATH, HOME: directory, TMPDIR: directory, NODE_OPTIONS: '--max-old-space-size=384', RINSPACE_TEST_WORKER_LEDGER: ledger },
	});
	assert.equal(execution.status, 0, `${execution.stdout}\n${execution.stderr}`);
	const events = readFileSync(ledger, 'utf8').trim().split('\n').map(line => JSON.parse(line));
	assert.equal(events.length, 6);
	let active = null;
	const completed = new Set(), workers = new Set();
	for (const event of events) {
		assert(Number.isSafeInteger(event.pid) && event.pid > 0);
		assert.notEqual(event.pid, execution.pid, 'must not silently fall back to in-band execution');
		if (event.type === 'start') {
			assert.equal(active, null, 'single-worker tests must not overlap');
			active = event;
			workers.add(event.pid);
		} else {
			assert.equal(event.type, 'end');
			assert(active && active.pid === event.pid && active.file === event.file);
			completed.add(event.file);
			active = null;
		}
	}
	assert.equal(active, null);
	assert.equal(completed.size, 3);
	assert(workers.size > 1, 'the heap threshold must actually replace the worker between files');
});
