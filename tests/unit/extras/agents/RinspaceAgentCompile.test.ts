// SPDX-License-Identifier: AGPL-3.0-or-later
import {
	compileConfiguredProject,
	type RinspaceAgentCompileState,
} from '@extras/agents/rinspace/RinspaceAgentCompile';

function createState(): RinspaceAgentCompileState {
	return {
		diagnostics: [],
		metadata: {
			name: 'Agent test',
			description: '',
			type: 'latex',
			mainFile: 'main.tex',
		},
		revision: 1,
		busy: false,
		compileLatex: jest.fn(async () => undefined),
		compileTypst: jest.fn(async () => undefined),
		compileExternal: jest.fn(async () => undefined),
		compileMarkdown: jest.fn(async (mainFile) => ({
			compilerId: 'milkdown-preview',
			mainFile,
			status: 'success',
			error: null,
			log: 'Markdown preview ready',
			outputBytes: 80,
		})),
		outputBytes: () => undefined,
	};
}

test('runs the managed LaTeX entry and returns only its newly published result', async () => {
	let state = createState();
	state.metadata = {
		name: 'Managed LaTeX',
		description: '',
		managedBuild: {
			authority: 'rinspace.yaml',
			status: 'valid',
			format: 'latex',
			entry: 'book/main.tex',
		},
	};
	state.compileLatex = jest.fn(async () => {
		state = {
			...state,
			revision: 2,
			diagnostics: [{
				id: 'latex',
				status: 'success',
				error: null,
				log: 'LaTeX succeeded',
			}],
			outputBytes: (source) => source === 'latex' ? 4096 : undefined,
		};
	});
	const resolveCompiler = jest.fn(() => ({ id: 'internal:latex' }));

	await expect(compileConfiguredProject({
		getState: () => state,
		resolveCompiler,
		wait: async () => undefined,
	})).resolves.toEqual({
		compilerId: 'internal:latex',
		mainFile: '/book/main.tex',
		status: 'success',
		error: null,
		log: 'LaTeX succeeded',
		outputBytes: 4096,
	});
	expect(state.compileLatex).toHaveBeenCalledWith('/book/main.tex');
	expect(resolveCompiler).toHaveBeenCalledWith('latex', undefined);
});

test('uses the selected legacy Typst compiler and reports its failure', async () => {
	let state = createState();
	state.metadata = {
		name: 'Typst',
		description: '',
		type: 'typst',
		mainFile: '/main.typ',
		compilerId: 'internal:typst',
	};
	state.compileTypst = jest.fn(async () => {
		state = {
			...state,
			revision: 2,
			diagnostics: [{
				id: 'typst',
				status: 'error',
				error: 'Typst failed',
				log: 'line 2: unknown variable',
			}],
		};
	});
	const resolveCompiler = jest.fn(() => ({ id: 'internal:typst' }));

	await expect(compileConfiguredProject({
		getState: () => state,
		resolveCompiler,
		wait: async () => undefined,
	})).resolves.toMatchObject({
		compilerId: 'internal:typst',
		mainFile: '/main.typ',
		status: 'error',
		error: 'Typst failed',
	});
	expect(state.compileTypst).toHaveBeenCalledWith('/main.typ');
	expect(resolveCompiler).toHaveBeenCalledWith('typst', 'internal:typst');
});

test('routes a managed Markdown project through the existing preview compiler', async () => {
	const state = createState();
	state.metadata = {
		name: 'Markdown',
		description: '',
		managedBuild: {
			authority: 'rinspace.yaml',
			status: 'valid',
			format: 'markdown',
			entry: 'README.md',
		},
	};
	const resolveCompiler = jest.fn();

	await expect(compileConfiguredProject({
		getState: () => state,
		resolveCompiler,
	})).resolves.toMatchObject({
		compilerId: 'milkdown-preview',
		mainFile: '/README.md',
		status: 'success',
	});
	expect(state.compileMarkdown).toHaveBeenCalledWith('/README.md');
	expect(resolveCompiler).not.toHaveBeenCalled();
});

test('fails closed instead of returning a stale final diagnostic', async () => {
	const state = createState();
	state.diagnostics = [{
		id: 'latex',
		status: 'success',
		error: null,
		log: 'Result from the previous compilation',
	}];

	await expect(compileConfiguredProject({
		getState: () => state,
		resolveCompiler: () => ({ id: 'internal:latex' }),
		wait: async () => undefined,
		maxPollAttempts: 2,
	})).rejects.toThrow('did not publish a final result');
});

test('rejects an already running compiler and an invalid managed build', async () => {
	const busy = createState();
	busy.busy = true;
	await expect(compileConfiguredProject({
		getState: () => busy,
		resolveCompiler: () => ({ id: 'internal:latex' }),
	})).rejects.toThrow('already running');

	const invalid = createState();
	invalid.metadata = {
		name: 'Invalid',
		description: '',
		managedBuild: {
			authority: 'rinspace.yaml',
			status: 'invalid',
			message: 'Invalid rinspace.yaml',
		},
	};
	await expect(compileConfiguredProject({
		getState: () => invalid,
		resolveCompiler: () => ({ id: 'internal:latex' }),
	})).rejects.toThrow('Invalid rinspace.yaml');
});
