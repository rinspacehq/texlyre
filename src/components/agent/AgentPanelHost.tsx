// SPDX-License-Identifier: AGPL-3.0-or-later
import type React from 'react';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';

import { useProperties } from '../../hooks/useProperties';
import { pluginRegistry } from '../../plugins/PluginRegistry';
import type { HostContext } from '../../workspace/contracts';
import AuxiliaryPanelPortal from '../auxiliary/AuxiliaryPanelPortal';
import { ChatIcon } from '../common/Icons';

interface AgentPanelHostProps {
	context: HostContext;
	projectId: string;
}

const AgentPanelHost: React.FC<AgentPanelHostProps> = ({
	context,
	projectId,
}) => {
	const propertiesRegistered = useRef(false);
	const {
		isReady: arePropertiesReady,
		getProperty,
		setProperty,
		registerProperty,
	} = useProperties();
	const plugin = pluginRegistry.getAvailableAgents(context)[0];
	const openOnProjectLoad = plugin?.openPanelOnProjectLoad !== false;
	const panelKey =
		context.mode === 'managed'
			? JSON.stringify([
					plugin?.id,
					projectId,
					context.identity.actorId,
					context.identity.permissionEpoch,
					context.binding.workspaceId,
					context.binding.generation,
				])
			: JSON.stringify([plugin?.id, projectId, 'local']);
	const storedOpen = openOnProjectLoad && arePropertiesReady
		? getProperty('agent-panel-visible', {
				scope: 'project',
				projectId,
			})
		: undefined;
	const [visibility, setVisibility] = useState<{
		panelKey: string;
		open: boolean;
		opened: boolean;
	} | null>(null);
	const current = visibility?.panelKey === panelKey ? visibility : null;
	const open =
		current?.open ??
		(openOnProjectLoad && (storedOpen === undefined || storedOpen === true));
	const setOpen = useCallback(
		(nextOpen: boolean) => {
			setVisibility((previous) => ({
				panelKey,
				open: nextOpen,
				opened: nextOpen || (previous?.panelKey === panelKey && previous.opened),
			}));
			if (!openOnProjectLoad || !arePropertiesReady) return;
			setProperty('agent-panel-visible', nextOpen, {
				scope: 'project',
				projectId,
			});
		},
		[arePropertiesReady, openOnProjectLoad, panelKey, projectId, setProperty],
	);

	useEffect(() => {
		if (!plugin || !openOnProjectLoad || propertiesRegistered.current) return;
		propertiesRegistered.current = true;
		registerProperty({
			id: 'agent-panel-visible',
			category: 'UI',
			subcategory: 'Editor',
			defaultValue: true,
		});
	}, [openOnProjectLoad, plugin, registerProperty]);

	if (!plugin) return null;
	const Panel = plugin.renderPanel;
	return (
		<AuxiliaryPanelPortal
			id='agent'
			label={plugin.name}
			icon={ChatIcon}
			order={10}
			open={open}
			onOpenChange={setOpen}
		>
			{(openOnProjectLoad || current?.opened) && (
				<div className='agent-panel-container'>
					<Suspense
						fallback={
							<div className='ui-loading-state' data-role='agent'>
								<div className='loading-spinner' />
							</div>
						}
					>
						<Panel
							key={panelKey}
							context={context}
							projectId={projectId}
							collapsed={!open}
							onCollapsedChange={(collapsed) => setOpen(!collapsed)}
						/>
					</Suspense>
				</div>
			)}
		</AuxiliaryPanelPortal>
	);
};

export default AgentPanelHost;
