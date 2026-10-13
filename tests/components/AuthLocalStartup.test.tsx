// SPDX-License-Identifier: AGPL-3.0-or-later
import { useContext } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { AuthContext, AuthProvider } from '@src/contexts/AuthContext';
import { authService } from '@src/services/AuthService';
import type { User } from '@src/types/auth';

jest.mock('@src/services/AuthService', () => ({
	authService: { initialize: jest.fn(), getCurrentUser: jest.fn() },
}));
const mockManagedOpen = jest.fn();
jest.mock('@src/plugins/PluginRegistry', () => ({
	pluginRegistry: {
		getWorkspaceExtensions: () => ({
			host: {
				open: mockManagedOpen,
				onContextInvalidated: () => () => {},
			},
		}),
	},
}));

const profile: User = { id: 'local_browser-owner', username: 'Local workspace',
	passwordHash: '', createdAt: 1, isLocalProfile: true };
function StartupProbe() {
	const { user, isInitializing } = useContext(AuthContext);
	return <p>{isInitializing ? 'Initializing' : user?.isLocalProfile ? 'Local ready' : 'No local owner'}</p>;
}

describe('local route bootstrap', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		mockManagedOpen.mockReset();
		window.history.replaceState(null, '', '/');
		jest.mocked(authService.initialize).mockResolvedValue();
		jest.mocked(authService.getCurrentUser).mockReturnValue(profile);
		mockManagedOpen.mockResolvedValue({
			mode: 'managed',
			identity: { actorId: 'rin-user-1', permissionEpoch: '1:1:1' },
			binding: {
				repositoryId: '73', branchBindingId: 'branch-73', ref: 'refs/heads/main',
				workspaceId: 'workspace-73', generation: 1, baseCommit: 'a'.repeat(40),
				objectFormat: 'sha1',
			},
			capabilities: ['read-source'],
		});
	});
	it('opens the direct route without a login action', async () => {
		render(<AuthProvider><StartupProbe /></AuthProvider>);
		await screen.findByText('Local ready');
		expect(authService.initialize).toHaveBeenCalledWith({ persistentLocalProfile: true });
	});
	it('reports storage initialization failure instead of showing a saved local workspace', async () => {
		jest.mocked(authService.initialize).mockRejectedValue(new Error('Synthetic storage quota failure'));
		render(<AuthProvider><StartupProbe /></AuthProvider>);
		expect(await screen.findByRole('alert')).toHaveTextContent('Synthetic storage quota failure');
		expect(screen.queryByText('Local ready')).not.toBeInTheDocument();
	});
	it('opens managed mode only through the packaged verified host adapter', async () => {
		window.history.replaceState(null, '', '/?mode=managed&owner=a&repository=42&ref=main');
		render(<AuthProvider><StartupProbe /></AuthProvider>);
		await screen.findByText('Local ready');
		expect(mockManagedOpen).toHaveBeenCalledWith(
			expect.objectContaining({ mode: 'managed', owner: 'a', repository: '42', ref: 'main' }),
			expect.any(AbortSignal),
		);
		expect(authService.initialize).toHaveBeenCalledWith({ persistentLocalProfile: true });
	});
	it('does not downgrade a failed managed binding to the local profile', async () => {
		window.history.replaceState(null, '', '/?mode=managed&owner=a&repository=42');
		mockManagedOpen.mockReset();
		mockManagedOpen.mockRejectedValue(new Error('Repository access is not permitted'));
		render(<AuthProvider><StartupProbe /></AuthProvider>);
		expect(await screen.findByRole('alert')).toHaveTextContent('not permitted');
		expect(authService.initialize).toHaveBeenCalledWith({ persistentLocalProfile: true });
	});
	it('fails closed for duplicate modes', async () => {
		window.history.replaceState(null, '', '/?mode=local&mode=managed');
		render(<AuthProvider><StartupProbe /></AuthProvider>);
		await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Invalid workspace mode'));
		expect(authService.initialize).not.toHaveBeenCalled();
	});
});
