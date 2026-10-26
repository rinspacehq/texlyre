// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import test from 'node:test';

import { AgentPluginRegistry } from '../../src/plugins/AgentPluginRegistry.ts';

const local = { mode: 'local-unbound' };
const managed = {
	mode: 'managed',
	identity: { actorId: 'actor', permissionEpoch: 'epoch' },
	binding: {
		repositoryId: 'repo',
		branchBindingId: 'branch',
		ref: 'refs/heads/main',
		workspaceId: 'workspace',
		generation: 1,
		baseCommit: 'a'.repeat(40),
		objectFormat: 'sha1',
	},
	capabilities: ['read-source'],
};

const plugin = (id, isAvailable = (context) => context.mode === 'managed') => ({
	id,
	name: id,
	version: '0.1.0',
	type: 'agent',
	isAvailable,
	renderPanel: () => null,
});

test('Agent plugins register, filter by host context and unregister', () => {
	const registry = new AgentPluginRegistry();
	registry.register(plugin('managed-agent'));
	assert.deepEqual(registry.getAvailable(local), []);
	assert.deepEqual(registry.getAvailable(managed).map(({ id }) => id), ['managed-agent']);
	assert.equal(registry.unregister('managed-agent'), true);
	assert.deepEqual(registry.getAll(), []);
});

test('Agent plugin identities and types cannot be replaced', () => {
	const registry = new AgentPluginRegistry();
	registry.register(plugin('one'));
	assert.throws(() => registry.register(plugin('one')), /Duplicate/);
	assert.throws(() => registry.register({ ...plugin('wrong'), type: 'viewer' }), /Invalid/);
});

test('availability is evaluated lazily for the current context', () => {
	let checks = 0;
	const registry = new AgentPluginRegistry();
	registry.register(plugin('lazy', () => {
		checks += 1;
		return true;
	}));
	assert.equal(checks, 0);
	assert.equal(registry.getAvailable(local).length, 1);
	assert.equal(checks, 1);
});
