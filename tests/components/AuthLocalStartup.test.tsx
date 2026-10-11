// SPDX-License-Identifier: AGPL-3.0-or-later
import { useContext } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { AuthContext, AuthProvider } from '@src/contexts/AuthContext';
import { authService } from '@src/services/AuthService';
import type { User } from '@src/types/auth';

jest.mock('@src/services/AuthService', () => ({
	authService: { initialize: jest.fn(), getCurrentUser: jest.fn() },
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
		window.history.replaceState(null, '', '/');
		jest.mocked(authService.initialize).mockResolvedValue();
		jest.mocked(authService.getCurrentUser).mockReturnValue(profile);
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
	it('does not downgrade managed requests to local mode', async () => {
		window.history.replaceState(null, '', '/?mode=managed&type=article&id=123');
		render(<AuthProvider><StartupProbe /></AuthProvider>);
		expect(await screen.findByRole('alert')).toHaveTextContent('local fallback is disabled');
		expect(authService.initialize).not.toHaveBeenCalled();
	});
	it('fails closed for duplicate modes', async () => {
		window.history.replaceState(null, '', '/?mode=local&mode=managed');
		render(<AuthProvider><StartupProbe /></AuthProvider>);
		await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Invalid workspace mode'));
		expect(authService.initialize).not.toHaveBeenCalled();
	});
});
