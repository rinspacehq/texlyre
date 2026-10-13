// SPDX-License-Identifier: AGPL-3.0-or-later
import { useContext } from 'react';
import { render, screen } from '@testing-library/react';
import * as Y from 'yjs';

import { ChatContext, ChatProvider } from '@src/contexts/ChatContext';
import { collabService } from '@src/services/CollabService';

jest.mock('@src/hooks/useAuth', () => ({
	useAuth: () => ({ user: { id: 'actor-1', username: 'Alice' } }),
}));

jest.mock('@src/hooks/useSettings', () => ({
	useSettings: (() => {
		const getSetting = (id: string) => ({
			value: id === 'collab-signaling-servers' ? 'wss://signal.example.test' : false,
		});
		return () => ({ getSetting });
	})(),
}));

function ConnectionProbe() {
	const chat = useContext(ChatContext);
	return <p>{chat?.isConnected ? 'network-connected' : 'local-only'}</p>;
}

describe('project chat connection state', () => {
	it('does not present an IndexedDB-only Y.Doc as a live collaborator connection', async () => {
		const doc = new Y.Doc();
		const connect = jest.spyOn(collabService, 'connect').mockReturnValue({
			doc,
			provider: null,
		});
		const disconnect = jest.spyOn(collabService, 'disconnect').mockImplementation();

		const view = render(
			<ChatProvider docUrl='yjs:managed-workspace'>
				<ConnectionProbe />
			</ChatProvider>,
		);

		expect(await screen.findByText('local-only')).toBeInTheDocument();
		expect(connect).toHaveBeenCalledWith(
			'managed-workspace',
			'chat',
			expect.objectContaining({
				signalingServers: ['wss://signal.example.test'],
			}),
		);

		view.unmount();
		expect(disconnect).toHaveBeenCalledWith('managed-workspace', 'chat');
		doc.destroy();
	});
});
