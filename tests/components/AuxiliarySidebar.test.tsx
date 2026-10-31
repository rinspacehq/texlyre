import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import AuxiliaryPanelPortal from '@src/components/auxiliary/AuxiliaryPanelPortal';
import AuxiliarySidebarHost from '@src/components/auxiliary/AuxiliarySidebarHost';
import { AuxiliarySidebarProvider } from '@src/contexts/AuxiliarySidebarContext';

const AgentIcon = () => <svg aria-hidden='true' />;
const CommentIcon = () => <svg aria-hidden='true' />;

let agentInstances = 0;

const StatefulAgent = () => {
	const [instance] = useState(() => ++agentInstances);
	return <div data-testid='agent-content' data-instance={instance}>agent</div>;
};

const Fixture = () => {
	const [agentOpen, setAgentOpen] = useState(true);
	const [commentsOpen, setCommentsOpen] = useState(false);

	return (
		<AuxiliarySidebarProvider>
			<button type='button' onClick={() => setCommentsOpen(true)}>
				open comments externally
			</button>
			<AuxiliaryPanelPortal
				id='agent'
				label='琳'
				icon={AgentIcon}
				order={10}
				open={agentOpen}
				onOpenChange={setAgentOpen}
			>
				<StatefulAgent />
			</AuxiliaryPanelPortal>
			<AuxiliaryPanelPortal
				id='comments'
				label='评论'
				icon={CommentIcon}
				order={20}
				open={commentsOpen}
				onOpenChange={setCommentsOpen}
			>
				<div data-testid='comments-content'>comments</div>
			</AuxiliaryPanelPortal>
			<AuxiliarySidebarHost width={360} onResize={() => undefined} />
		</AuxiliarySidebarProvider>
	);
};

beforeEach(() => {
	agentInstances = 0;
});

test('uses one activity rail and keeps the Agent mounted across tool switches', async () => {
	render(<Fixture />);

	const agentTab = await screen.findByRole('tab', { name: '琳' });
	const commentsTab = screen.getByRole('tab', { name: '评论' });
	await waitFor(() => expect(agentTab).toHaveAttribute('aria-selected', 'true'));
	const instance = screen.getByTestId('agent-content').dataset.instance;

	fireEvent.click(commentsTab);
	await waitFor(() =>
		expect(commentsTab).toHaveAttribute('aria-selected', 'true'),
	);
	expect(screen.getByTestId('comments-content')).toBeInTheDocument();

	fireEvent.click(agentTab);
	await waitFor(() => expect(agentTab).toHaveAttribute('aria-selected', 'true'));
	expect(screen.getByTestId('agent-content').dataset.instance).toBe(instance);
});

test('collapses content while keeping the activity rail available', async () => {
	render(<Fixture />);

	const agentTab = await screen.findByRole('tab', { name: '琳' });
	await waitFor(() => expect(agentTab).toHaveAttribute('aria-selected', 'true'));
	fireEvent.click(screen.getByRole('button', { name: 'Close' }));

	await waitFor(() => expect(agentTab).toHaveAttribute('aria-selected', 'false'));
	expect(screen.getByRole('tablist', { name: 'Tools' })).toBeInTheDocument();
	expect(screen.getByRole('tab', { name: '评论' })).toBeInTheDocument();
});

test('selects a panel when an existing external control opens it', async () => {
	render(<Fixture />);

	const commentsTab = await screen.findByRole('tab', { name: '评论' });
	fireEvent.click(
		screen.getByRole('button', { name: 'open comments externally' }),
	);

	await waitFor(() =>
		expect(commentsTab).toHaveAttribute('aria-selected', 'true'),
	);
	expect(screen.getByRole('tab', { name: '琳' })).toHaveAttribute(
		'aria-selected',
		'false',
	);
});
