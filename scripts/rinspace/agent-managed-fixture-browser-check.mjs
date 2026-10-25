// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
	access,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	stat,
	writeFile,
} from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'../..',
);
const dist = path.join(root, 'dist');
const timeoutMs = Number(
	process.argv
		.find((argument) => argument.startsWith('--timeout-ms='))
		?.slice(13) ?? 60_000,
);
assert.ok(
	Number.isSafeInteger(timeoutMs) && timeoutMs >= 5_000 && timeoutMs <= 120_000,
);

const wait = (milliseconds) =>
	new Promise((resolve) => setTimeout(resolve, milliseconds));

async function browserBinary() {
	const candidates = [
		process.env.CHROMIUM_BIN,
		'/snap/bin/chromium',
		'/usr/bin/chromium-browser',
		'/usr/bin/chromium',
		'/usr/bin/google-chrome',
	].filter(Boolean);
	for (const candidate of candidates) {
		try {
			await access(candidate);
			return candidate;
		} catch {
			// Try the next reviewed browser location.
		}
	}
	throw new Error(
		'Chromium is unavailable; set CHROMIUM_BIN to a reviewed browser binary',
	);
}

function run(command, args, options = {}) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd: options.cwd,
			env: options.env ?? process.env,
			stdio: ['pipe', 'pipe', 'pipe'],
		});
		const stdout = [];
		const stderr = [];
		child.stdout.on('data', (chunk) => stdout.push(chunk));
		child.stderr.on('data', (chunk) => stderr.push(chunk));
		child.on('error', reject);
		child.on('close', (code) => {
			const output = Buffer.concat(stdout);
			if (code === 0) resolve(output);
			else {
				reject(
					new Error(
						`${command} ${args.join(' ')} exited ${code}: ${Buffer.concat(stderr).toString('utf8')}`,
					),
				);
			}
		});
		if (options.input) child.stdin.end(options.input);
		else child.stdin.end();
	});
}

class DevToolsClient {
	#nextId = 0;
	#pending = new Map();
	#listeners = new Map();

	constructor(webSocketUrl) {
		this.socket = new WebSocket(webSocketUrl);
		this.ready = new Promise((resolve, reject) => {
			this.socket.addEventListener('open', resolve, { once: true });
			this.socket.addEventListener('error', reject, { once: true });
		});
		this.socket.addEventListener('message', (event) => {
			const message = JSON.parse(String(event.data));
			if (message.id) {
				const pending = this.#pending.get(message.id);
				if (!pending) return;
				this.#pending.delete(message.id);
				if (message.error) pending.reject(new Error(message.error.message));
				else pending.resolve(message.result);
				return;
			}
			for (const listener of this.#listeners.get(message.method) ?? []) {
				listener(message.params);
			}
		});
	}

	on(method, listener) {
		const listeners = this.#listeners.get(method) ?? [];
		listeners.push(listener);
		this.#listeners.set(method, listeners);
	}

	async send(method, params = {}) {
		await this.ready;
		const id = ++this.#nextId;
		return new Promise((resolve, reject) => {
			this.#pending.set(id, { resolve, reject });
			this.socket.send(JSON.stringify({ id, method, params }));
		});
	}

	close() {
		this.socket.close();
	}
}

async function availablePort() {
	const server = createServer();
	await new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolve);
	});
	const address = server.address();
	assert.ok(address && typeof address === 'object');
	await new Promise((resolve, reject) =>
		server.close((error) => (error ? reject(error) : resolve())),
	);
	return address.port;
}

async function pageTarget(port) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			const response = await fetch(`http://127.0.0.1:${port}/json/list`);
			const targets = await response.json();
			const page = targets.find((candidate) => candidate.type === 'page');
			if (page?.webSocketDebuggerUrl) return page;
		} catch {
			// DevTools can publish its port before the HTTP endpoint is ready.
		}
		await wait(50);
	}
	throw new Error('Timed out waiting for a Chromium page target');
}

async function evaluate(client, expression) {
	const result = await client.send('Runtime.evaluate', {
		expression,
		returnByValue: true,
		awaitPromise: true,
	});
	if (result.exceptionDetails) {
		throw new Error(
			`Browser evaluation failed: ${result.exceptionDetails.exception?.description ?? expression}`,
		);
	}
	return result.result.value;
}

async function keyboardFocusAgentTextarea(client) {
	await evaluate(
		client,
		`(() => {
			const textarea = document.querySelector('section[data-role="agent"] textarea');
			if (!(textarea instanceof HTMLTextAreaElement)) throw new Error('Agent textarea disappeared');
			textarea.focus();
		})()`,
	);
	await client.send('Input.dispatchKeyEvent', {
		type: 'keyDown',
		key: 'Tab',
		code: 'Tab',
		windowsVirtualKeyCode: 9,
		nativeVirtualKeyCode: 9,
	});
	await client.send('Input.dispatchKeyEvent', {
		type: 'keyUp',
		key: 'Tab',
		code: 'Tab',
		windowsVirtualKeyCode: 9,
		nativeVirtualKeyCode: 9,
	});
	await client.send('Input.dispatchKeyEvent', {
		type: 'keyDown',
		key: 'Tab',
		code: 'Tab',
		modifiers: 8,
		windowsVirtualKeyCode: 9,
		nativeVirtualKeyCode: 9,
	});
	await client.send('Input.dispatchKeyEvent', {
		type: 'keyUp',
		key: 'Tab',
		code: 'Tab',
		modifiers: 8,
		windowsVirtualKeyCode: 9,
		nativeVirtualKeyCode: 9,
	});
}

const mimeTypes = new Map([
	['.css', 'text/css; charset=utf-8'],
	['.gif', 'image/gif'],
	['.html', 'text/html; charset=utf-8'],
	['.ico', 'image/x-icon'],
	['.jpeg', 'image/jpeg'],
	['.jpg', 'image/jpeg'],
	['.js', 'text/javascript; charset=utf-8'],
	['.json', 'application/json; charset=utf-8'],
	['.mjs', 'text/javascript; charset=utf-8'],
	['.png', 'image/png'],
	['.svg', 'image/svg+xml'],
	['.wasm', 'application/wasm'],
	['.webp', 'image/webp'],
	['.woff', 'font/woff'],
	['.woff2', 'font/woff2'],
]);

const responseHeaders = (contentType, length, extra = []) => [
	{ name: 'Content-Type', value: contentType },
	{ name: 'Content-Length', value: String(length) },
	{ name: 'Cache-Control', value: 'no-store' },
	...extra,
];

async function staticResponse(url) {
	const pathname = decodeURIComponent(url.pathname);
	let relative =
		pathname === '/editor/' ? 'index.html' : pathname.slice('/editor/'.length);
	if (!pathname.startsWith('/editor/') || relative.includes('\0')) return null;
	if (!relative || relative.endsWith('/')) relative += 'index.html';
	const candidate = path.resolve(dist, relative);
	if (candidate !== dist && !candidate.startsWith(`${dist}${path.sep}`))
		return null;
	try {
		if (!(await stat(candidate)).isFile()) return null;
		const body = await readFile(candidate);
		return {
			code: 200,
			body,
			contentType:
				mimeTypes.get(path.extname(candidate).toLowerCase()) ??
				'application/octet-stream',
		};
	} catch {
		return null;
	}
}

function jsonResponse(value, code = 200) {
	return {
		code,
		body: Buffer.from(JSON.stringify(value)),
		contentType: 'application/json; charset=utf-8',
	};
}

const projectScenarios = [
	{
		owner: 'a',
		repository: '42',
		fullName: 'a/42',
		contentType: 'article',
		format: 'latex',
		entry: 'main.tex',
		secondary: 'sections/content.tex',
		private: true,
		files: {
			'rinspace.yaml': [
				'type: blog',
				'status: draft',
				'sourceVisibility: private',
				'title: Browser fixture LaTeX article',
				'entry: main.tex',
				'build:',
				'  format: latex',
				'metadata:',
				'  rinspacePostId: "42"',
				'',
			].join('\n'),
			'main.tex': [
				'\\documentclass{article}',
				'\\begin{document}',
				'中文 LaTeX 主文，数学公式 $E = mc^2$。',
				'\\input{sections/content}',
				'\\end{document}',
				'',
			].join('\n'),
			'sections/content.tex': '跨文件标记：LaTeX 章节内容。\n',
		},
	},
	{
		owner: 'b',
		repository: '43',
		fullName: 'b/43',
		contentType: 'book',
		format: 'typst',
		entry: 'main.typ',
		secondary: 'chapters/content.typ',
		private: true,
		files: {
			'rinspace.yaml': [
				'type: book',
				'status: draft',
				'sourceVisibility: private',
				'title: Browser fixture Typst book',
				'entry: main.typ',
				'build:',
				'  format: typst',
				'metadata:',
				'  rinspacePostId: "43"',
				'',
			].join('\n'),
			'main.typ': [
				'= 中文 Typst 主文',
				'数学公式 $ x^2 + y^2 = z^2 $.',
				'#include "chapters/content.typ"',
				'',
			].join('\n'),
			'chapters/content.typ': '= 跨文件章节\n跨文件标记：Typst 章节内容。\n',
		},
	},
	{
		owner: 'tags',
		repository: '44',
		fullName: 'tags/44',
		contentType: 'tag-wiki',
		format: 'markdown',
		entry: 'README.md',
		secondary: 'sections/content.md',
		private: false,
		files: {
			'rinspace.yaml': [
				'type: tag-wiki',
				'status: published',
				'sourceVisibility: open',
				'title: Browser fixture Markdown tag',
				'entry: README.md',
				'build:',
				'  format: markdown',
				'metadata:',
				'  rinspaceTagId: "44"',
				'  templateVersion: "1"',
				'',
			].join('\n'),
			'README.md': [
				'# 中文 Markdown 标签',
				'',
				'数学公式 $a^2 + b^2 = c^2$。',
				'',
				'参见 `sections/content.md`。',
				'',
			].join('\n'),
			'sections/content.md':
				'## 跨文件章节\n\n跨文件标记：Markdown 标签内容。\n',
		},
	},
];

async function createRepositories(fixture) {
	const gitRoot = path.join(fixture, 'git-root');
	const projects = new Map();
	for (const scenario of projectScenarios) {
		const worktree = path.join(
			fixture,
			`${scenario.owner}-${scenario.repository}-worktree`,
		);
		const bare = path.join(
			gitRoot,
			scenario.owner,
			`${scenario.repository}.git`,
		);
		await mkdir(worktree, { recursive: true });
		await mkdir(path.dirname(bare), { recursive: true });
		for (const [file, content] of Object.entries(scenario.files)) {
			const destination = path.join(worktree, file);
			await mkdir(path.dirname(destination), { recursive: true });
			await writeFile(destination, content);
		}
		await run('git', ['init', '--initial-branch=main'], { cwd: worktree });
		await run('git', ['config', 'user.name', 'Rinspace Browser Fixture'], {
			cwd: worktree,
		});
		await run(
			'git',
			['config', 'user.email', 'browser-fixture@invalid.example'],
			{ cwd: worktree },
		);
		await run('git', ['add', '.'], { cwd: worktree });
		await run(
			'git',
			['commit', '-m', `fixture: initial managed ${scenario.format} project`],
			{ cwd: worktree },
		);
		const head = (await run('git', ['rev-parse', 'HEAD'], { cwd: worktree }))
			.toString('utf8')
			.trim();
		await run('git', ['clone', '--bare', worktree, bare]);
		projects.set(scenario.fullName, { ...scenario, bare, head });
	}
	return { gitRoot, projects };
}

function parseCgiResponse(output) {
	let separator = output.indexOf(Buffer.from('\r\n\r\n'));
	let separatorLength = 4;
	if (separator < 0) {
		separator = output.indexOf(Buffer.from('\n\n'));
		separatorLength = 2;
	}
	if (separator < 0)
		throw new Error('git http-backend returned no CGI headers');
	const headerText = output.subarray(0, separator).toString('utf8');
	const body = output.subarray(separator + separatorLength);
	let code = 200;
	const headers = [];
	for (const line of headerText.split(/\r?\n/)) {
		const index = line.indexOf(':');
		if (index < 1) continue;
		const name = line.slice(0, index).trim();
		const value = line.slice(index + 1).trim();
		if (name.toLowerCase() === 'status') code = Number.parseInt(value, 10);
		else headers.push({ name, value });
	}
	return { code, headers, body };
}

async function gitResponse(repository, request, url) {
	const prefix = '/repos';
	const pathInfo = url.pathname.slice(prefix.length);
	const input = request.postData
		? Buffer.from(request.postData, 'utf8')
		: undefined;
	const output = await run('git', ['http-backend'], {
		input,
		env: {
			...process.env,
			GIT_HTTP_EXPORT_ALL: '1',
			GIT_PROJECT_ROOT: repository.gitRoot,
			PATH_INFO: pathInfo,
			QUERY_STRING: url.search.slice(1),
			REQUEST_METHOD: request.method,
			CONTENT_TYPE:
				request.headers['Content-Type'] ??
				request.headers['content-type'] ??
				'',
			CONTENT_LENGTH: input ? String(input.byteLength) : '',
			REMOTE_USER: 'rinspace-browser-fixture',
		},
	});
	return parseCgiResponse(output);
}

function requestJSON(request) {
	return request.postData ? JSON.parse(request.postData) : {};
}

function apiResponse(repository, agentFixture, request, url) {
	if (url.pathname === '/api/identity/v1/session') {
		return jsonResponse({
			status: 'authenticated',
			csrfToken: 'fixture-csrf-proof',
			user: { id: 'fixture-user-17', sessionEpoch: 1, identityVersion: 1 },
			currentSession: { sid: 'fixture-session', version: 1 },
		});
	}
	if (url.pathname === '/api/gitea/sso' && request.method === 'POST') {
		return { code: 204, body: Buffer.alloc(0), contentType: 'text/plain' };
	}
	if (url.pathname === '/api/profile') {
		return jsonResponse({ uid: 'fixture-user-17', nickname: '浏览器夹具用户' });
	}
	if (url.pathname === '/repos/') {
		return {
			code: 200,
			body: Buffer.from('<!doctype html><title>fixture Gitea session</title>'),
			contentType: 'text/html; charset=utf-8',
		};
	}
	const projectMatch = url.pathname.match(
		/^\/rinspace\/api\/editor\/v1\/projects\/(a|b|tags)\/([1-9][0-9]*)$/,
	);
	if (projectMatch) {
		const fullName = `${projectMatch[1]}/${projectMatch[2]}`;
		const project = repository.projects.get(fullName);
		if (!project)
			return jsonResponse({ error: 'fixture project not found' }, 404);
		agentFixture.currentProject = fullName;
		return jsonResponse({
			schemaVersion: 'rinspace-editor-projects/v1',
			account: { id: 17, login: 'fixture-user' },
			project: {
				id: Number(project.repository),
				name: project.repository,
				fullName: project.fullName,
				defaultBranch: 'main',
				objectFormat: 'sha1',
				private: project.private,
				archived: false,
				rinspaceContentType: project.contentType,
				permissions: { admin: false, push: true, pull: true },
			},
			ref: url.searchParams.get('ref') ?? 'main',
			remoteHead: project.head,
			commitIdentity: {
				name: 'Rinspace Browser Fixture',
				email: 'browser-fixture@invalid.example',
			},
		});
	}
	if (url.pathname === '/rinspace/api/editor/v1/projects') {
		const limit = Number.parseInt(url.searchParams.get('limit') ?? '12', 10);
		const page = Number.parseInt(url.searchParams.get('page') ?? '1', 10);
		const query = url.searchParams.get('q')?.trim() ?? '';
		const current = repository.projects.get(agentFixture.currentProject);
		const candidates = [current, ...repository.projects.values()]
			.filter(Boolean)
			.filter(
				(project, index, values) =>
					values.findIndex(
						(candidate) => candidate.fullName === project.fullName,
					) === index,
			)
			.filter((project) => query || project.contentType !== 'tag-wiki')
			.filter(
				(project) =>
					!query ||
					project.fullName.toLowerCase().includes(query.toLowerCase()),
			)
			.slice(0, Number.isSafeInteger(limit) && limit > 0 ? limit : 12)
			.map((project) => ({
				id: Number(project.repository),
				name: project.repository,
				fullName: project.fullName,
				description: `${project.format} browser fixture`,
				private: project.private,
				archived: false,
				defaultBranch: 'main',
				objectFormat: 'sha1',
				rinspaceTitle: `${project.format} fixture`,
				rinspaceContentType: project.contentType,
				access: 'owner',
				permissions: { admin: false, push: true, pull: true },
			}));
		return jsonResponse({
			schemaVersion: 'rinspace-editor-projects/v2',
			account: { id: 17, login: 'fixture-user' },
			projects: candidates,
			page,
			pageSize: limit,
			...(query ? { query } : {}),
			hasMore: false,
		});
	}
	if (url.pathname === '/rinspace/api/editor/v1/agent/config') {
		return jsonResponse({
			enabled: true,
			model: 'fixture-model',
			maxIterations: 8,
			maxOutputTokens: 512,
			maxGoodness: 100,
		});
	}
	if (
		url.pathname === '/rinspace/api/editor/v1/agent/runs' &&
		request.method === 'POST'
	) {
		const body = requestJSON(request);
		const fullName = body.binding?.repositoryFullName;
		const project = repository.projects.get(fullName);
		if (!project)
			return jsonResponse({ error: 'fixture binding not found' }, 400);
		const runId = `fixture-${project.owner}-${project.repository}`;
		agentFixture.runs.set(runId, {
			project,
			projectId: body.projectId,
			turns: [],
		});
		return jsonResponse({ id: runId });
	}
	const turnMatch = url.pathname.match(
		/^\/rinspace\/api\/editor\/v1\/agent\/runs\/([^/]+)\/turns$/,
	);
	if (turnMatch && request.method === 'POST') {
		const runId = decodeURIComponent(turnMatch[1]);
		const run = agentFixture.runs.get(runId);
		if (!run) return jsonResponse({ error: 'fixture run not found' }, 404);
		const body = requestJSON(request);
		run.turns.push(body);
		if (run.turns.length === 1) {
			const prefix = `${run.project.format}-${run.project.repository}`;
			return jsonResponse({
				toolCalls: [
					{ id: `${prefix}-list`, name: 'list_project_files', input: {} },
					{
						id: `${prefix}-read`,
						name: 'read_project_files',
						input: {
							files: [
								{ path: run.project.entry },
								{ path: run.project.secondary },
							],
						},
					},
					{
						id: `${prefix}-search`,
						name: 'search_project',
						input: {
							query: '跨文件标记',
							wholeWord: false,
							maxResults: 10,
						},
					},
					{
						id: `${prefix}-diagnostics`,
						name: 'read_compile_diagnostics',
						input: {},
					},
					{
						id: `${prefix}-git`,
						name: 'git_status',
						input: { includeComparisons: true, maxChanges: 10 },
					},
				],
				finishReason: 'tool-calls',
				requestId: `${prefix}-request-1`,
				usage: {
					inputTokens: 20,
					outputTokens: 10,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
				},
			});
		}
		if (run.turns.length === 2) {
			return jsonResponse({
				text: `完成 ${run.project.format} 只读验收`,
				toolCalls: [],
				finishReason: 'stop',
				requestId: `${run.project.format}-${run.project.repository}-request-2`,
				usage: {
					inputTokens: 40,
					outputTokens: 8,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
				},
			});
		}
		return jsonResponse({ error: 'unexpected fixture turn' }, 409);
	}
	const abortMatch = url.pathname.match(
		/^\/rinspace\/api\/editor\/v1\/agent\/runs\/([^/]+)\/abort$/,
	);
	if (abortMatch && request.method === 'POST') {
		return { code: 204, body: Buffer.alloc(0), contentType: 'text/plain' };
	}
	return null;
}

async function waitForManagedProject(
	client,
	scenario,
	interceptionErrors,
	requests,
) {
	const requestOffset = requests.length;
	await client.send('Page.navigate', {
		url: `https://rinspace.com/editor/?mode=managed&owner=${scenario.owner}&repository=${scenario.repository}`,
	});
	const deadline = Date.now() + timeoutMs;
	let pageState;
	while (Date.now() < deadline) {
		if (interceptionErrors.length)
			throw new Error(interceptionErrors.join('\n'));
		pageState = await evaluate(
			client,
			`({
				ready: Boolean(document.querySelector('header[data-role="editor"]')),
				agent: Boolean(document.querySelector('section[data-role="agent"]')),
				status: document.querySelector('section[data-role="agent"] .ui-badge')?.textContent?.trim(),
				hash: location.hash,
				origin: location.origin,
				bodyText: document.body?.innerText?.slice(0, 4000)
			})`,
		);
		if (pageState.ready && pageState.agent && pageState.status === '就绪') {
			break;
		}
		await wait(100);
	}
	assert.equal(pageState?.origin, 'https://rinspace.com');
	assert.equal(
		pageState?.ready,
		true,
		`${scenario.fullName} did not reach the real editor: ${JSON.stringify(pageState)}`,
	);
	assert.equal(
		pageState?.agent,
		true,
		`${scenario.fullName} did not lazy-mount the Agent panel: ${JSON.stringify(pageState)}`,
	);
	assert.equal(
		pageState?.status,
		'就绪',
		`${scenario.fullName} Agent config did not reach ready`,
	);
	assert.match(pageState?.hash ?? '', /^#yjs:/);
	const projectRequests = requests.slice(requestOffset);
	assert.ok(
		projectRequests.some((request) =>
			request.includes(
				`/repos/${scenario.fullName}.git/info/refs?service=git-upload-pack`,
			),
		),
		`${scenario.fullName} did not use Git Smart HTTP discovery`,
	);
	assert.ok(
		projectRequests.some((request) =>
			request.includes(`/repos/${scenario.fullName}.git/git-upload-pack`),
		),
		`${scenario.fullName} did not fetch the Git pack`,
	);
	return pageState;
}

function toolResults(turn) {
	return (turn.messages ?? [])
		.flatMap((message) => message.content ?? [])
		.filter((part) => part.type === 'tool-result');
}

function verifyReadOnlyRun(run) {
	assert.equal(run.turns.length, 2, `${run.project.fullName} turn count`);
	const results = toolResults(run.turns[1]);
	assert.equal(results.length, 5, `${run.project.fullName} tool result count`);
	const byName = new Map(results.map((result) => [result.toolName, result]));
	for (const name of [
		'list_project_files',
		'read_project_files',
		'search_project',
		'read_compile_diagnostics',
		'git_status',
	]) {
		const result = byName.get(name);
		assert.ok(result, `${run.project.fullName} omitted ${name}`);
		assert.notEqual(
			result.isError,
			true,
			`${run.project.fullName} failed ${name}`,
		);
		assert.equal(
			result.output?.ok,
			true,
			`${run.project.fullName} ${name} did not return ok`,
		);
		assert.equal(
			result.output.projectId,
			run.projectId,
			`${run.project.fullName} ${name} crossed the active project boundary`,
		);
	}

	const listed = byName.get('list_project_files').output.entries;
	assert.ok(Array.isArray(listed));
	const allowedPaths = new Set([
		'rinspace.yaml',
		run.project.entry,
		run.project.secondary,
		path.posix.dirname(run.project.secondary),
	]);
	assert.ok(
		listed.every((entry) => allowedPaths.has(entry.path)),
		`${run.project.fullName} listed data outside its repository`,
	);
	for (const expected of [
		'rinspace.yaml',
		run.project.entry,
		run.project.secondary,
	]) {
		assert.ok(
			listed.some(
				(entry) => entry.path === expected && typeof entry.fileId === 'string',
			),
			`${run.project.fullName} did not list ${expected} with a file ID`,
		);
	}

	const readFiles = byName.get('read_project_files').output.files;
	assert.ok(Array.isArray(readFiles));
	for (const expected of [run.project.entry, run.project.secondary]) {
		const file = readFiles.find((candidate) => candidate.path === expected);
		assert.ok(file, `${run.project.fullName} did not read ${expected}`);
		assert.equal(file.content, run.project.files[expected]);
		assert.equal(typeof file.fileId, 'string');
		assert.match(file.contentSha256, /^[0-9a-f]{64}$/);
		assert.ok(Number.isSafeInteger(file.bytes) && file.bytes > 0);
	}
	assert.match(
		readFiles.find((file) => file.path === run.project.entry).content,
		/中文/u,
	);
	assert.match(
		readFiles.find((file) => file.path === run.project.entry).content,
		/\$[^\n]+\$/u,
	);
	assert.match(
		readFiles.find((file) => file.path === run.project.secondary).content,
		/跨文件标记/u,
	);

	const searched = byName.get('search_project').output.results;
	assert.ok(Array.isArray(searched));
	assert.ok(
		searched.every((result) => result.path === run.project.secondary),
		`${run.project.fullName} search returned another workspace path`,
	);
	const secondaryMatch = searched.find(
		(result) => result.path === run.project.secondary,
	);
	assert.ok(
		secondaryMatch,
		`${run.project.fullName} search missed the secondary file`,
	);
	assert.match(secondaryMatch.contentSha256, /^[0-9a-f]{64}$/);
	assert.ok(
		secondaryMatch.matches.some((match) =>
			String(match.text).includes('跨文件标记'),
		),
	);

	const sources = byName.get('read_compile_diagnostics').output.sources;
	assert.ok(Array.isArray(sources) && sources.length >= 4);
	for (const source of sources) {
		assert.equal(typeof source.id, 'string');
		assert.ok(Array.isArray(source.diagnostics));
	}

	const git = byName.get('git_status').output;
	assert.equal(git.initialized, true);
	assert.equal(git.branch, 'main');
	assert.equal(git.headOid, run.project.head);
	assert.equal(git.worktreeBaseOid, run.project.head);
	assert.deepEqual(git.changes, []);
	assert.deepEqual(git.worktreeChanges, []);
	assert.deepEqual(git.comparisons, []);
}

async function runReadOnlyAgentProject(client, scenario, agentFixture) {
	await evaluate(
		client,
		`(() => {
			const panel = document.querySelector('section[data-role="agent"]');
			if (!panel) throw new Error('Agent panel is unavailable');
			window.__rinspaceFixtureApprovalSeen = 0;
			new MutationObserver(() => {
				if (panel.textContent?.includes('确认 Push')) {
					window.__rinspaceFixtureApprovalSeen += 1;
				}
			}).observe(panel, { childList: true, subtree: true, characterData: true });
			const textarea = panel.querySelector('textarea');
			if (!(textarea instanceof HTMLTextAreaElement)) throw new Error('Agent textarea is unavailable');
			const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
			if (!setter) throw new Error('Textarea value setter is unavailable');
			setter.call(textarea, ${JSON.stringify('自动运行五个只读工具并报告结果')});
			textarea.dispatchEvent(new Event('input', { bubbles: true }));
		})()`,
	);
	const sendDeadline = Date.now() + 3_000;
	let sent = false;
	while (!sent && Date.now() < sendDeadline) {
		sent = await evaluate(
			client,
			`(() => {
				const button = [...document.querySelectorAll('section[data-role="agent"] button')]
					.find(candidate => candidate.textContent?.trim() === '发送');
				if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
				button.click();
				return true;
			})()`,
		);
		if (!sent) await wait(50);
	}
	assert.equal(sent, true, `${scenario.fullName} Agent prompt was not sent`);

	const runId = `fixture-${scenario.owner}-${scenario.repository}`;
	const deadline = Date.now() + timeoutMs;
	let taskState;
	while (Date.now() < deadline) {
		const run = agentFixture.runs.get(runId);
		taskState = await evaluate(
			client,
			`(() => {
				const panel = document.querySelector('section[data-role="agent"]');
				return {
					status: panel?.querySelector('.ui-badge')?.textContent?.trim(),
					text: panel?.textContent?.slice(-16000),
					error: panel?.querySelector('.ui-message[data-tone="error"]')?.textContent,
					approvalSeen: window.__rinspaceFixtureApprovalSeen ?? 0,
				};
			})()`,
		);
		if (taskState.error) {
			throw new Error(
				`${scenario.fullName} Agent UI error: ${taskState.error}`,
			);
		}
		assert.equal(
			taskState.approvalSeen,
			0,
			`${scenario.fullName} requested approval for read-only tools`,
		);
		if (
			run?.turns.length === 2 &&
			taskState.status === '就绪' &&
			taskState.text?.includes(`完成 ${scenario.format} 只读验收`)
		) {
			verifyReadOnlyRun(run);
			return;
		}
		await wait(50);
	}
	throw new Error(
		`${scenario.fullName} read-only Agent run timed out: ${JSON.stringify(taskState)}`,
	);
}

const profile = await mkdtemp(
	path.join(os.tmpdir(), 'rinspace-agent-managed-browser-'),
);
const fixture = await mkdtemp(
	path.join(os.tmpdir(), 'rinspace-agent-managed-git-'),
);
let browser;
let client;
let stderr = '';
const interceptionErrors = [];
const requests = [];
const browserErrors = [];
const agentFixture = { runs: new Map() };
let state;
try {
	await access(path.join(dist, 'index.html'));
	const repository = await createRepositories(fixture);
	const port = await availablePort();
	browser = spawn(
		await browserBinary(),
		[
			'--headless=new',
			'--no-sandbox',
			'--disable-dev-shm-usage',
			'--disable-background-networking',
			'--disable-component-update',
			'--disable-default-apps',
			'--disable-sync',
			'--metrics-recording-only',
			'--no-first-run',
			'--remote-debugging-address=127.0.0.1',
			`--remote-debugging-port=${port}`,
			`--user-data-dir=${profile}`,
			'about:blank',
		],
		{ stdio: ['ignore', 'ignore', 'pipe'] },
	);
	browser.stderr.setEncoding('utf8');
	browser.stderr.on('data', (chunk) => {
		stderr = `${stderr}${chunk}`.slice(-16_384);
	});

	const page = await pageTarget(port);
	client = new DevToolsClient(page.webSocketDebuggerUrl);
	client.on('Runtime.exceptionThrown', ({ exceptionDetails }) => {
		browserErrors.push(
			exceptionDetails.exception?.description ??
				exceptionDetails.text ??
				'Unknown browser exception',
		);
	});
	client.on('Log.entryAdded', ({ entry }) => {
		if (entry.level === 'error') browserErrors.push(entry.text);
	});
	client.on('Fetch.requestPaused', (event) => {
		void (async () => {
			const url = new URL(event.request.url);
			requests.push(`${event.request.method} ${url.pathname}${url.search}`);
			let response = apiResponse(repository, agentFixture, event.request, url);
			if (
				!response &&
				/^\/repos\/(?:a|b|tags)\/[1-9][0-9]*\.git\//.test(url.pathname)
			) {
				const git = await gitResponse(repository, event.request, url);
				await client.send('Fetch.fulfillRequest', {
					requestId: event.requestId,
					responseCode: git.code,
					responseHeaders: git.headers,
					body: git.body.toString('base64'),
				});
				return;
			}
			response ??= await staticResponse(url);
			response ??= {
				code: 404,
				body: Buffer.from('fixture route not found'),
				contentType: 'text/plain; charset=utf-8',
			};
			await client.send('Fetch.fulfillRequest', {
				requestId: event.requestId,
				responseCode: response.code,
				responseHeaders: responseHeaders(
					response.contentType,
					response.body.byteLength,
				),
				body: response.body.toString('base64'),
			});
		})().catch(async (error) => {
			interceptionErrors.push(
				error instanceof Error ? (error.stack ?? error.message) : String(error),
			);
			try {
				await client.send('Fetch.failRequest', {
					requestId: event.requestId,
					errorReason: 'Failed',
				});
			} catch {
				// Navigation failure will expose the original interception error below.
			}
		});
	});
	await Promise.all([
		client.send('Fetch.enable', {
			patterns: [
				{ urlPattern: 'https://rinspace.com/*', requestStage: 'Request' },
			],
		}),
		client.send('Page.enable'),
		client.send('Runtime.enable'),
		client.send('Log.enable'),
		client.send('Network.enable'),
	]);
	await client.send('Network.setBypassServiceWorker', { bypass: true });
	await client.send('Emulation.setDeviceMetricsOverride', {
		width: 1200,
		height: 800,
		deviceScaleFactor: 1,
		mobile: false,
	});
	state = await waitForManagedProject(
		client,
		projectScenarios[0],
		interceptionErrors,
		requests,
	);

	const themePlugins = [
		['texlyre-wide-theme', 'texlyre-wide'],
		['texlyre-compact-theme', 'texlyre-compact'],
		['texlyre-slim-theme', 'texlyre-slim'],
		['texlyre-mobile-theme', 'texlyre-mobile'],
	];
	const themeCases = [
		...[
			'light',
			'dark',
			'monokai',
			'tomorrow_night_blue',
			'nord',
			'deuteranopia',
			'protanopia',
			'tritanopia',
			'solarized_light',
			'atom_light',
		].map((variant) => ({
			setting: variant,
			expected: variant,
			media: 'light',
		})),
		{ setting: 'system', expected: 'light', media: 'light' },
		{ setting: 'system', expected: 'dark', media: 'dark' },
	];
	const checkedThemes = [];
	for (const [plugin, layout] of themePlugins) {
		const mobile = plugin === 'texlyre-mobile-theme';
		await client.send('Emulation.setDeviceMetricsOverride', {
			width: mobile ? 390 : 1200,
			height: mobile ? 844 : 800,
			deviceScaleFactor: 1,
			mobile,
		});
		for (const themeCase of themeCases) {
			await client.send('Emulation.setEmulatedMedia', {
				features: [{ name: 'prefers-color-scheme', value: themeCase.media }],
			});
			await evaluate(
				client,
				`(async () => {
					const userId = localStorage.getItem('texlyre-current-user');
					if (!userId) throw new Error('managed local profile is unavailable');
					const key = 'texlyre-user-' + userId + '-settings';
					const settings = JSON.parse(localStorage.getItem(key) || '{}');
					settings['theme-plugin'] = ${JSON.stringify(plugin)};
					settings['theme-variant'] = ${JSON.stringify(themeCase.setting)};
					localStorage.setItem(key, JSON.stringify(settings));
					if (['light', 'dark', 'system'].includes(${JSON.stringify(themeCase.setting)})) {
						localStorage.setItem('rinspace-theme-v2', ${JSON.stringify(themeCase.setting)});
						window.dispatchEvent(new Event('rinspace-theme-changed'));
					}
					window.dispatchEvent(new CustomEvent('chelys-account-store-changed', { detail: { store: 'settings' } }));
					const expectedTheme = ${JSON.stringify(themeCase.expected)};
					const expectedLayout = ${JSON.stringify(layout)};
					const deadline = Date.now() + 3000;
					while ((document.documentElement.dataset.theme !== expectedTheme || document.documentElement.dataset.layout !== expectedLayout) && Date.now() < deadline) {
						await new Promise(resolve => setTimeout(resolve, 20));
					}
				})()`,
			);
			await keyboardFocusAgentTextarea(client);
			const sample = await evaluate(
				client,
				`(() => {
					const parseColor = value => {
						const parts = value.match(/[\\d.]+/g)?.map(Number) ?? [];
						return { r: parts[0] ?? 0, g: parts[1] ?? 0, b: parts[2] ?? 0, a: parts[3] ?? 1 };
					};
					const composite = (front, back) => ({
						r: front.r * front.a + back.r * (1 - front.a),
						g: front.g * front.a + back.g * (1 - front.a),
						b: front.b * front.a + back.b * (1 - front.a),
						a: front.a + back.a * (1 - front.a),
					});
					const background = element => {
						const layers = [];
						for (let current = element; current instanceof Element; current = current.parentElement) {
							layers.push(parseColor(getComputedStyle(current).backgroundColor));
						}
						let result = { r: 255, g: 255, b: 255, a: 1 };
						for (const layer of layers.reverse()) result = composite(layer, result);
						return result;
					};
					const luminance = color => {
						const channel = value => {
							const normalized = value / 255;
							return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
						};
						return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
					};
					const contrast = element => {
						const foreground = composite(parseColor(getComputedStyle(element).color), background(element));
						const foregroundLuminance = luminance(foreground);
						const backgroundLuminance = luminance(background(element));
						return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
					};
					const panel = document.querySelector('section[data-role="agent"]');
					const textarea = panel?.querySelector('textarea');
					const usage = panel?.querySelector('.rinspace-agent-usage');
					if (!(panel instanceof HTMLElement) || !(textarea instanceof HTMLElement) || !(usage instanceof HTMLElement)) throw new Error('Agent controls disappeared');
					const panelRect = panel.getBoundingClientRect();
					const textStyle = getComputedStyle(textarea);
					const usageStyle = getComputedStyle(usage);
					return {
						theme: document.documentElement.dataset.theme,
						mode: document.documentElement.dataset.themeMode,
						layout: document.documentElement.dataset.layout,
						focused: document.activeElement === textarea,
						focusVisible: textStyle.outlineStyle !== 'none' || textStyle.boxShadow !== 'none',
						panelVisible: panelRect.width > 0 && panelRect.height > 0,
						withinViewport: panelRect.left >= -1 && panelRect.right <= innerWidth + 1 && panelRect.top >= -1 && panelRect.bottom <= innerHeight + 1,
						horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
						textColor: textStyle.color,
						textBackground: textStyle.backgroundColor,
						usageColor: usageStyle.color,
						usageBackground: usageStyle.backgroundColor,
						textareaContrast: contrast(textarea),
						usageContrast: contrast(usage),
					};
				})()`,
			);
			const caseName = `${themeCase.setting}-${themeCase.media}`;
			assert.equal(
				sample.theme,
				themeCase.expected,
				`${plugin} did not apply ${caseName}`,
			);
			assert.equal(
				sample.layout,
				layout,
				`${plugin} did not apply its native layout`,
			);
			assert.equal(
				sample.focused,
				true,
				`${plugin}/${caseName} textarea is not keyboard focusable`,
			);
			assert.equal(
				sample.focusVisible,
				true,
				`${plugin}/${caseName} textarea has no visible focus style`,
			);
			assert.equal(
				sample.panelVisible,
				true,
				`${plugin}/${caseName} panel is hidden`,
			);
			assert.equal(
				sample.withinViewport,
				true,
				`${plugin}/${caseName} panel left the viewport`,
			);
			assert.equal(
				sample.horizontalOverflow,
				false,
				`${plugin}/${caseName} caused horizontal overflow`,
			);
			assert.notEqual(
				sample.textColor,
				sample.textBackground,
				`${plugin}/${caseName} textarea lost contrast`,
			);
			assert.notEqual(
				sample.usageColor,
				sample.usageBackground,
				`${plugin}/${caseName} usage lost contrast`,
			);
			assert.ok(
				sample.textareaContrast >= 4.5,
				`${plugin}/${caseName} textarea contrast is ${sample.textareaContrast}`,
			);
			assert.ok(
				sample.usageContrast >= 4.5,
				`${plugin}/${caseName} usage contrast is ${sample.usageContrast}`,
			);
			checkedThemes.push(`${plugin}/${caseName}`);
		}
	}

	for (const [index, scenario] of projectScenarios.entries()) {
		await client.send('Emulation.setDeviceMetricsOverride', {
			width: 1200,
			height: 800,
			deviceScaleFactor: 1,
			mobile: false,
		});
		await client.send('Emulation.setEmulatedMedia', {
			features: [{ name: 'prefers-color-scheme', value: 'light' }],
		});
		await evaluate(
			client,
			`(async () => {
				const userId = localStorage.getItem('texlyre-current-user');
				if (!userId) throw new Error('managed local profile is unavailable');
				const key = 'texlyre-user-' + userId + '-settings';
				const settings = JSON.parse(localStorage.getItem(key) || '{}');
				settings['theme-plugin'] = 'texlyre-wide-theme';
				settings['theme-variant'] = 'light';
				localStorage.setItem(key, JSON.stringify(settings));
				localStorage.setItem('rinspace-theme-v2', 'light');
				window.dispatchEvent(new Event('rinspace-theme-changed'));
				window.dispatchEvent(new CustomEvent('chelys-account-store-changed', { detail: { store: 'settings' } }));
				const deadline = Date.now() + 3000;
				while ((document.documentElement.dataset.theme !== 'light' || document.documentElement.dataset.layout !== 'texlyre-wide') && Date.now() < deadline) {
					await new Promise(resolve => setTimeout(resolve, 20));
				}
			})()`,
		);
		if (index > 0) {
			state = await waitForManagedProject(
				client,
				scenario,
				interceptionErrors,
				requests,
			);
		}
		await runReadOnlyAgentProject(client, scenario, agentFixture);
	}

	assert.equal(agentFixture.runs.size, projectScenarios.length);
	const completedRuns = [...agentFixture.runs.values()];
	assert.equal(
		completedRuns.reduce(
			(total, run) => total + toolResults(run.turns[1]).length,
			0,
		),
		15,
	);

	process.stdout.write(
		`${JSON.stringify(
			{
				mode: 'managed-fixture',
				origin: state.origin,
				editorReady: state.ready,
				agentMounted: state.agent,
				gitHead: repository.projects.get('a/42').head,
				gitHeads: Object.fromEntries(
					[...repository.projects].map(([name, project]) => [
						name,
						project.head,
					]),
				),
				smartHttpDiscovery: true,
				smartHttpPack: true,
				themeCombinations: checkedThemes.length,
				managedToolProjects: completedRuns.length,
				automaticToolResults: completedRuns.reduce(
					(total, run) => total + toolResults(run.turns[1]).length,
					0,
				),
				approvalRequests: 0,
				observedRequests: requests.length,
			},
			null,
			2,
		)}\n`,
	);
} catch (error) {
	if (stderr) process.stderr.write(stderr);
	if (interceptionErrors.length)
		process.stderr.write(`${interceptionErrors.join('\n')}\n`);
	if (browserErrors.length)
		process.stderr.write(`Browser errors:\n${browserErrors.join('\n')}\n`);
	process.stderr.write(`Last page state:\n${JSON.stringify(state, null, 2)}\n`);
	process.stderr.write(`Request tail:\n${requests.slice(-40).join('\n')}\n`);
	throw error;
} finally {
	try {
		await client?.send('Browser.close');
	} catch {
		// The browser may already have exited after a failed page load.
	}
	client?.close();
	if (browser?.exitCode === null) browser.kill('SIGTERM');
	await Promise.all([
		rm(profile, { recursive: true, force: true }),
		rm(fixture, { recursive: true, force: true }),
	]);
}
