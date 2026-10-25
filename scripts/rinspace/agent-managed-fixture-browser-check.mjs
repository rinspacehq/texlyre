// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
	access,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	stat,
	writeFile,
} from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
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

const runCommand = run;

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
				clearTimeout(pending.timeout);
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
			const timeout = setTimeout(() => {
				if (!this.#pending.delete(id)) return;
				reject(
					new Error(
						`${method} timed out after ${timeoutMs}ms`,
					),
				);
			}, timeoutMs);
			this.#pending.set(id, { resolve, reject, timeout });
			this.socket.send(JSON.stringify({ id, method, params }));
		});
	}

	close() {
		this.socket.close();
	}
}

async function availablePort() {
	const server = createNetServer();
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

async function startLargeAssetServer() {
	const server = createHttpServer((request, response) => {
		void (async () => {
			if (request.method === 'OPTIONS') {
				response.writeHead(204, {
					'Access-Control-Allow-Methods': 'GET, OPTIONS',
					'Access-Control-Allow-Origin': 'https://rinspace.com',
					'Access-Control-Allow-Private-Network': 'true',
				}).end();
				return;
			}
			if (request.method !== 'GET') {
				response.writeHead(405, { Allow: 'GET, OPTIONS' }).end();
				return;
			}
			const url = new URL(request.url ?? '/', 'http://127.0.0.1');
			const pathname = decodeURIComponent(url.pathname);
			if (!pathname.startsWith('/editor/') || pathname.includes('\0')) {
				response.writeHead(404).end();
				return;
			}
			const candidate = path.resolve(dist, pathname.slice('/editor/'.length));
			if (candidate === dist || !candidate.startsWith(`${dist}${path.sep}`)) {
				response.writeHead(404).end();
				return;
			}
			let info;
			try {
				info = await stat(candidate);
			} catch {
				response.writeHead(404).end();
				return;
			}
			if (!info.isFile()) {
				response.writeHead(404).end();
				return;
			}
			response.writeHead(200, {
				'Access-Control-Allow-Origin': 'https://rinspace.com',
				'Access-Control-Allow-Private-Network': 'true',
				'Cache-Control': 'no-store',
				'Content-Length': String(info.size),
				'Content-Type':
					mimeTypes.get(path.extname(candidate).toLowerCase()) ??
					'application/octet-stream',
			});
			createReadStream(candidate).pipe(response);
		})().catch((error) => {
			response.destroy(error instanceof Error ? error : new Error(String(error)));
		});
	});
	await new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolve);
	});
	const address = server.address();
	assert.ok(address && typeof address === 'object');
	return {
		origin: `http://127.0.0.1:${address.port}`,
		close: () =>
			new Promise((resolve, reject) =>
				server.close((error) => (error ? reject(error) : resolve())),
			),
	};
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

async function createPageTarget(port) {
	const response = await fetch(
		`http://127.0.0.1:${port}/json/new?${encodeURIComponent('about:blank')}`,
		{
			method: 'PUT',
			signal: AbortSignal.timeout(timeoutMs),
		},
	);
	assert.equal(
		response.ok,
		true,
		`Chromium refused to create a page target: ${response.status}`,
	);
	const page = await response.json();
	assert.equal(
		typeof page.webSocketDebuggerUrl,
		'string',
		'Chromium created a page without a DevTools WebSocket URL',
	);
	return page;
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

async function staticResponse(url, largeAssetOrigin) {
	const pathname = decodeURIComponent(url.pathname);
	let relative =
		pathname === '/editor/' ? 'index.html' : pathname.slice('/editor/'.length);
	if (!pathname.startsWith('/editor/') || relative.includes('\0')) return null;
	if (!relative || relative.endsWith('/')) relative += 'index.html';
	const candidate = path.resolve(dist, relative);
	if (candidate !== dist && !candidate.startsWith(`${dist}${path.sep}`))
		return null;
	try {
		const info = await stat(candidate);
		if (!info.isFile()) return null;
		if (info.size > 64 * 1024 * 1024) {
			return {
				code: 302,
				body: Buffer.alloc(0),
				contentType: 'text/plain; charset=utf-8',
				extraHeaders: [
					{
						name: 'Location',
						value: `${largeAssetOrigin}${url.pathname}`,
					},
				],
			};
		}
		const body = await readFile(candidate);
		return {
			code: 200,
			body,
			contentType:
				mimeTypes.get(path.extname(candidate).toLowerCase()) ??
				'application/octet-stream',
			extraHeaders: [],
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
		await run('git', ['config', '--file', path.join(bare, 'config'), 'http.receivepack', 'true']);
		projects.set(scenario.fullName, { ...scenario, bare, head, initialHead: head });
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
	const encodedEntries = request.postDataEntries
		?.map((entry) => entry.bytes)
		.filter((bytes) => typeof bytes === 'string');
	const input = encodedEntries?.length
		? Buffer.concat(encodedEntries.map((bytes) => Buffer.from(bytes, 'base64')))
		: request.postData
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
	const response = parseCgiResponse(output);
	const pushed = pathInfo.match(
		/^\/(a|b|tags)\/([1-9][0-9]*)\.git\/git-receive-pack$/,
	);
	if (pushed) {
		const project = repository.projects.get(`${pushed[1]}/${pushed[2]}`);
		if (!project) throw new Error('Git Push targeted an unknown fixture project');
		project.head = (
			await run(
				'git',
				['--git-dir', project.bare, 'rev-parse', 'refs/heads/main'],
			)
		)
			.toString('utf8')
			.trim();
		project.pushCount = (project.pushCount ?? 0) + 1;
	}
	return response;
}

function requestJSON(request) {
	return request.postData ? JSON.parse(request.postData) : {};
}

const emptyUsage = () => ({
	inputTokens: 0,
	outputTokens: 0,
	cacheReadTokens: 0,
	cacheWriteTokens: 0,
});

function addUsage(base, current) {
	return {
		inputTokens: base.inputTokens + current.inputTokens,
		outputTokens: base.outputTokens + current.outputTokens,
		cacheReadTokens: base.cacheReadTokens + current.cacheReadTokens,
		cacheWriteTokens: base.cacheWriteTokens + current.cacheWriteTokens,
	};
}

function confirmedTurnResponse(run, requestBody, responseBody) {
	assert.match(
		requestBody.operationKey,
		/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
	);
	run.confirmedTurns.push({
		iteration: run.turns.length,
		operationId: requestBody.operationKey,
		text: responseBody.text ?? '',
		toolCalls: (responseBody.toolCalls ?? []).map((call) => ({
			id: call.id,
			name: call.name,
		})),
		finishReason: responseBody.finishReason,
		requestId: responseBody.requestId,
		usage: responseBody.usage,
		createdAt: new Date(
			Date.UTC(2026, 9, 25, 23, 0, run.turns.length),
		).toISOString(),
	});
	run.usage = addUsage(run.usage, responseBody.usage);
	return jsonResponse(responseBody);
}

async function apiResponse(repository, agentFixture, request, url) {
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
			confirmedTurns: [],
			usage: emptyUsage(),
			recoveryReads: 0,
			abortCount: 0,
			write: {
				patchMarker: `琳自动修改：${project.format} 中文与数学 $q^2$。\n`,
				collaboratorText: `协作者并发输入：中文 English 数学 $u^2$；${'连续输入'.repeat(32)}。`,
				staleReplacement: '过期 Agent 内容不应出现。\n',
				temporaryPath: `agent-note-${project.repository}.txt`,
				renamedPath: `agent-renamed-${project.repository}.txt`,
				temporaryContent: `琳临时文件 ${project.format}\n数学 $q^2$\n`,
			},
		});
		return jsonResponse({ id: runId });
	}
	const runMatch = url.pathname.match(
		/^\/rinspace\/api\/editor\/v1\/agent\/runs\/([^/]+)$/,
	);
	if (runMatch && request.method === 'GET') {
		const runId = decodeURIComponent(runMatch[1]);
		const run = agentFixture.runs.get(runId);
		if (!run) return jsonResponse({ error: 'fixture run not found' }, 404);
		if (agentFixture.failNextRecovery) {
			agentFixture.failNextRecovery = false;
			return jsonResponse({ error: 'fixture recovery unavailable' }, 503);
		}
		run.recoveryReads += 1;
		return jsonResponse({
			id: runId,
			projectId: run.projectId,
			status: 'ACTIVE',
			usage: run.usage,
			confirmedTurns: run.confirmedTurns,
		});
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
			return confirmedTurnResponse(run, body, {
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
			const read = toolResults(body).find(
				(result) => result.toolName === 'read_project_files',
			);
			const entry = read?.output?.files?.find(
				(file) => file.path === run.project.entry,
			);
			if (
				!entry ||
				typeof entry.fileId !== 'string' ||
				typeof entry.content !== 'string' ||
				typeof entry.contentSha256 !== 'string'
			) {
				return jsonResponse(
					{ error: 'fixture read result is incomplete' },
					409,
				);
			}
			run.write.entryFileId = entry.fileId;
			run.write.originalContent = entry.content;
			run.write.originalSha256 = entry.contentSha256;
			const appendLine = entry.content.split('\n').length;
			const prefix = `${run.project.format}-${run.project.repository}`;
			return confirmedTurnResponse(run, body, {
				toolCalls: [
					{
						id: `${prefix}-patch`,
						name: 'apply_project_patch',
						input: {
							path: run.project.entry,
							expectedSha256: entry.contentSha256,
							edits: [
								{
									startLine: appendLine,
									startColumn: 1,
									endLine: appendLine,
									endColumn: 1,
									replacement: run.write.patchMarker,
								},
							],
						},
					},
					{
						id: `${prefix}-create`,
						name: 'create_project_file',
						input: {
							path: run.write.temporaryPath,
							content: run.write.temporaryContent,
						},
					},
					{
						id: `${prefix}-rename`,
						name: 'rename_project_file',
						input: {
							path: run.write.temporaryPath,
							newPath: run.write.renamedPath,
							expectedSha256: createHash('sha256')
								.update(run.write.temporaryContent)
								.digest('hex'),
						},
					},
					{
						id: `${prefix}-delete`,
						name: 'delete_project_file',
						input: {
							path: run.write.renamedPath,
							expectedSha256: createHash('sha256')
								.update(run.write.temporaryContent)
								.digest('hex'),
						},
					},
				],
				finishReason: 'tool-calls',
				requestId: `${run.project.format}-${run.project.repository}-request-2`,
				usage: {
					inputTokens: 40,
					outputTokens: 24,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
				},
			});
		}
		if (run.turns.length === 3) {
			const patch = toolResults(body).find(
				(result) => result.toolName === 'apply_project_patch',
			);
			if (typeof patch?.output?.afterSha256 !== 'string') {
				return jsonResponse(
					{ error: 'fixture patch result is incomplete' },
					409,
				);
			}
			run.write.afterPatchSha256 = patch.output.afterSha256;
			run.awaitingCollaborator = true;
			await new Promise((resolve) => {
				run.releaseAfterCollaborator = resolve;
			});
			run.awaitingCollaborator = false;
			delete run.releaseAfterCollaborator;
			const prefix = `${run.project.format}-${run.project.repository}`;
			return confirmedTurnResponse(run, body, {
				toolCalls: [
					{
						id: `${prefix}-verify-list`,
						name: 'list_project_files',
						input: {},
					},
					{
						id: `${prefix}-verify-read`,
						name: 'read_project_files',
						input: { files: [{ path: run.project.entry }] },
					},
					{
						id: `${prefix}-verify-git`,
						name: 'git_status',
						input: { includeComparisons: true, maxChanges: 10 },
					},
					{
						id: `${prefix}-stale-patch`,
						name: 'apply_project_patch',
						input: {
							path: run.project.entry,
							expectedSha256: run.write.afterPatchSha256,
							edits: [
								{
									startLine: 1,
									startColumn: 1,
									endLine: 1,
									endColumn: 1,
									replacement: run.write.staleReplacement,
								},
							],
						},
					},
				],
				finishReason: 'tool-calls',
				requestId: `${prefix}-request-3`,
				usage: {
					inputTokens: 64,
					outputTokens: 20,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
				},
			});
		}
		if (run.turns.length === 4) {
			const prefix = `${run.project.format}-${run.project.repository}`;
			return confirmedTurnResponse(run, body, {
				toolCalls: [
					{
						id: `${prefix}-compile`,
						name: 'compile_project',
						input: {},
					},
					{
						id: `${prefix}-commit`,
						name: 'create_git_commit',
						input: {
							message: `agent: verify ${run.project.format} managed flow`,
						},
					},
				],
				finishReason: 'tool-calls',
				requestId: `${run.project.format}-${run.project.repository}-request-4`,
				usage: {
					inputTokens: 80,
					outputTokens: 18,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
				},
			});
		}
		if (run.turns.length === 5) {
			const results = toolResults(body);
			const compiled = results.find(
				(result) => result.toolName === 'compile_project',
			);
			const committed = results.find(
				(result) => result.toolName === 'create_git_commit',
			);
			if (
				compiled?.isError ||
				compiled?.output?.ok !== true ||
				compiled.output.status !== 'success' ||
				committed?.isError ||
				committed?.output?.ok !== true ||
				typeof committed.output.commitOid !== 'string'
			) {
				return jsonResponse(
					{ error: 'fixture compile or commit result is incomplete' },
					409,
				);
			}
			run.delivery = {
				compile: compiled.output,
				commit: committed.output,
			};
			const prefix = `${run.project.format}-${run.project.repository}`;
			return confirmedTurnResponse(run, body, {
				toolCalls: [
					{
						id: `${prefix}-push`,
						name: 'push_git_commits',
						input: {},
					},
				],
				finishReason: 'tool-calls',
				requestId: `${prefix}-request-5`,
				usage: {
					inputTokens: 96,
					outputTokens: 8,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
				},
			});
		}
		if (run.turns.length === 6) {
			const pushed = toolResults(body).find(
				(result) => result.toolName === 'push_git_commits',
			);
			if (
				pushed?.isError ||
				pushed?.output?.ok !== true ||
				pushed.output.canonicalOid !== run.delivery?.commit?.commitOid
			) {
				return jsonResponse(
					{ error: 'fixture Push result is incomplete' },
					409,
				);
			}
			run.delivery.push = pushed.output;
			return confirmedTurnResponse(run, body, {
				text: `完成 ${run.project.format} 安全写入、编译、提交与 Push 验收`,
				toolCalls: [],
				finishReason: 'stop',
				requestId: `${run.project.format}-${run.project.repository}-request-6`,
				usage: {
					inputTokens: 112,
					outputTokens: 12,
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
		const run = agentFixture.runs.get(decodeURIComponent(abortMatch[1]));
		if (!run) return jsonResponse({ error: 'fixture run not found' }, 404);
		run.abortCount += 1;
		return { code: 204, body: Buffer.alloc(0), contentType: 'text/plain' };
	}
	return null;
}

async function waitForManagedProject(
	client,
	scenario,
	interceptionErrors,
	requests,
	expectGitFetch = true,
) {
	const requestOffset = requests.length;
	const targetUrl = `https://rinspace.com/editor/?mode=managed&owner=${scenario.owner}&repository=${scenario.repository}`;
	await client.send('Page.navigate', { url: targetUrl });
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
	if (expectGitFetch) {
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
	}
	return pageState;
}

function toolResults(turn) {
	return (turn.messages ?? [])
		.flatMap((message) => message.content ?? [])
		.filter((part) => part.type === 'tool-result');
}

const toolResultPhases = {
	read: {
		turn: 1,
		suffixes: ['list', 'read', 'search', 'diagnostics', 'git'],
	},
	write: {
		turn: 2,
		suffixes: ['patch', 'create', 'rename', 'delete'],
	},
	verification: {
		turn: 3,
		suffixes: ['verify-list', 'verify-read', 'verify-git', 'stale-patch'],
	},
	delivery: {
		turn: 4,
		suffixes: ['compile', 'commit'],
	},
	push: {
		turn: 5,
		suffixes: ['push'],
	},
};

function phaseToolResults(run, phase) {
	const definition = toolResultPhases[phase];
	const prefix = `${run.project.format}-${run.project.repository}-`;
	const expectedIds = new Set(
		definition.suffixes.map((suffix) => `${prefix}${suffix}`),
	);
	return toolResults(run.turns[definition.turn]).filter((result) =>
		expectedIds.has(result.toolCallId),
	);
}

function verifyReadOnlyRun(run) {
	const results = phaseToolResults(run, 'read');
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
	assert.equal(git.headOid, run.project.initialHead);
	assert.equal(git.worktreeBaseOid, run.project.initialHead);
	assert.deepEqual(git.changes, []);
	assert.deepEqual(git.worktreeChanges, []);
	assert.deepEqual(git.comparisons, []);
}

async function persistedFileContent(client, run) {
	return evaluate(
		client,
		`(() => new Promise((resolve, reject) => {
			const request = indexedDB.open(${JSON.stringify(`texlyre-project-${run.projectId}`)});
			request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
			request.onsuccess = () => {
				const db = request.result;
				const tx = db.transaction('files', 'readonly');
				const get = tx.objectStore('files').get(${JSON.stringify(run.write.entryFileId)});
				get.onerror = () => reject(get.error ?? new Error('IndexedDB read failed'));
				get.onsuccess = () => {
					const content = get.result?.content;
					if (typeof content === 'string') resolve(content);
					else if (content instanceof ArrayBuffer) resolve(new TextDecoder().decode(content));
					else resolve(null);
				};
			};
		}))()`,
	);
}

async function verifyWriteRun(client, run) {
	assert.equal(run.turns.length, 6, `${run.project.fullName} turn count`);
	const writeResults = phaseToolResults(run, 'write');
	assert.equal(
		writeResults.length,
		4,
		`${run.project.fullName} write result count`,
	);
	const writes = new Map(
		writeResults.map((result) => [result.toolName, result]),
	);
	for (const name of [
		'apply_project_patch',
		'create_project_file',
		'rename_project_file',
		'delete_project_file',
	]) {
		const result = writes.get(name);
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

	const patch = writes.get('apply_project_patch').output;
	assert.equal(patch.path, run.project.entry);
	assert.equal(patch.beforeSha256, run.write.originalSha256);
	assert.equal(patch.afterSha256, run.write.afterPatchSha256);
	assert.match(patch.afterSha256, /^[0-9a-f]{64}$/);
	assert.equal(
		patch.transactionOrigin,
		`fixture-${run.project.owner}-${run.project.repository}:${run.project.format}-${run.project.repository}-patch`,
	);

	const temporarySha256 = createHash('sha256')
		.update(run.write.temporaryContent)
		.digest('hex');
	const created = writes.get('create_project_file').output;
	const renamed = writes.get('rename_project_file').output;
	const deleted = writes.get('delete_project_file').output;
	assert.equal(created.path, run.write.temporaryPath);
	assert.equal(created.contentSha256, temporarySha256);
	assert.equal(renamed.fileId, created.fileId);
	assert.equal(renamed.oldPath, run.write.temporaryPath);
	assert.equal(renamed.path, run.write.renamedPath);
	assert.equal(renamed.contentSha256, temporarySha256);
	assert.equal(
		renamed.transactionOrigin,
		`fixture-${run.project.owner}-${run.project.repository}:${run.project.format}-${run.project.repository}-rename`,
	);
	assert.equal(deleted.fileId, created.fileId);
	assert.equal(deleted.path, run.write.renamedPath);
	assert.equal(deleted.deletedSha256, temporarySha256);
	assert.equal(
		deleted.transactionOrigin,
		`fixture-${run.project.owner}-${run.project.repository}:${run.project.format}-${run.project.repository}-delete`,
	);

	const verificationResults = phaseToolResults(run, 'verification');
	assert.equal(
		verificationResults.length,
		4,
		`${run.project.fullName} verification result count`,
	);
	const verification = new Map(
		verificationResults.map((result) => [result.toolName, result]),
	);
	for (const name of [
		'list_project_files',
		'read_project_files',
		'git_status',
	]) {
		const result = verification.get(name);
		assert.ok(result, `${run.project.fullName} omitted verification ${name}`);
		assert.notEqual(
			result.isError,
			true,
			`${run.project.fullName} failed verification ${name}`,
		);
		assert.equal(
			result.output?.ok,
			true,
			`${run.project.fullName} verification ${name} did not return ok`,
		);
		assert.equal(result.output.projectId, run.projectId);
	}

	const listed = verification.get('list_project_files').output.entries;
	assert.ok(listed.some((entry) => entry.path === run.project.entry));
	assert.ok(listed.some((entry) => entry.path === run.project.secondary));
	assert.ok(listed.some((entry) => entry.path === 'rinspace.yaml'));
	assert.equal(
		listed.some((entry) =>
			[run.write.temporaryPath, run.write.renamedPath].includes(entry.path),
		),
		false,
		`${run.project.fullName} retained a temporary structure edit`,
	);

	const finalFile = verification
		.get('read_project_files')
		.output.files.find((file) => file.path === run.project.entry);
	assert.ok(finalFile, `${run.project.fullName} did not reread the entry file`);
	const expectedContent =
		run.write.expectedFinalContent ??
		`${run.write.originalContent}${run.write.patchMarker}${run.write.collaboratorText}`;
	assert.equal(finalFile.content, expectedContent);
	assert.equal(
		finalFile.contentSha256,
		createHash('sha256').update(expectedContent).digest('hex'),
	);
	assert.ok(!finalFile.content.includes(run.write.staleReplacement));

	const git = verification.get('git_status').output;
	assert.equal(git.initialized, true);
	assert.equal(git.branch, 'main');
	assert.equal(git.headOid, run.project.initialHead);
	assert.equal(git.worktreeBaseOid, run.project.initialHead);
	const visibleChanges = [...git.changes, ...git.worktreeChanges];
	const persistedContent = await persistedFileContent(client, run);
	assert.ok(
		visibleChanges.some(
			(change) =>
				change.path === run.project.entry && change.type === 'modified',
		),
		`${run.project.fullName} Git worktree omitted the entry modification: ${JSON.stringify({ visibleChanges, persistedContent })}`,
	);
	assert.ok(
		visibleChanges.every((change) => change.path === run.project.entry),
		`${run.project.fullName} Git worktree retained a temporary path`,
	);
	assert.ok(
		git.comparisons.some((comparison) => comparison.path === run.project.entry),
		`${run.project.fullName} omitted the visible entry diff`,
	);

	const conflict = verification.get('apply_project_patch');
	assert.ok(conflict, `${run.project.fullName} omitted the stale patch result`);
	assert.equal(conflict.output?.ok, false);
	assert.equal(conflict.output?.error?.code, 'conflict');
}

async function verifyDeliveryRun(client, run) {
	const deliveryResults = phaseToolResults(run, 'delivery');
	assert.equal(
		deliveryResults.length,
		2,
		`${run.project.fullName} delivery result count`,
	);
	const delivery = new Map(
		deliveryResults.map((result) => [result.toolName, result]),
	);
	const compiled = delivery.get('compile_project');
	assert.ok(compiled, `${run.project.fullName} omitted compile_project`);
	assert.notEqual(compiled.isError, true);
	assert.equal(compiled.output?.ok, true);
	assert.equal(compiled.output.projectId, run.projectId);
	assert.equal(compiled.output.mainFile, `/${run.project.entry}`);
	assert.equal(compiled.output.status, 'success');
	assert.equal(compiled.output.error, null);
	assert.ok(
		Number.isSafeInteger(compiled.output.outputBytes) &&
			compiled.output.outputBytes > 0,
		`${run.project.fullName} compile produced no output`,
	);
	const expectedCompiler = {
		latex: 'internal:latex',
		typst: 'internal:typst',
		markdown: 'milkdown-preview',
	}[run.project.format];
	assert.equal(compiled.output.compilerId, expectedCompiler);

	const committed = delivery.get('create_git_commit');
	assert.ok(committed, `${run.project.fullName} omitted create_git_commit`);
	assert.notEqual(committed.isError, true);
	assert.equal(committed.output?.ok, true);
	assert.equal(committed.output.projectId, run.projectId);
	assert.match(committed.output.commitOid, /^[0-9a-f]{40}$/);
	assert.equal(
		committed.output.message,
		`agent: verify ${run.project.format} managed flow`,
	);
	assert.equal(run.delivery?.commit?.commitOid, committed.output.commitOid);

	const pushResults = phaseToolResults(run, 'push');
	assert.equal(pushResults.length, 1, `${run.project.fullName} Push result count`);
	const pushed = pushResults[0];
	assert.equal(pushed.toolName, 'push_git_commits');
	assert.notEqual(pushed.isError, true);
	assert.equal(pushed.output?.ok, true);
	assert.equal(pushed.output.projectId, run.projectId);
	assert.equal(pushed.output.remoteBranch, 'main');
	assert.equal(pushed.output.previousLocalOid, committed.output.commitOid);
	assert.equal(pushed.output.canonicalOid, committed.output.commitOid);
	assert.equal(pushed.output.pushedCommits, 1);
	assert.equal(run.project.pushCount, 1);
	assert.equal(run.project.head, committed.output.commitOid);
	const remoteEntry = (
		await runCommand(
			'git',
			[
				'--git-dir',
				run.project.bare,
				'show',
				`${committed.output.commitOid}:${run.project.entry}`,
			],
		)
	).toString('utf8');
	const persistedContent = await persistedFileContent(client, run);
	assert.equal(remoteEntry, persistedContent);
	assert.ok(remoteEntry.includes(visiblePatchMarker(run)));
}

async function editorText(client) {
	return evaluate(
		client,
		`(() => {
			const content = [...document.querySelectorAll('.cm-content')]
				.find(candidate => candidate instanceof HTMLElement && candidate.offsetParent !== null);
			if (content instanceof HTMLElement) {
				const view = content.cmTile?.root?.view;
				if (view?.state?.doc) return view.state.doc.toString();
				return [...content.querySelectorAll('.cm-line')].map(line => line.textContent ?? '').join('\\n');
			}
			const proseMirror = [...document.querySelectorAll('.milkdown-editor-scroll .ProseMirror')]
				.find(candidate => candidate instanceof HTMLElement && candidate.offsetParent !== null);
			if (proseMirror instanceof HTMLElement) return proseMirror.textContent ?? '';
			throw new Error('Visible text editor content is unavailable');
		})()`,
	);
}

const visiblePatchMarker = (run) =>
	run.write.patchMarker.split('$', 1)[0].trim();

async function waitForEditorText(client, description, predicate) {
	const deadline = Date.now() + timeoutMs;
	let text = '';
	while (Date.now() < deadline) {
		text = await editorText(client);
		if (predicate(text)) return text;
		await wait(25);
	}
	throw new Error(`${description}: ${text.slice(-1000)}`);
}

async function dispatchShortcut(client, key, code, modifiers, virtualKeyCode) {
	await client.send('Input.dispatchKeyEvent', {
		type: 'rawKeyDown',
		key,
		code,
		modifiers,
		windowsVirtualKeyCode: virtualKeyCode,
		nativeVirtualKeyCode: virtualKeyCode,
	});
	await client.send('Input.dispatchKeyEvent', {
		type: 'keyUp',
		key,
		code,
		modifiers,
		windowsVirtualKeyCode: virtualKeyCode,
		nativeVirtualKeyCode: virtualKeyCode,
	});
}

async function insertCollaboratorText(client, run) {
	await waitForEditorText(
		client,
		`${run.project.fullName} did not render the Agent patch`,
		(text) => text.includes(visiblePatchMarker(run)),
	);
	const navigation = await evaluate(
		client,
		`(async () => {
			const proseMirror = [...document.querySelectorAll('.milkdown-editor-scroll .ProseMirror')]
				.find(candidate => candidate instanceof HTMLElement && candidate.offsetParent !== null);
			if (proseMirror instanceof HTMLElement) {
				proseMirror.focus();
				const range = document.createRange();
				range.selectNodeContents(proseMirror);
				range.collapse(false);
				const selection = getSelection();
				selection?.removeAllRanges();
				selection?.addRange(range);
				await new Promise(resolve => requestAnimationFrame(() => resolve()));
				return {
					mode: 'prosemirror',
					focused: document.activeElement === proseMirror,
					className: document.activeElement instanceof HTMLElement ? document.activeElement.className : null,
					position: null
				};
			}
			const expectedPosition = ${run.write.originalContent.length + run.write.patchMarker.length};
			const cursorUpdate = new Promise((resolve, reject) => {
				const timeout = setTimeout(() => {
					document.removeEventListener('editor-cursor-update', handleUpdate);
					reject(new Error('Timed out waiting for the exact editor cursor position'));
				}, 2000);
				const handleUpdate = event => {
					if (
						event.detail?.fileId !== ${JSON.stringify(run.write.entryFileId)} ||
						event.detail?.position !== expectedPosition
					) return;
					clearTimeout(timeout);
					document.removeEventListener('editor-cursor-update', handleUpdate);
					resolve(event.detail);
				};
				document.addEventListener('editor-cursor-update', handleUpdate);
			});
			document.dispatchEvent(new CustomEvent('codemirror-goto-char', {
				detail: {
					fileId: ${JSON.stringify(run.write.entryFileId)},
					position: expectedPosition
				}
			}));
			const cursor = await cursorUpdate;
			await new Promise(resolve => requestAnimationFrame(() => resolve()));
			const active = document.activeElement;
			return {
				mode: 'codemirror',
				focused: active instanceof HTMLElement && active.classList.contains('cm-content'),
				className: active instanceof HTMLElement ? active.className : null,
				position: cursor.position
			};
		})()`,
	);
	assert.equal(
		navigation?.focused,
		true,
		`${run.project.fullName} exact editor navigation did not accept focus (${navigation?.className ?? 'none'})`,
	);
	assert.equal(
		navigation.mode === 'prosemirror' ||
			navigation.position ===
				run.write.originalContent.length + run.write.patchMarker.length,
		true,
		`${run.project.fullName} exact editor navigation did not confirm the cursor position`,
	);
	const expectedBeforeCollaborator = `${run.write.originalContent}${run.write.patchMarker}`;
	if (navigation.mode === 'prosemirror') {
		run.write.expectedFinalContent = `${run.write.originalContent}${run.write.patchMarker.trimEnd()}${run.write.collaboratorText}\n`;
		const split = Math.max(1, Math.floor(run.write.collaboratorText.length / 2));
		await client.send('Input.imeSetComposition', {
			text: run.write.collaboratorText.slice(0, split),
			selectionStart: split,
			selectionEnd: split,
		});
		await client.send('Input.imeSetComposition', {
			text: run.write.collaboratorText,
			selectionStart: run.write.collaboratorText.length,
			selectionEnd: run.write.collaboratorText.length,
		});
		await client.send('Input.insertText', {
			text: run.write.collaboratorText,
		});
	} else {
		const collaboratorEdit = await evaluate(
			client,
			`(() => {
				const content = [...document.querySelectorAll('.cm-content')]
					.find(candidate => candidate instanceof HTMLElement && candidate.offsetParent !== null);
				const view = content?.cmTile?.root?.view;
				if (!view?.state?.doc || typeof view.dispatch !== 'function') {
					return { ok: false, error: 'Visible CodeMirror EditorView is unavailable' };
				}
				const before = view.state.doc.toString();
				const from = view.state.doc.length;
				const inserted = ${JSON.stringify(run.write.collaboratorText)};
				view.dispatch({
					changes: { from, insert: inserted },
					selection: { anchor: from + inserted.length },
					userEvent: 'input.type.compose.start',
					scrollIntoView: true
				});
				return {
					ok: true,
					before,
					after: view.state.doc.toString(),
					selection: view.state.selection.main.head
				};
			})()`,
		);
		assert.deepEqual(collaboratorEdit, {
			ok: true,
			before: expectedBeforeCollaborator,
			after: `${expectedBeforeCollaborator}${run.write.collaboratorText}`,
			selection:
				expectedBeforeCollaborator.length + run.write.collaboratorText.length,
		});
	}
	await waitForEditorText(
		client,
		`${run.project.fullName} did not retain concurrent IME-style input`,
		(text) =>
			text.includes(visiblePatchMarker(run)) &&
			text.includes(run.write.collaboratorText),
	);
}

async function verifyUndoBoundaries(client, run) {
	await dispatchShortcut(client, 'z', 'KeyZ', 2, 90);
	await waitForEditorText(
		client,
		`${run.project.fullName} did not undo collaborator input`,
		(text) =>
			text.includes(visiblePatchMarker(run)) &&
			!text.includes(run.write.collaboratorText),
	);
	await dispatchShortcut(client, 'z', 'KeyZ', 2, 90);
	await waitForEditorText(
		client,
		`${run.project.fullName} did not undo the isolated Agent patch`,
		(text) =>
			!text.includes(visiblePatchMarker(run)) &&
			!text.includes(run.write.collaboratorText),
	);
	await dispatchShortcut(client, 'y', 'KeyY', 2, 89);
	await waitForEditorText(
		client,
		`${run.project.fullName} did not redo the isolated Agent patch`,
		(text) =>
			text.includes(visiblePatchMarker(run)) &&
			!text.includes(run.write.collaboratorText),
	);
	await dispatchShortcut(client, 'y', 'KeyY', 2, 89);
	await waitForEditorText(
		client,
		`${run.project.fullName} did not redo collaborator input`,
		(text) =>
			text.includes(visiblePatchMarker(run)) &&
			text.includes(run.write.collaboratorText),
	);
}

async function runManagedAgentProject(client, scenario, agentFixture) {
	await evaluate(
		client,
		`(() => {
			const panel = document.querySelector('section[data-role="agent"]');
			if (!panel) throw new Error('Agent panel is unavailable');
			window.__rinspaceFixtureApprovalSeen = 0;
			let approvalVisible = false;
			new MutationObserver(() => {
				const visible = panel.textContent?.includes('确认 Push') ?? false;
				if (visible && !approvalVisible) {
					window.__rinspaceFixtureApprovalSeen += 1;
				}
				approvalVisible = visible;
			}).observe(panel, { childList: true, subtree: true, characterData: true });
			const textarea = panel.querySelector('textarea');
			if (!(textarea instanceof HTMLTextAreaElement)) throw new Error('Agent textarea is unavailable');
			const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
			if (!setter) throw new Error('Textarea value setter is unavailable');
			setter.call(textarea, ${JSON.stringify('自动读取并安全修改当前项目，验证文件结构和冲突保护，然后编译、提交并申请 Push')});
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
		if (
			run?.awaitingCollaborator &&
			!run.collaboratorEntered &&
			typeof run.releaseAfterCollaborator === 'function'
		) {
			await insertCollaboratorText(client, run);
			run.collaboratorEntered = true;
			run.releaseAfterCollaborator();
		}
		if (run?.turns.length === 5 && !run.approvalHandled) {
			const approval = await evaluate(
				client,
				`(() => {
					const card = document.querySelector('.cline-ui-agent-approval-card');
					const detail = card?.querySelector('.cline-ui-agent-approval-card__detail')?.textContent;
					const approve = card?.querySelector('.cline-ui-agent-approval-card__button--approve');
					const reject = card?.querySelector('.cline-ui-agent-approval-card__button--reject');
					return {
						title: card?.querySelector('.cline-ui-agent-approval-card__title')?.textContent?.trim(),
						detail,
						approve: approve?.textContent?.trim(),
						reject: reject?.textContent?.trim(),
					};
				})()`,
			);
			if (approval.title) {
				assert.equal(approval.title, '确认 Push');
				assert.equal(approval.approve, 'Approve');
				assert.equal(approval.reject, 'Reject');
				const preview = JSON.parse(approval.detail);
				assert.equal(preview.providerName, 'Rinspace Gitea');
				assert.equal(preview.repositoryId, run.project.fullName);
				assert.equal(preview.repositoryLabel, run.project.fullName);
				assert.equal(preview.localBranch, 'main');
				assert.equal(preview.remoteBranch, 'main');
				assert.equal(preview.localHead, run.delivery.commit.commitOid);
				assert.equal(preview.remoteHead, run.project.initialHead);
				assert.deepEqual(preview.commits, [
					{
						oid: run.delivery.commit.commitOid,
						subject: `agent: verify ${run.project.format} managed flow`,
					},
				]);
				assert.equal(run.project.pushCount ?? 0, 0);
				run.approvalHandled = true;
				const clicked = await evaluate(
					client,
					`(() => {
						const approve = document.querySelector('.cline-ui-agent-approval-card__button--approve');
						if (!(approve instanceof HTMLButtonElement) || approve.disabled) return false;
						approve.click();
						return true;
					})()`,
				);
				assert.equal(clicked, true, `${scenario.fullName} Push approval was unavailable`);
			}
		}
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
		assert.ok(
			taskState.approvalSeen <= 1,
			`${scenario.fullName} requested duplicate Push approvals`,
		);
		if ((run?.turns.length ?? 0) < 5) {
			assert.equal(
				taskState.approvalSeen,
				0,
				`${scenario.fullName} requested approval for an automatic tool`,
			);
		}
		if (
			run?.turns.length === 6 &&
			taskState.status === '就绪' &&
			taskState.text?.includes(
				`完成 ${scenario.format} 安全写入、编译、提交与 Push 验收`,
			)
		) {
			assert.equal(
				taskState.approvalSeen,
				1,
				`${scenario.fullName} did not request exactly one Push approval`,
			);
			verifyReadOnlyRun(run);
			await verifyWriteRun(client, run);
			await verifyUndoBoundaries(client, run);
			await verifyDeliveryRun(client, run);
			return;
		}
		await wait(50);
	}
	throw new Error(
		`${scenario.fullName} managed Agent run timed out: ${JSON.stringify(taskState)}`,
	);
}

async function waitForRecoveryState(client, expectedText, interceptionErrors) {
	const deadline = Date.now() + timeoutMs;
	let state;
	while (Date.now() < deadline) {
		if (interceptionErrors.length) {
			throw new Error(interceptionErrors.join('\n'));
		}
		state = await evaluate(
			client,
			`(() => {
				const panel = document.querySelector('section[data-role="agent"]');
				const usage = panel?.querySelector('.rinspace-agent-usage')?.textContent ?? '';
				const text = panel?.textContent ?? '';
				const keys = Object.keys(sessionStorage).filter(key => key.startsWith('rinspace-agent:'));
				return {
					status: panel?.querySelector('.ui-badge')?.textContent?.trim(),
					text,
					usage,
					error: panel?.querySelector('.ui-message[data-tone="error"]')?.textContent ?? '',
					approval: Boolean(panel?.querySelector('.cline-ui-agent-approval-card')),
					projectId: sessionStorage.getItem('currentProjectId'),
					states: keys.map(key => ({ key, value: sessionStorage.getItem(key) })),
				};
			})()`,
		);
		if (
			state.status === '就绪' &&
			state.text.includes(expectedText) &&
			state.usage.includes('412 输入 token') &&
			state.usage.includes('92 输出 token')
		) {
			return state;
		}
		await wait(50);
	}
	throw new Error(`Agent recovery timed out: ${JSON.stringify(state)}`);
}

async function waitForRecoveryFailure(client, interceptionErrors) {
	const deadline = Date.now() + timeoutMs;
	let state;
	while (Date.now() < deadline) {
		if (interceptionErrors.length) {
			throw new Error(interceptionErrors.join('\n'));
		}
		state = await evaluate(
			client,
			`(() => {
				const panel = document.querySelector('section[data-role="agent"]');
				return {
					status: panel?.querySelector('.ui-badge')?.textContent?.trim(),
					error: panel?.querySelector('.ui-message[data-tone="error"]')?.textContent ?? '',
				};
			})()`,
		);
		if (state.error.includes('Agent run recovery failed (503)')) return state;
		await wait(50);
	}
	throw new Error(`Agent recovery failure was not surfaced: ${JSON.stringify(state)}`);
}

async function waitForObservedRequest(requests, offset, expected) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (requests.slice(offset).some((request) => request.includes(expected))) {
			return;
		}
		await wait(25);
	}
	throw new Error(`Timed out waiting for request: ${expected}`);
}

const profile = await mkdtemp(
	path.join(os.tmpdir(), 'rinspace-agent-managed-browser-'),
);
const fixture = await mkdtemp(
	path.join(os.tmpdir(), 'rinspace-agent-managed-git-'),
);
let browser;
let client;
let recoveryClient;
let largeAssetServer;
let stderr = '';
const interceptionErrors = [];
const requests = [];
const browserErrors = [];
const agentFixture = { runs: new Map() };
let state;
try {
	await access(path.join(dist, 'index.html'));
	const repository = await createRepositories(fixture);
	largeAssetServer = await startLargeAssetServer();
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
			'--disable-features=LocalNetworkAccessChecks,LocalNetworkAccessPermissionPrompt,PrivateNetworkAccessChecks,PrivateNetworkAccessPermissionPrompt',
			'--disable-sync',
			'--allow-running-insecure-content',
			`--unsafely-treat-insecure-origin-as-secure=${largeAssetServer.origin}`,
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

	const configurePageClient = async (page) => {
		const pageClient = new DevToolsClient(page.webSocketDebuggerUrl);
		pageClient.on('Runtime.exceptionThrown', ({ exceptionDetails }) => {
			browserErrors.push(
				exceptionDetails.exception?.description ??
					exceptionDetails.text ??
					'Unknown browser exception',
			);
		});
		pageClient.on('Log.entryAdded', ({ entry }) => {
			if (entry.level === 'error') browserErrors.push(entry.text);
		});
		pageClient.on('Fetch.requestPaused', (event) => {
			void (async () => {
				const url = new URL(event.request.url);
				requests.push(`${event.request.method} ${url.pathname}${url.search}`);
				let response = await apiResponse(
					repository,
					agentFixture,
					event.request,
					url,
				);
				if (
					!response &&
					/^\/repos\/(?:a|b|tags)\/[1-9][0-9]*\.git\//.test(url.pathname)
				) {
					const git = await gitResponse(repository, event.request, url);
					await pageClient.send('Fetch.fulfillRequest', {
						requestId: event.requestId,
						responseCode: git.code,
						responseHeaders: git.headers,
						body: git.body.toString('base64'),
					});
					return;
				}
				response ??= await staticResponse(url, largeAssetServer.origin);
				response ??= {
					code: 404,
					body: Buffer.from('fixture route not found'),
					contentType: 'text/plain; charset=utf-8',
				};
				await pageClient.send('Fetch.fulfillRequest', {
					requestId: event.requestId,
					responseCode: response.code,
					responseHeaders: responseHeaders(
						response.contentType,
						response.body.byteLength,
						response.extraHeaders,
					),
					body: response.body.toString('base64'),
				});
			})().catch(async (error) => {
				interceptionErrors.push(
					error instanceof Error ? (error.stack ?? error.message) : String(error),
				);
				try {
					await pageClient.send('Fetch.failRequest', {
						requestId: event.requestId,
						errorReason: 'Failed',
					});
				} catch {
					// Navigation failure will expose the original interception error below.
				}
			});
		});
		await Promise.all([
			pageClient.send('Fetch.enable', {
				patterns: [
					{
						urlPattern: 'https://rinspace.com/*',
						requestStage: 'Request',
					},
				],
			}),
			pageClient.send('Page.enable'),
			pageClient.send('Runtime.enable'),
			pageClient.send('Log.enable'),
			pageClient.send('Network.enable'),
		]);
		await pageClient.send('Network.setBypassServiceWorker', { bypass: true });
		return pageClient;
	};

	const page = await pageTarget(port);
	client = await configurePageClient(page);
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
		if (index > 0) {
			client.close();
			client = await configurePageClient(await createPageTarget(port));
		}
		await client.send('Emulation.setDeviceMetricsOverride', {
			width: 1200,
			height: 800,
			deviceScaleFactor: 1,
			mobile: false,
		});
		await client.send('Emulation.setEmulatedMedia', {
			features: [{ name: 'prefers-color-scheme', value: 'light' }],
		});
		if (index > 0) {
			state = await waitForManagedProject(
				client,
				scenario,
				interceptionErrors,
				requests,
			);
		}
		await evaluate(
			client,
			`(async () => {
				const userId = localStorage.getItem('texlyre-current-user');
				if (!userId) throw new Error('managed local profile is unavailable');
				const key = 'texlyre-user-' + userId + '-settings';
				const settings = JSON.parse(localStorage.getItem(key) || '{}');
				settings['theme-plugin'] = 'texlyre-wide-theme';
				settings['theme-variant'] = 'light';
				if (${JSON.stringify(scenario.format)} === 'latex') {
					settings['latex-engine'] = 'busytex-pdftex';
					settings['latex-busytex-bundles'] = 'basic';
				}
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
		await runManagedAgentProject(client, scenario, agentFixture);
	}

	const recoveryScenario = projectScenarios.at(-1);
	assert.ok(recoveryScenario);
	const recoveryRun = agentFixture.runs.get(
		`fixture-${recoveryScenario.owner}-${recoveryScenario.repository}`,
	);
	assert.ok(recoveryRun);
	const completionText = `完成 ${recoveryScenario.format} 安全写入、编译、提交与 Push 验收`;
	const beforeRecovery = {
		turns: recoveryRun.turns.length,
		pushes: recoveryRun.project.pushCount,
		aborts: recoveryRun.abortCount,
	};
	const saved = await waitForRecoveryState(
		client,
		completionText,
		interceptionErrors,
	);
	assert.equal(saved.states.length, 1);
	const savedEntry = saved.states[0];
	assert.equal(
		savedEntry.key,
		`rinspace-agent:${encodeURIComponent('fixture-user-17')}:${encodeURIComponent(saved.projectId)}`,
	);
	const persisted = JSON.parse(savedEntry.value);
	assert.equal(persisted.runId, `fixture-tags-44`);
	for (const [field, value] of Object.entries(recoveryRun.usage)) {
		assert.equal(persisted.usage[field], value);
	}
	assert.equal(persisted.usage.reasoningTokenCount, 0);
	assert.equal(persisted.usage.totalCost, 0);

	let recoveryRequestOffset = requests.length;
	await client.send('Page.reload', { ignoreCache: true });
	await waitForObservedRequest(
		requests,
		recoveryRequestOffset,
		`/rinspace/api/editor/v1/agent/runs/${persisted.runId}`,
	);
	const refreshed = await waitForRecoveryState(
		client,
		completionText,
		interceptionErrors,
	);
	assert.equal(refreshed.approval, false);
	assert.equal(recoveryRun.recoveryReads, 1);
	assert.equal(recoveryRun.turns.length, beforeRecovery.turns);
	assert.equal(recoveryRun.project.pushCount, beforeRecovery.pushes);
	assert.equal(recoveryRun.abortCount, beforeRecovery.aborts);

	recoveryClient = await configurePageClient(await createPageTarget(port));
	await recoveryClient.send('Emulation.setDeviceMetricsOverride', {
		width: 1200,
		height: 800,
		deviceScaleFactor: 1,
		mobile: false,
	});
	state = await waitForManagedProject(
		recoveryClient,
		recoveryScenario,
		interceptionErrors,
		requests,
		false,
	);
	const secondProjectId = await evaluate(
		recoveryClient,
		`sessionStorage.getItem('currentProjectId')`,
	);
	assert.equal(secondProjectId, saved.projectId);
	await evaluate(
		recoveryClient,
		`(() => {
			const key = ${JSON.stringify(savedEntry.key)};
			const raw = ${JSON.stringify(savedEntry.value)};
			sessionStorage.setItem(key, raw);
			const decoy = JSON.parse(raw);
			decoy.messages = [{
				id: 'decoy-message',
				role: 'user',
				content: [{ type: 'text', text: 'OTHER ACCOUNT OR PROJECT MUST NOT LEAK' }],
				createdAt: 1,
			}];
			sessionStorage.setItem(
				'rinspace-agent:' + encodeURIComponent('fixture-user-18') + ':' + encodeURIComponent(${JSON.stringify(saved.projectId)}),
				JSON.stringify(decoy),
			);
			sessionStorage.setItem(
				'rinspace-agent:' + encodeURIComponent('fixture-user-17') + ':' + encodeURIComponent('other-project'),
				JSON.stringify(decoy),
			);
		})()`,
	);
	agentFixture.failNextRecovery = true;
	recoveryRequestOffset = requests.length;
	await recoveryClient.send('Page.reload', { ignoreCache: true });
	await waitForObservedRequest(
		requests,
		recoveryRequestOffset,
		`/rinspace/api/editor/v1/agent/runs/${persisted.runId}`,
	);
	await waitForRecoveryFailure(recoveryClient, interceptionErrors);
	assert.equal(recoveryRun.recoveryReads, 1);
	assert.equal(recoveryRun.turns.length, beforeRecovery.turns);
	assert.equal(recoveryRun.project.pushCount, beforeRecovery.pushes);
	assert.equal(recoveryRun.abortCount, beforeRecovery.aborts);

	recoveryRequestOffset = requests.length;
	await recoveryClient.send('Page.reload', { ignoreCache: true });
	await waitForObservedRequest(
		requests,
		recoveryRequestOffset,
		`/rinspace/api/editor/v1/agent/runs/${persisted.runId}`,
	);
	const reconnected = await waitForRecoveryState(
		recoveryClient,
		completionText,
		interceptionErrors,
	);
	assert.equal(reconnected.approval, false);
	assert.ok(!reconnected.text.includes('OTHER ACCOUNT OR PROJECT MUST NOT LEAK'));
	assert.equal(recoveryRun.recoveryReads, 2);
	assert.equal(recoveryRun.turns.length, beforeRecovery.turns);
	assert.equal(recoveryRun.project.pushCount, beforeRecovery.pushes);
	assert.equal(recoveryRun.abortCount, beforeRecovery.aborts);

	assert.equal(agentFixture.runs.size, projectScenarios.length);
	const completedRuns = [...agentFixture.runs.values()];
	assert.equal(
		completedRuns.reduce(
			(total, run) =>
				total +
				phaseToolResults(run, 'read').length +
				phaseToolResults(run, 'write').length +
				phaseToolResults(run, 'verification').length +
				phaseToolResults(run, 'delivery').length +
				phaseToolResults(run, 'push').length,
			0,
		),
		48,
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
				smartHttpPush: true,
				refreshRecoveries: recoveryRun.recoveryReads,
				recoveryFailureRetries: 1,
				isolatedRecoveryTabs: 2,
				durableAbortRequests: recoveryRun.abortCount,
				replayedTurnRequests: recoveryRun.turns.length - beforeRecovery.turns,
				themeCombinations: checkedThemes.length,
				managedToolProjects: completedRuns.length,
				automaticReadToolResults: completedRuns.reduce(
					(total, run) => total + phaseToolResults(run, 'read').length,
					0,
				),
				automaticWriteToolResults: completedRuns.reduce(
					(total, run) => total + phaseToolResults(run, 'write').length,
					0,
				),
				automaticVerificationResults: completedRuns.reduce(
					(total, run) => total + phaseToolResults(run, 'verification').length,
					0,
				),
				automaticDeliveryToolResults: completedRuns.reduce(
					(total, run) => total + phaseToolResults(run, 'delivery').length,
					0,
				),
				approvedPushToolResults: completedRuns.reduce(
					(total, run) => total + phaseToolResults(run, 'push').length,
					0,
				),
				automaticToolResults: completedRuns.reduce(
					(total, run) =>
						total +
						phaseToolResults(run, 'read').length +
						phaseToolResults(run, 'write').length +
						phaseToolResults(run, 'verification').length +
						phaseToolResults(run, 'delivery').length,
					0,
				),
				approvalRequests: completedRuns.reduce(
					(total, run) => total + (run.approvalHandled ? 1 : 0),
					0,
				),
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
	recoveryClient?.close();
	client?.close();
	if (browser?.exitCode === null) browser.kill('SIGTERM');
	await Promise.all([
		largeAssetServer?.close(),
		rm(profile, { recursive: true, force: true }),
		rm(fixture, { recursive: true, force: true }),
	]);
}
