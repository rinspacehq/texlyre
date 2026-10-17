// SPDX-License-Identifier: AGPL-3.0-or-later
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import WorkspaceAccountIndicator from '@src/components/workspace/WorkspaceAccountIndicator';
import type { WorkspaceAccountIdentity, WorkspaceProjectCatalog } from '@src/workspace/contracts';

let mockCatalog: WorkspaceProjectCatalog | undefined;
jest.mock('@src/plugins/PluginRegistry', () => ({ pluginRegistry: { getWorkspaceExtensions: () => ({ catalog: mockCatalog }) } }));
const account: WorkspaceAccountIdentity = { actorId: 'native-1', displayName: '真实昵称', avatarUrl: 'https://cdn.example/avatar.png' };
const getAccount = jest.fn<Promise<WorkspaceAccountIdentity | null>, [AbortSignal]>();
let notify = () => {};
beforeEach(() => {
	getAccount.mockReset().mockResolvedValue(account);
	mockCatalog = { isEnabled: () => true, getAccount, subscribe: listener => { notify = listener; return () => {}; }, listPage: async () => ({ status: 'anonymous', projects: [] }) };
});

test('unhosted local mode does not make platform requests', () => {
	mockCatalog = undefined;
	const { container } = render(<WorkspaceAccountIndicator />);
	expect(container).toBeEmptyDOMElement();
	expect(getAccount).not.toHaveBeenCalled();
});

test('shows Native nickname and avatar independently of local account ownership', async () => {
	const { container } = render(<WorkspaceAccountIndicator />);
	expect(await screen.findByLabelText('真实昵称')).toHaveTextContent('真实昵称');
	const image = container.querySelector('img');
	expect(image).toHaveAttribute('src', account.avatarUrl);
	expect(image).toHaveAttribute('referrerpolicy', 'no-referrer');
	fireEvent.error(image!);
	expect(container.querySelector('img')).toBeNull();
	expect(screen.getByLabelText('真实昵称')).toHaveTextContent('真实昵称');
});

test('clears a prior platform identity when login changes to anonymous', async () => {
	render(<WorkspaceAccountIndicator />);
	await screen.findByLabelText('真实昵称');
	getAccount.mockResolvedValue(null);
	act(() => notify());
	await waitFor(() => expect(screen.queryByLabelText('真实昵称')).not.toBeInTheDocument());
});

test('a theme-only change does not reload the platform identity', async () => {
	render(<WorkspaceAccountIndicator />);
	await screen.findByLabelText('真实昵称');
	const calls = getAccount.mock.calls.length;
	act(() => window.dispatchEvent(new StorageEvent('storage', { key: 'rinspace-theme-v2', newValue: 'dark' })));
	expect(getAccount).toHaveBeenCalledTimes(calls);
});

test('does not display a late account response after a newer anonymous result', async () => {
	const pending: Array<(value: WorkspaceAccountIdentity | null) => void> = [];
	getAccount.mockImplementation(() => new Promise(resolve => pending.push(resolve)));
	render(<WorkspaceAccountIndicator />);
	getAccount.mockResolvedValue(null);
	act(() => notify());
	await act(async () => { pending.forEach(resolve => resolve(account)); });
	expect(screen.queryByLabelText('真实昵称')).not.toBeInTheDocument();
});

test('reports an unavailable platform profile instead of showing a stale identity', async () => {
	getAccount.mockRejectedValue(new Error('Synthetic profile service unavailable'));
	render(<WorkspaceAccountIndicator />);
	expect(await screen.findByTitle('Rinspace account unavailable')).toBeInTheDocument();
	expect(screen.queryByLabelText('真实昵称')).not.toBeInTheDocument();
});
