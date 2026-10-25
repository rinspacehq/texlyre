// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '../..');
const agentRoot = path.join(root, 'extras/agents/rinspace');

async function sources(directory) {
	const output = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const target = path.join(directory, entry.name);
		if (entry.isDirectory()) output.push(...await sources(target));
		else if (/\.(?:ts|tsx|css)$/.test(entry.name)) output.push(target);
	}
	return output;
}

test('Rinspace Agent is lazy, managed-only and contains no provider credential surface', async () => {
	const plugin = await readFile(path.join(agentRoot, 'RinspaceAgentPlugin.ts'), 'utf8');
	assert.match(plugin, /lazy\(\(\) => import\('\.\/RinspaceAgentPanel'\)\)/);
	assert.match(plugin, /context\.mode === 'managed'/);

	const combined = (await Promise.all((await sources(agentRoot)).map((file) => readFile(file, 'utf8')))).join('\n');
	for (const forbidden of [
		/@cline\/core/,
		/node:fs/,
		/child_process/,
		/apiKey/,
		/providerId/,
		/DeepSeek/i,
		/Cline Cloud/i,
	]) {
		assert.doesNotMatch(combined, forbidden);
	}
});

test('local workspaces cannot mount or fetch the lazy Agent panel', async () => {
	const host = await readFile(path.join(root, 'src/components/agent/AgentPanelHost.tsx'), 'utf8');
	const registry = await readFile(path.join(root, 'src/plugins/AgentPluginRegistry.ts'), 'utf8');
	assert.match(host, /getAvailableAgents\(context\)/);
	assert.match(host, /if \(!plugin\) return null/);
	assert.match(registry, /plugin\.isAvailable\(context\)/);
	assert.doesNotMatch(host, /RinspaceAgentPanel|rinspace\/api/);
});

test('Agent tools are a closed project-scoped set with approval only for Push', async () => {
	const tools = await readFile(
		path.join(agentRoot, 'RinspaceAgentTools.ts'),
		'utf8',
	);
	for (const name of [
		'list_project_files',
		'read_project_files',
		'search_project',
		'read_compile_diagnostics',
		'git_status',
		'apply_project_patch',
		'create_project_file',
		'rename_project_file',
		'delete_project_file',
		'create_git_commit',
		'push_git_commits',
	]) {
		assert.match(tools, new RegExp(`name: '${name}'`));
	}
	assert.match(tools, /autoApprove: tool\.name !== 'push_git_commits'/);
	assert.match(tools, /policy: \{ enabled: true, autoApprove: false \}/);
	assert.match(tools, /host\.prepareGitPush\(\)/);
	assert.match(tools, /getCurrentProjectId\(\) !== host\.projectId/);
	assert.match(tools, /part === '\.\.'|part === "\.\."/);
	assert.match(tools, /isBinaryFile/);
	assert.match(tools, /isTemporaryFile/);
	assert.match(tools, /contentSha256/);
	assert.doesNotMatch(tools, /\bfetch\(/);
});
