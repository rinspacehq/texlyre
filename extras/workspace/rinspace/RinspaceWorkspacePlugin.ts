// SPDX-License-Identifier: AGPL-3.0-or-later
import type { WorkspacePlugin } from '@/plugins/PluginInterface';
import { getStartupIntent } from '@/workspace/RuntimeStartup';

import { RinspaceManagedWorkspaceRuntime } from './RinspaceManagedWorkspace';
import { createRinspaceGitRemoteProvider } from './RinspaceGitRemoteProvider';
import { RinspaceProjectCatalog } from './RinspaceProjectCatalog';
import { getRinspaceWorkspaceSettings } from './settings';
import { isRinspaceAccountRoute } from './RinspaceRoutePolicy';
import { rinspaceLocale } from './RinspaceLocale';

const integrationAllowed = () => isRinspaceAccountRoute(window.location.search, window.location.origin);

function initialIntegrationEnabled(): boolean {
	if (!integrationAllowed()) return false;
	if (getStartupIntent().mode === 'managed') return true;
	const userId = localStorage.getItem('texlyre-current-user');
	const keys = [
		...(userId ? [`texlyre-user-${userId}-settings`] : []),
		'texlyre-settings',
	];
	for (const key of keys) {
		try {
			const value = JSON.parse(localStorage.getItem(key) ?? '{}')[
				'rinspace-integration-enabled'
			];
			if (typeof value === 'boolean') return value;
		} catch {
			// A malformed settings entry is repaired by the existing settings provider.
		}
	}
	return true;
}

export const rinspaceManagedWorkspaceRuntime =
	new RinspaceManagedWorkspaceRuntime(undefined, initialIntegrationEnabled(), integrationAllowed);
export const rinspaceProjectCatalog = new RinspaceProjectCatalog(
	rinspaceManagedWorkspaceRuntime,
);
export const rinspaceGitRemoteProvider = createRinspaceGitRemoteProvider(
	() => rinspaceManagedWorkspaceRuntime.isEnabled(),
);

const rinspaceWorkspacePlugin: WorkspacePlugin = {
	id: 'rinspace-workspace',
	name: 'Rinspace',
	version: '0.1.0',
	type: 'workspace',
	gitRemote: rinspaceGitRemoteProvider,
	contractVersion: 1,
	get settings() {
		return getRinspaceWorkspaceSettings(rinspaceManagedWorkspaceRuntime);
	},
	extensions: {
		locale: rinspaceLocale,
		host: {
			open: (intent, signal) =>
				rinspaceManagedWorkspaceRuntime.open(intent, signal),
			onContextInvalidated: (listener) =>
				rinspaceManagedWorkspaceRuntime.onContextInvalidated(listener),
		},
		catalog: rinspaceProjectCatalog,
	},
};

export default rinspaceWorkspacePlugin;
