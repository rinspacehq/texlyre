// SPDX-License-Identifier: AGPL-3.0-or-later
import type { DocumentList } from '@/types/documents';

import type {
	RinspaceAgentCompileResult,
	RinspaceAgentDiagnosticSource,
} from './RinspaceAgentTools';

type CompilerSource = 'latex' | 'typst' | 'external';

export interface RinspaceAgentCompileState {
	diagnostics: readonly RinspaceAgentDiagnosticSource[];
	metadata: DocumentList['projectMetadata'];
	revision: number;
	busy: boolean;
	compileLatex: (mainFile: string) => Promise<void>;
	compileTypst: (mainFile: string) => Promise<void>;
	compileExternal: (compilerId: string, mainFile: string) => Promise<void>;
	compileMarkdown: (mainFile: string) => Promise<RinspaceAgentCompileResult>;
	outputBytes: (source: CompilerSource) => number | undefined;
}

interface RinspaceAgentCompileDependencies {
	getState: () => RinspaceAgentCompileState;
	resolveCompiler: (
		format: string,
		compilerId?: string,
	) => Readonly<{ id: string }> | undefined;
	wait?: (milliseconds: number) => Promise<void>;
	maxPollAttempts?: number;
	pollIntervalMs?: number;
}

const waitForTimeout = (milliseconds: number): Promise<void> =>
	new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));

export async function compileConfiguredProject({
	getState,
	resolveCompiler,
	wait = waitForTimeout,
	maxPollAttempts = 40,
	pollIntervalMs = 25,
}: RinspaceAgentCompileDependencies): Promise<RinspaceAgentCompileResult> {
	const initial = getState();
	if (initial.busy) throw new Error('A TeXlyre compilation is already running');
	const metadata = initial.metadata;
	const managedBuild = metadata?.managedBuild;
	if (managedBuild?.status === 'invalid') throw new Error(managedBuild.message);

	const format =
		managedBuild?.status === 'valid'
			? managedBuild.format
			: (metadata?.type ?? 'latex');
	const configuredMain =
		managedBuild?.status === 'valid' ? managedBuild.entry : metadata?.mainFile;
	if (!configuredMain)
		throw new Error('The project has no configured main file');
	const mainFile = configuredMain.startsWith('/')
		? configuredMain
		: `/${configuredMain}`;
	if (format === 'markdown') return initial.compileMarkdown(mainFile);
	if (format === 'pdf') {
		throw new Error('A PDF source project has no text compilation step');
	}

	const provider = resolveCompiler(
		format,
		managedBuild ? undefined : metadata?.compilerId,
	);
	if (!provider)
		throw new Error(`Configured compiler is unavailable for ${format}`);
	const source: CompilerSource =
		provider.id === 'internal:latex'
			? 'latex'
			: provider.id === 'internal:typst'
				? 'typst'
				: 'external';
	const startRevision = initial.revision;
	if (source === 'latex') await initial.compileLatex(mainFile);
	else if (source === 'typst') await initial.compileTypst(mainFile);
	else await initial.compileExternal(provider.id, mainFile);

	let finalState = getState();
	let diagnostic = finalState.diagnostics.find((item) => item.id === source);
	let published = false;
	for (let attempt = 0; attempt < maxPollAttempts; attempt += 1) {
		finalState = getState();
		diagnostic = finalState.diagnostics.find((item) => item.id === source);
		if (
			finalState.revision > startRevision &&
			diagnostic &&
			diagnostic.status !== 'idle' &&
			diagnostic.status !== 'running'
		) {
			published = true;
			break;
		}
		await wait(pollIntervalMs);
	}
	if (
		!published ||
		!diagnostic ||
		(diagnostic.status !== 'success' && diagnostic.status !== 'error')
	) {
		throw new Error('The configured compiler did not publish a final result');
	}
	return {
		compilerId: provider.id,
		mainFile,
		status: diagnostic.status,
		error: diagnostic.error,
		log: diagnostic.log,
		outputBytes: finalState.outputBytes(source),
	};
}
