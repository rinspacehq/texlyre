// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import test from 'node:test';
import { BusyTexRunner } from 'texlyre-busytex';

const LONG_BUDGET = 45 * 60 * 1000;

async function fixture(t, config = {}) {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const workers = [];
	class TestWorker {
		onmessage = null;
		onerror = null;
		terminated = false;
		messages = [];
		throwOnPost = false;
		constructor() { workers.push(this); }
		postMessage(message) {
			if (this.throwOnPost) throw new Error('post failed');
			this.messages.push(message);
			if (message.preload) queueMicrotask(() => this.emit({ initialized: true }));
		}
		emit(data) { this.onmessage?.({ data }); }
		terminate() { this.terminated = true; }
	}
	const original = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
	Object.defineProperty(globalThis, 'Worker', { value: TestWorker, configurable: true });
	t.after(() => {
		if (original) Object.defineProperty(globalThis, 'Worker', original);
		else delete globalThis.Worker;
	});
	const runner = new BusyTexRunner({ compileTimeoutMs: LONG_BUDGET, ...config });
	await runner.initialize();
	t.after(() => runner.terminate());
	return { runner, workers, worker: workers[0] };
}

function compile(runner, shellHandlerScripts = []) {
	return runner.compile([{ path: 'main.tex', content: 'test' }], 'main.tex',
		true, null, true, true, 'silent', 'xetex_bibtex8_dvipdfmx', null,
		undefined, false, shellHandlerScripts);
}

function pdf(worker) {
	worker.emit({ pdf: new Uint8Array([37, 80, 68, 70]), exit_code: 0, log: '', logs: [] });
}

test('actual patched runner can finish after both three and thirty minutes', async (t) => {
	const { runner, worker } = await fixture(t);
	let settled = false;
	const result = compile(runner);
	result.then(() => { settled = true; });
	t.mock.timers.tick(3 * 60 * 1000);
	await Promise.resolve();
	assert.equal(settled, false);
	worker.emit({ print: 'Downloading data... (1/2)' });
	t.mock.timers.tick(41 * 60 * 1000);
	await Promise.resolve();
	assert.equal(settled, false);
	pdf(worker);
	assert.equal((await result).success, true);
	assert.equal(worker.terminated, false);
	assert.equal(worker.onmessage, null);
	assert.equal(worker.onerror, null);
	t.mock.timers.tick(LONG_BUDGET);
	assert.equal(worker.terminated, false, 'success clears the old deadline');
});

test('45-minute deadline terminates once, without being extended by progress', async (t) => {
	const { runner, worker } = await fixture(t);
	const rejected = assert.rejects(compile(runner), /Compilation timeout after 45 minutes/);
	t.mock.timers.tick(LONG_BUDGET - 1);
	assert.equal(worker.terminated, false);
	worker.emit({ print: 'Downloading data... (1/2)' });
	t.mock.timers.tick(1);
	await rejected;
	assert.equal(worker.terminated, true);
	assert.equal(runner.isInitialized(), false);
	assert.equal(worker.onmessage, null);
	assert.equal(worker.onerror, null);
});

test('manual terminate settles pending compilation and allows a fresh worker', async (t) => {
	const { runner, worker, workers } = await fixture(t);
	const cancelled = assert.rejects(compile(runner), /Compilation cancelled/);
	const lateHandler = worker.onmessage;
	runner.terminate();
	await cancelled;
	assert.equal(worker.terminated, true);
	await runner.initialize();
	const result = compile(runner);
	lateHandler({ data: { pdf: new Uint8Array(), exit_code: 0 } });
	assert.notEqual(workers[1].onmessage, null);
	pdf(workers[1]);
	assert.equal((await result).success, true);
	t.mock.timers.tick(LONG_BUDGET);
	assert.equal(workers[1].terminated, false);
});

test('a timed-out runner can initialize and compile again', async (t) => {
	const { runner, workers } = await fixture(t);
	const timeout = assert.rejects(compile(runner), /Compilation timeout/);
	t.mock.timers.tick(LONG_BUDGET);
	await timeout;
	await runner.initialize();
	const result = compile(runner);
	pdf(workers[1]);
	assert.equal((await result).success, true);
});

test('concurrent compile cannot steal the active handler or deadline', async (t) => {
	const { runner, worker } = await fixture(t);
	const first = compile(runner);
	const handler = worker.onmessage;
	await assert.rejects(compile(runner), /already running/);
	assert.equal(worker.onmessage, handler);
	pdf(worker);
	assert.equal((await first).success, true);
});

test('worker runtime errors reject and terminate instead of waiting 45 minutes', async (t) => {
	const { runner, worker } = await fixture(t);
	const failure = assert.rejects(compile(runner), /WASM failed/);
	let prevented = false;
	worker.onerror({ message: 'WASM failed', preventDefault() { prevented = true; } });
	await failure;
	assert.equal(prevented, true);
	assert.equal(worker.terminated, true);
	t.mock.timers.tick(LONG_BUDGET);
});

test('worker exceptions reject and terminate', async (t) => {
	const { runner, worker } = await fixture(t);
	const failure = assert.rejects(compile(runner), /TeX exception/);
	worker.emit({ exception: 'TeX exception' });
	await failure;
	assert.equal(worker.terminated, true);
});

test('postMessage failure clears handlers and terminates the worker', async (t) => {
	const { runner, worker } = await fixture(t);
	worker.throwOnPost = true;
	await assert.rejects(compile(runner), /post failed/);
	assert.equal(worker.terminated, true);
	assert.equal(worker.onmessage, null);
	assert.equal(worker.onerror, null);
});

test('shell-handler loading is covered by the same finite budget', async (t) => {
	const { runner, worker } = await fixture(t);
	const timeout = assert.rejects(compile(runner, ['/handler.js']), /Compilation timeout/);
	assert.equal(worker.messages.filter(message => message.main_tex_path).length, 0);
	t.mock.timers.tick(LONG_BUDGET);
	await timeout;
	assert.equal(worker.terminated, true);
});

test('ordinary nonzero TeX exit remains a normal result, not a timer failure', async (t) => {
	const { runner, worker } = await fixture(t);
	const result = compile(runner);
	worker.emit({ pdf: null, exit_code: 1, log: 'Missing document', logs: [] });
	assert.equal((await result).success, false);
	assert.equal(worker.terminated, false);
});

test('dependency default remains three minutes when host does not opt in', async (t) => {
	const { runner, worker } = await fixture(t, { compileTimeoutMs: undefined });
	assert.equal(runner.getConfig().compileTimeoutMs, 180000);
	const timeout = assert.rejects(compile(runner), /Compilation timeout after 3 minutes/);
	t.mock.timers.tick(180000);
	await timeout;
	assert.equal(worker.terminated, true);
});

test('invalid timer values cannot disable the finite deadline or overflow the browser timer', () => {
	for (const compileTimeoutMs of [0, -1, NaN, Infinity, 1.5, 2147483648]) {
		assert.throws(() => new BusyTexRunner({ compileTimeoutMs }), RangeError);
	}
});
