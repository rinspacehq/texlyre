// SPDX-License-Identifier: AGPL-3.0-or-later
import type { HostContext } from '../workspace/contracts';
import type { AgentPlugin } from './PluginInterface';

/** Owns Agent plugin discovery without importing any product implementation. */
export class AgentPluginRegistry {
	private readonly plugins = new Map<string, AgentPlugin>();

	register(plugin: AgentPlugin): void {
		if (plugin.type !== 'agent' || !plugin.id.trim()) {
			throw new Error('Invalid Agent plugin');
		}
		if (this.plugins.has(plugin.id)) {
			throw new Error(`Duplicate Agent plugin: ${plugin.id}`);
		}
		this.plugins.set(plugin.id, plugin);
	}

	unregister(pluginId: string): boolean {
		return this.plugins.delete(pluginId);
	}

	getAll(): AgentPlugin[] {
		return [...this.plugins.values()];
	}

	getAvailable(context: HostContext): AgentPlugin[] {
		return this.getAll().filter((plugin) => plugin.isAvailable(context));
	}
}
