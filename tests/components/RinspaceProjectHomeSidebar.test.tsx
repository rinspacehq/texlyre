// SPDX-License-Identifier: AGPL-3.0-or-later
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import RinspaceProjectHomeSidebar from '@extras/workspace/rinspace/RinspaceProjectHomeSidebar';
import { publishRinspaceProjects, setRinspaceProjectTag, setRinspaceProjectType } from '@extras/workspace/rinspace/RinspaceProjectHomeState';

jest.mock('@src/i18n', () => ({
	t: (key: string) => key,
}));

afterEach(() => {
	publishRinspaceProjects([]);
	setRinspaceProjectTag('');
	setRinspaceProjectType('');
});

test('uses the native project-panel hierarchy for filters and recent projects', async () => {
	const onOpenProject = jest.fn(async () => {});
	publishRinspaceProjects([{
		id: '41', name: 'Recent article', description: 'Native card', repositoryLabel: 'a/41', contentType: 'article',
		tags: ['Math'], defaultRef: 'main', updatedAt: Date.now(), private: true, access: 'owner',
		openIntent: { mode: 'managed', owner: 'a', repository: '41', ref: 'main' },
	}]);
	const { container } = render(<RinspaceProjectHomeSidebar searchQuery='' onSearch={jest.fn()} onCreate={jest.fn()} onRefresh={jest.fn()} onOpenProject={onOpenProject} />);
	expect(container.querySelector('[data-role="project-panel"]')).toBeInTheDocument();
	expect(screen.getByRole('heading', { name: 'Projects' })).toBeInTheDocument();
	expect(screen.getByRole('option', { name: 'Math' })).toBeInTheDocument();
	expect(screen.getByRole('option', { name: 'article' })).toBeInTheDocument();
	fireEvent.click(screen.getByRole('button', { name: /Recent article/ }));
	await waitFor(() => expect(onOpenProject).toHaveBeenCalledWith(expect.objectContaining({ id: '41' })));
});
