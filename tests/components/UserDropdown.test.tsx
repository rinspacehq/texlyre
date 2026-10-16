// SPDX-License-Identifier: AGPL-3.0-or-later
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import UserDropdown from '@src/components/profile/UserDropdown';
import type { WorkspaceProjectCatalog } from '@src/workspace/contracts';

let mockCatalog: WorkspaceProjectCatalog | undefined;
let mockLocalProfile = true;
jest.mock('@src/hooks/useAuth', () => ({ useAuth: () => ({ user: { isLocalProfile: mockLocalProfile } }) }));
jest.mock('@src/plugins/PluginRegistry', () => ({ pluginRegistry: { getWorkspaceExtensions: () => ({ catalog: mockCatalog }) } }));
jest.mock('@src/hooks/useStorageQuota', () => ({ useStorageQuota: () => ({ isSupported: false, isLow: false, usageBytes: 0, quotaBytes: 0, usedRatio: 0 }) }));

const props = { username: 'Local workspace', onLogout: jest.fn(), onOpenProfile: jest.fn(), onOpenExport: jest.fn(), onOpenDeleteAccount: jest.fn() };
const getAccount = jest.fn().mockResolvedValue({ actorId: 'native-1', displayName: '真实昵称', avatarUrl: 'https://cdn.example/avatar.png' });
beforeEach(() => {
	jest.clearAllMocks();
	mockLocalProfile = true;
	mockCatalog = { isEnabled: () => true, getAccount, subscribe: () => () => {}, listPage: async () => ({ status: 'anonymous', projects: [] }) };
});

test('the real avatar and nickname are the single menu trigger, not a second header identity', async () => {
	const { container } = render(<UserDropdown {...props} />);
	const trigger = await screen.findByRole('button', { name: '真实昵称' });
	expect(trigger.querySelector('img')).toHaveAttribute('src', 'https://cdn.example/avatar.png');
	expect(screen.queryByText('Local workspace')).not.toBeInTheDocument();
	expect(container.querySelectorAll('.user-dropdown-button')).toHaveLength(1);
	expect(container.querySelectorAll('[data-role="workspace-account"]')).toHaveLength(1);
	expect(trigger).toHaveAttribute('aria-expanded', 'false');
	fireEvent.click(trigger);
	expect(trigger).toHaveAttribute('aria-expanded', 'true');
	expect(await screen.findByText('Browser Storage')).toHaveAttribute('title', 'Manage or delete TeXlyre data stored by this browser.');
	fireEvent.click(screen.getByRole('button', { name: 'Export', exact: true }));
	expect(props.onOpenExport).toHaveBeenCalledTimes(1);
	expect(props.onLogout).not.toHaveBeenCalled();
	await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'false'));
});

test('standalone local mode retains its existing menu and makes no account request', () => {
	mockCatalog = undefined;
	render(<UserDropdown {...props} />);
	fireEvent.click(screen.getByRole('button', { name: 'Local workspace' }));
	expect(getAccount).not.toHaveBeenCalled();
	expect(screen.getByText('Browser Storage')).toBeInTheDocument();
	expect(screen.queryByRole('button', { name: 'Delete Account' })).not.toBeInTheDocument();
});

test('ordinary named accounts and guests keep their original labels and callbacks', () => {
	mockCatalog = undefined;
	mockLocalProfile = false;
	const { rerender } = render(<UserDropdown {...props} username='Standalone writer' />);
	fireEvent.click(screen.getByRole('button', { name: 'Standalone writer' }));
	expect(screen.getByRole('button', { name: 'Export Account' })).toBeInTheDocument();
	expect(screen.getByRole('button', { name: 'Log out' })).toBeInTheDocument();
	rerender(<UserDropdown {...props} isGuest />);
	expect(screen.getByRole('button', { name: 'Guest User' })).toBeInTheDocument();
});
