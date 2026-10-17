// SPDX-License-Identifier: AGPL-3.0-or-later
import { BusyTexRunner } from 'texlyre-busytex';
import {
	BUSYTEX_COMPILE_TIMEOUT_MS,
	BusyTeXEngine,
} from '@/extensions/texlyre-busytex/BusyTeXEngine';

jest.mock('texlyre-busytex');
jest.mock('@/extensions/texlyre-busytex/BusyTeXRuntimeCache', () => ({
	cacheBusyTeXRuntimeWasm: jest.fn(async () => undefined),
}));

const Runner = jest.mocked(BusyTexRunner);
function latestRunner(): jest.Mocked<BusyTexRunner> {
	return Runner.mock.results.at(-1)?.value;
}

beforeEach(() => { jest.clearAllMocks(); });

it('passes a real 45-minute worker budget to the dependency', async () => {
	const engine = new BusyTeXEngine();
	await engine.initialize();
	expect(BUSYTEX_COMPILE_TIMEOUT_MS).toBe(2700000);
	expect(Runner).toHaveBeenLastCalledWith(expect.objectContaining({
		compileTimeoutMs: 2700000,
	}));
	engine.terminate();
});

it('does not report a terminated timeout worker as ready and can initialize again', async () => {
	const engine = new BusyTeXEngine();
	await engine.initialize();
	const old = latestRunner();
	old.compile.mockImplementationOnce(async () => {
		old.isInitialized.mockReturnValue(false);
		throw new Error('Compilation timeout after 45 minutes');
	});
	await expect(engine.compile('main.tex', [])).rejects.toThrow('Compilation timeout');
	expect(engine.getStatus()).toBe('unloaded');
	await expect(engine.compile('main.tex', [])).resolves.toHaveProperty('status', 0);
	expect(Runner).toHaveBeenCalledTimes(2);
	expect(engine.getStatus()).toBe('ready');
	engine.terminate();
});

it('late rejection from a stopped job cannot change a new job status', async () => {
	const engine = new BusyTeXEngine();
	await engine.initialize();
	const old = latestRunner();
	let rejectOld: ((error: Error) => void) | undefined;
	old.compile.mockImplementationOnce(() => new Promise((_, reject) => {
		rejectOld = reject;
	}));
	const cancelled = expect(engine.compile('main.tex', [])).rejects.toThrow('Compilation cancelled');
	engine.stopCompilation();
	expect(old.terminate).toHaveBeenCalledTimes(1);
	await engine.initialize();
	const current = latestRunner();
	let finish: (() => void) | undefined;
	current.compile.mockImplementationOnce(() => new Promise(resolve => {
		finish = () => resolve({ success: true, exitCode: 0, pdf: new Uint8Array(), log: '', logs: [] });
	}));
	const fresh = engine.compile('main.tex', []);
	rejectOld?.(new Error('Compilation cancelled'));
	await cancelled;
	expect(engine.getStatus()).toBe('compiling');
	finish?.();
	await fresh;
	expect(engine.getStatus()).toBe('ready');
	engine.terminate();
});

it('refuses a duplicate compile without resetting the first job state', async () => {
	const engine = new BusyTeXEngine();
	await engine.initialize();
	const runner = latestRunner();
	let finish: (() => void) | undefined;
	runner.compile.mockImplementationOnce(() => new Promise(resolve => {
		finish = () => resolve({ success: true, exitCode: 0, pdf: new Uint8Array(), log: '', logs: [] });
	}));
	const first = engine.compile('main.tex', []);
	await expect(engine.compile('main.tex', [])).rejects.toThrow('already running');
	expect(engine.getStatus()).toBe('compiling');
	expect(runner.compile).toHaveBeenCalledTimes(1);
	finish?.();
	await first;
	engine.terminate();
});
