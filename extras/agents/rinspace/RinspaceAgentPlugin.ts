// SPDX-License-Identifier: AGPL-3.0-or-later
import { lazy } from 'react';

import type { AgentPlugin } from '@/plugins/PluginInterface';

const RinspaceAgentPanel = lazy(() => import('./RinspaceAgentPanel'));

const rinspaceAgentPlugin: AgentPlugin = {
	id: 'rinspace-agent',
	name: '琳',
	version: '0.1.0',
	type: 'agent',
	isAvailable: (context) => context.mode === 'managed',
	renderPanel: RinspaceAgentPanel,
};

export default rinspaceAgentPlugin;
