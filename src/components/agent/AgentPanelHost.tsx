// SPDX-License-Identifier: AGPL-3.0-or-later
import type React from 'react';
import { Suspense } from 'react';

import { pluginRegistry } from '../../plugins/PluginRegistry';
import type { HostContext } from '../../workspace/contracts';
import ResizablePanel from '../common/ResizablePanel';

interface AgentPanelHostProps {
	context: HostContext;
	projectId: string;
}

const AgentPanelHost: React.FC<AgentPanelHostProps> = ({ context, projectId }) => {
	const plugin = pluginRegistry.getAvailableAgents(context)[0];
	if (!plugin) return null;
	const Panel = plugin.renderPanel;
	const panelKey =
		context.mode === 'managed'
			? JSON.stringify([
					projectId,
					context.identity.actorId,
					context.identity.permissionEpoch,
					context.binding.workspaceId,
					context.binding.generation,
				])
			: `${projectId}:local`;
	return (
		<ResizablePanel
			direction='horizontal'
			alignment='start'
			width={360}
			minWidth={280}
			maxWidth={600}
			maintainAlignment={true}
			className='agent-panel-container'
		>
			<Suspense
				fallback={
					<div className='ui-loading-state' data-role='agent'>
						<div className='loading-spinner' />
					</div>
				}
			>
				<Panel key={panelKey} context={context} projectId={projectId} />
			</Suspense>
		</ResizablePanel>
	);
};

export default AgentPanelHost;
