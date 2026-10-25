// SPDX-License-Identifier: AGPL-3.0-or-later
import { useState } from 'react';
import { render, screen } from '@testing-library/react';

import AgentPanelHost from '@src/components/agent/AgentPanelHost';
import type { AgentPlugin } from '@src/plugins/PluginInterface';
import type { HostContext } from '@src/workspace/contracts';

const mockGetAvailableAgents = jest.fn();

jest.mock('@src/plugins/PluginRegistry', () => ({
	pluginRegistry: { getAvailableAgents: (...args: unknown[]) => mockGetAvailableAgents(...args) },
}));

jest.mock('@src/components/common/ResizablePanel', () => ({
	__esModule: true,
	default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

let nextInstance = 0;

const managedContext = (overrides: {
	actorId?: string;
	permissionEpoch?: string;
	workspaceId?: string;
	generation?: number;
} = {}): Extract<HostContext, { mode: 'managed' }> => ({
	mode: 'managed',
	identity: {
		actorId: overrides.actorId ?? 'actor-1',
		permissionEpoch: overrides.permissionEpoch ?? 'epoch-1',
	},
	binding: {
		repositoryId: 'repo-1',
		branchBindingId: 'branch-1',
		ref: 'refs/heads/main',
		workspaceId: overrides.workspaceId ?? 'workspace-1',
		generation: overrides.generation ?? 1,
		baseCommit: 'a'.repeat(40),
		objectFormat: 'sha1',
	},
	capabilities: ['read-source'],
});

beforeEach(() => {
	nextInstance = 0;
	const Panel: AgentPlugin['renderPanel'] = ({ context, projectId }) => {
		const [instance] = useState(() => ++nextInstance);
		return (
			<div data-testid='agent-panel' data-instance={instance}>
				{context.mode}:{projectId}
			</div>
		);
	};
	mockGetAvailableAgents.mockReset();
	mockGetAvailableAgents.mockReturnValue([{ renderPanel: Panel }]);
});

test('preserves one panel across equivalent contexts and remounts at every ownership boundary', () => {
	const { rerender } = render(
		<AgentPanelHost context={managedContext()} projectId='project-1' />,
	);
	const instance = () => screen.getByTestId('agent-panel').dataset.instance;
	let previous = instance();

	rerender(<AgentPanelHost context={managedContext()} projectId='project-1' />);
	expect(instance()).toBe(previous);

	for (const [context, projectId] of [
		[managedContext({ actorId: 'actor-2' }), 'project-1'],
		[managedContext({ actorId: 'actor-2', permissionEpoch: 'epoch-2' }), 'project-1'],
		[
			managedContext({
				actorId: 'actor-2',
				permissionEpoch: 'epoch-2',
				workspaceId: 'workspace-2',
			}),
			'project-1',
		],
		[
			managedContext({
				actorId: 'actor-2',
				permissionEpoch: 'epoch-2',
				workspaceId: 'workspace-2',
				generation: 2,
			}),
			'project-1',
		],
		[
			managedContext({
				actorId: 'actor-2',
				permissionEpoch: 'epoch-2',
				workspaceId: 'workspace-2',
				generation: 2,
			}),
			'project-2',
		],
	] as const) {
		rerender(<AgentPanelHost context={context} projectId={projectId} />);
		expect(instance()).not.toBe(previous);
		previous = instance();
	}
});

test('renders nothing when no Agent is available', () => {
	mockGetAvailableAgents.mockReturnValue([]);
	const { container } = render(
		<AgentPanelHost context={{ mode: 'local-unbound' }} projectId='local-project' />,
	);
	expect(container).toBeEmptyDOMElement();
});
