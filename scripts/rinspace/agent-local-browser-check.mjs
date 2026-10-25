// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';

const defaultUrl =
	'http://127.0.0.1:4178/editor/?mode=local-unbound' +
	'#newProjectName:Rinspace%20Agent%20Local%20Boundary&newProjectType:latex';
const url =
	process.argv.find((argument) => argument.startsWith('--url='))?.slice(6) ??
	defaultUrl;
const timeoutMs = Number(
	process.argv
		.find((argument) => argument.startsWith('--timeout-ms='))
		?.slice(13) ?? 30_000,
);

assert.ok(
	Number.isSafeInteger(timeoutMs) && timeoutMs >= 1_000 && timeoutMs <= 120_000,
);
const target = new URL(url);
assert.ok(target.protocol === 'http:' || target.protocol === 'https:');
assert.ok(
	['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname),
	'the local browser check only accepts a loopback URL',
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
			// Try the next known browser location.
		}
	}
	throw new Error(
		'Chromium is unavailable; set CHROMIUM_BIN to a reviewed browser binary',
	);
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
	if (result.exceptionDetails) throw new Error('Browser evaluation failed');
	return result.result.value;
}

const profile = await mkdtemp(
	path.join(os.tmpdir(), 'rinspace-agent-local-browser-'),
);
let browser;
let client;
let stderr = '';
try {
	await fetch(target.origin, { signal: AbortSignal.timeout(5_000) }).then(
		(response) => {
			if (!response.ok)
				throw new Error(`Local server returned ${response.status}`);
		},
	);

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
	const requests = [];
	client.on('Network.requestWillBeSent', ({ request }) =>
		requests.push(request.url),
	);
	await Promise.all([
		client.send('Network.enable'),
		client.send('Page.enable'),
		client.send('Runtime.enable'),
	]);
	await client.send('Page.navigate', { url });

	const deadline = Date.now() + timeoutMs;
	let state;
	while (Date.now() < deadline) {
		state = await evaluate(
			client,
			`({
				ready: Boolean(document.querySelector('header[data-role="editor"]')),
				agentMounted: Boolean(document.querySelector('[data-role="agent"]')),
				hash: location.hash,
				search: location.search
			})`,
		);
		if (state.ready) break;
		await wait(100);
	}
	assert.equal(
		state?.ready,
		true,
		'the local project did not reach the real editor',
	);
	await wait(1_000);
	state = await evaluate(
		client,
		`({
			ready: Boolean(document.querySelector('header[data-role="editor"]')),
			agentMounted: Boolean(document.querySelector('[data-role="agent"]')),
			hash: location.hash,
			search: location.search
		})`,
	);
	assert.equal(
		state.agentMounted,
		false,
		'the Agent panel mounted in local mode',
	);
	assert.match(
		state.hash,
		/^#yjs:/,
		'the browser did not open the generated local project',
	);
	assert.equal(new URLSearchParams(state.search).get('mode'), 'local-unbound');

	const forbidden = requests.filter((requestUrl) =>
		/(?:\/rinspace\/api\/editor\/v1\/agent(?:\/|$)|RinspaceAgent(?:Panel|Runtime|Model|Tools|Persistence)|cline-embed)/i.test(
			decodeURIComponent(requestUrl),
		),
	);
	assert.deepEqual(
		forbidden,
		[],
		`local mode requested Agent resources:\n${forbidden.join('\n')}`,
	);
	process.stdout.write(
		`${JSON.stringify(
			{
				mode: 'local-unbound',
				editorReady: state.ready,
				agentMounted: state.agentMounted,
				forbiddenRequests: forbidden.length,
				observedRequests: requests.length,
			},
			null,
			2,
		)}\n`,
	);
} catch (error) {
	if (stderr) process.stderr.write(stderr);
	throw error;
} finally {
	try {
		await client?.send('Browser.close');
	} catch {
		// The browser may already have exited after a failed page load.
	}
	client?.close();
	if (browser?.exitCode === null) browser.kill('SIGTERM');
	await rm(profile, { recursive: true, force: true });
}
