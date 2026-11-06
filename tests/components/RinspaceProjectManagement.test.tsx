// SPDX-License-Identifier: AGPL-3.0-or-later
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import WorkspaceProjectList from '@/components/project/WorkspaceProjectList';
import RinspaceProjectEdit from '@extras/workspace/rinspace/RinspaceProjectEdit';
import { loadRinspaceSession } from '@extras/workspace/rinspace/RinspaceSession';
import { updateProject } from '@extras/workspace/rinspace/RinspaceProjectCreation';
import type { WorkspaceCatalogProject } from '@/workspace/contracts';

jest.mock('@extras/workspace/rinspace/RinspaceSession', () => ({ loadRinspaceSession: jest.fn() }));
jest.mock('@extras/workspace/rinspace/RinspaceProjectCreation', () => ({
	searchBindableTags: jest.fn(async () => []),
	updateProject: jest.fn(async () => ({ repositoryId: '41' })),
}));
jest.mock('@extras/workspace/rinspace/RinspaceCoverField', () => ({
	__esModule: true,
	default: ({ onChange }: { onChange(value: string): void }) => <button type='button' onClick={() => onChange('/cover/new.jpg')}>Fixture cover</button>,
}));

const session = loadRinspaceSession as jest.MockedFunction<typeof loadRinspaceSession>;
const update = updateProject as jest.MockedFunction<typeof updateProject>;
const project: WorkspaceCatalogProject = {
	id: '41', name: 'Managed article', description: 'Summary', repositoryLabel: 'a/41',
	contentType: 'article', defaultRef: 'main', private: true, access: 'owner',
	openIntent: { mode: 'managed', owner: 'a', repository: '41', ref: 'main' },
	management: {
		contentId: '9', slug: 'managed-article', excerpt: 'Summary', coverUrl: '', sourceFormat: 'latex',
		sourceVisibility: 'private', publicationStatus: 'draft', tags: [{ id: '7', displayName: 'Algebra' }],
	},
};

beforeEach(() => {
	session.mockResolvedValue({ status: 'authenticated', csrfToken: 'proof', user: { id: 'alice', sessionEpoch: 1, identityVersion: 1 }, currentSession: { sid: 'sid', version: 1 } });
	jest.clearAllMocks();
});

it('shows owner-only native card management actions', () => {
	const edit = jest.fn();
	const remove = jest.fn();
	render(<WorkspaceProjectList projects={[project, { ...project, id: '42', access: 'collaborator', management: undefined }]} onOpenProject={async () => {}} onEditProject={edit} onDeleteProject={remove} />);
	const editButton = screen.getByTitle('Edit Project');
	const deleteButton = screen.getByTitle('Delete Project');
	expect(editButton).toHaveClass('button');
	expect(editButton).not.toHaveClass('secondary');
	expect(deleteButton).toHaveClass('button', 'danger');
	expect(deleteButton).not.toHaveClass('secondary');
	expect(editButton).not.toHaveTextContent('Edit');
	expect(deleteButton).not.toHaveTextContent('Delete');
	fireEvent.click(editButton);
	expect(edit).toHaveBeenCalledWith(project);
	fireEvent.click(deleteButton);
	expect(remove).toHaveBeenCalledWith(project);
});

it('keeps type and format fixed while saving editable metadata', async () => {
	const saved = jest.fn();
	render(<RinspaceProjectEdit project={project} onClose={() => {}} onSaved={saved} />);
	await waitFor(() => expect(session).toHaveBeenCalled());
	expect(screen.getByText((_content, element) => element?.textContent === 'Article · LaTeX')).toBeInTheDocument();
	fireEvent.change(screen.getByLabelText('Project Name'), { target: { value: 'Renamed article' } });
	fireEvent.change(screen.getByLabelText('Source visibility'), { target: { value: 'open' } });
	fireEvent.change(screen.getByLabelText('Publication status'), { target: { value: 'published' } });
	fireEvent.click(screen.getByRole('button', { name: 'Fixture cover' }));
	fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
	await waitFor(() => expect(update).toHaveBeenCalledWith('41', expect.objectContaining({
		title: 'Renamed article', sourceVisibility: 'open', publicationStatus: 'published', coverRef: '/cover/new.jpg', tagIds: ['7'],
	}), expect.any(AbortSignal), 'alice'));
	expect(saved).toHaveBeenCalled();
});
