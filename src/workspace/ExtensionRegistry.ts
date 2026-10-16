// SPDX-License-Identifier: AGPL-3.0-or-later
import type { WorkspaceExtensionPlugin, WorkspaceExtensions } from './contracts';

const hooks = ['host', 'catalog', 'git', 'collaboration', 'snapshots', 'recovery', 'actions', 'assets', 'locale'] as const;

/** Optional hooks leave the unhosted application unchanged. No runtime loading. */
export class WorkspaceExtensionRegistry {
	private readonly plugins = new Map<string, WorkspaceExtensionPlugin>();
	private readonly owners = new Map<keyof WorkspaceExtensions, string>();
	private current: WorkspaceExtensions = Object.freeze({});

	register(plugin: WorkspaceExtensionPlugin): void {
		if (plugin.type !== 'workspace' || plugin.contractVersion !== 1) {
			throw new Error('Unsupported workspace extension contract');
		}
		if (!plugin.id.trim() || this.plugins.has(plugin.id)) {
			throw new Error(`Duplicate or empty workspace extension: ${plugin.id}`);
		}
		for (const hook of hooks) {
			if (plugin.extensions[hook] !== undefined && this.owners.has(hook)) {
				throw new Error(`Workspace hook ${hook} already provided by ${this.owners.get(hook)}`);
			}
		}
		// Validate the entire registration before changing any registry state.
		const additions: WorkspaceExtensions = Object.fromEntries(
			hooks.filter((hook) => plugin.extensions[hook] !== undefined)
				.map((hook) => [hook, plugin.extensions[hook]]),
		);
		this.current = Object.freeze({ ...this.current, ...additions });
		for (const hook of hooks) {
			if (plugin.extensions[hook] !== undefined) this.owners.set(hook, plugin.id);
		}
		this.plugins.set(plugin.id, plugin);
	}

	getExtensions(): WorkspaceExtensions {
		return this.current;
	}
}
