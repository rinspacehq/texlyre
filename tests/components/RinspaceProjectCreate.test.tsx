// SPDX-License-Identifier: AGPL-3.0-or-later
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import RinspaceProjectCreate from '@extras/workspace/rinspace/RinspaceProjectCreate';
import { createProject, createTag, projectCreationCapability, RinspaceRequestError, tagCandidates, tagOperation, uploadProjectCover } from '@extras/workspace/rinspace/RinspaceProjectCreation';

jest.mock('@/i18n', () => ({
	t: (key: string, values?: Record<string, unknown>) => values
		? Object.entries(values).reduce((text, [name, value]) => text.replace(`{${name}}`, String(value)), key)
		: key,
}));
jest.mock('@extras/workspace/rinspace/RinspaceSession', () => ({
	loadRinspaceSession: jest.fn(async () => ({ user: { id: 'actor-1' }, csrfToken: 'fixture' })),
}));
jest.mock('@extras/workspace/rinspace/RinspaceProjectCreation', () => ({
	projectCreationCapability: jest.fn(async () => ({
		schemaVersion: 'rinspace-editor-project-creation/v1', enabled: true,
		kinds: ['article', 'book'], sourceFormats: ['latex', 'markdown', 'typst'],
		maxTags: 6, defaultVisibility: 'private', tagCreationEnabled: true,
	})),
	searchBindableTags: jest.fn(async () => []),
	tagCandidates: jest.fn(async () => [{ id: 41, displayName: 'Related Tag', usageScope: 'Existing use', parentTagIds: [] }]),
	createTag: jest.fn(async () => ({ operationId: 'tag-operation-1', state: 'pending' })),
	createProject: jest.fn(),
	uploadProjectCover: jest.fn(),
	tagOperation: jest.fn(async () => ({ operationId: 'tag-operation-1', state: 'pending' })),
	RinspaceRequestError: class extends Error {
		constructor(public readonly status: number, public readonly code: string) { super(code); }
	},
}));

function startTagFlow() {
	const view = render(<RinspaceProjectCreate onClose={jest.fn()} onOpen={jest.fn()} />);
	return view;
}

async function fillTag() {
	await screen.findByLabelText('Tags');
	fireEvent.change(screen.getByLabelText('Tags'), { target: { value: 'New Tag' } });
	fireEvent.click(screen.getByRole('button', { name: 'Create “New Tag”' }));
	fireEvent.change(screen.getByLabelText('Usage scope'), { target: { value: 'For this research area' } });
}

beforeEach(() => {
	localStorage.clear();
	jest.clearAllMocks();
});

it('shows canonical matches before allowing an intentional Tag creation', async () => {
	startTagFlow();
	await fillTag();
	expect(screen.queryByText('No Tag selected. General will be attached automatically.')).not.toBeInTheDocument();
	fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
	await screen.findByText('Matching Tags already exist. Choose one:');
	expect(screen.getByRole('button', { name: /Related Tag/ })).toHaveClass('ui-list-item');
	expect(createTag).not.toHaveBeenCalled();
	fireEvent.click(screen.getByRole('button', { name: 'Create tag' }));
	await waitFor(() => expect(createTag).toHaveBeenCalledWith(
		expect.objectContaining({ displayName: 'New Tag', usageScope: 'For this research area', parentTagIds: [] }),
		expect.any(AbortSignal), 'actor-1',
	));
	expect(tagCandidates).toHaveBeenCalledTimes(1);
	await waitFor(() => expect(tagOperation).toHaveBeenCalled());
});

it('rechecks matches after the Tag context changes and restores the scope after refresh', async () => {
	const view = startTagFlow();
	await fillTag();
	fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
	await screen.findByText('Matching Tags already exist. Choose one:');
	fireEvent.change(screen.getByLabelText('Usage scope'), { target: { value: 'Revised context' } });
	expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument();
	fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
	await waitFor(() => expect(tagCandidates).toHaveBeenCalledTimes(2));
	expect(createTag).not.toHaveBeenCalled();
	await waitFor(() => expect(JSON.parse(localStorage.getItem('rinspace-project-create-v1:actor-1') || '{}').tagScope).toBe('Revised context'));
	view.unmount();
	startTagFlow();
	expect(await screen.findByLabelText('Usage scope')).toHaveValue('Revised context');
});

it('offers an explicit fresh request when a changed draft conflicts with its saved key', async () => {
	jest.mocked(createProject).mockRejectedValueOnce(new RinspaceRequestError(409, 'idempotency_key_conflict', 'Rinspace request'));
	startTagFlow();
	fireEvent.change(await screen.findByLabelText('Project Name'), { target: { value: 'Draft' } });
	fireEvent.click(screen.getByRole('button', { name: 'Create Project' }));
	fireEvent.click(await screen.findByRole('button', { name: 'Discard this attempt and start over' }));
	expect(screen.getByLabelText('Project Name')).toHaveValue('');
});

it('does not stage a cover when the user cancels the crop', async () => {
	const oldCreateURL = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
	const oldRevokeURL = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
	Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: jest.fn(() => 'blob:cover-fixture') });
	Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: jest.fn() });
	try {
		startTagFlow();
		fireEvent.change(await screen.findByLabelText('Cover image'), {
			target: { files: [new File(['picture'], 'cover.png', { type: 'image/png' })] },
		});
		expect(screen.getByText('Crop project cover')).toBeInTheDocument();
		fireEvent.click(screen.getByRole('button', { name: 'Cancel crop' }));
		expect(screen.queryByText('Crop project cover')).not.toBeInTheDocument();
		expect(uploadProjectCover).not.toHaveBeenCalled();
		expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:cover-fixture');
	} finally {
		if (oldCreateURL) Object.defineProperty(URL, 'createObjectURL', oldCreateURL); else Reflect.deleteProperty(URL, 'createObjectURL');
		if (oldRevokeURL) Object.defineProperty(URL, 'revokeObjectURL', oldRevokeURL); else Reflect.deleteProperty(URL, 'revokeObjectURL');
	}
});

it('uses compact project choices without instructional helper copy', async () => {
	startTagFlow();
	await screen.findByLabelText('Project Name');
	expect(screen.getByRole('option', { name: 'Draft' })).toBeInTheDocument();
	expect(screen.getByRole('option', { name: 'Published' })).toBeInTheDocument();
	expect(screen.getByRole('option', { name: 'Private' })).toBeInTheDocument();
	expect(screen.getByRole('option', { name: 'Public' })).toBeInTheDocument();
	expect(screen.queryByText('Source visibility and publication are separate settings.')).not.toBeInTheDocument();
	expect(screen.queryByText('Click, drop, or paste PNG, JPEG, or WebP (max 20 MiB)')).not.toBeInTheDocument();
});

it('renders the project form immediately while capability loading remains read-only', async () => {
	let resolveCapability: ((value: Awaited<ReturnType<typeof projectCreationCapability>>) => void) | undefined;
	jest.mocked(projectCreationCapability).mockImplementationOnce(
		() => new Promise((resolve) => { resolveCapability = resolve; }),
	);
	const view = startTagFlow();
	expect(screen.getByLabelText('Project Name')).toBeInTheDocument();
	expect(view.container.querySelector('.loading-spinner')).not.toBeInTheDocument();
	fireEvent.change(screen.getByLabelText('Project Name'), { target: { value: 'Immediate draft' } });
	expect(screen.getByRole('button', { name: 'Create Project' })).toBeDisabled();
	await act(async () => resolveCapability?.({
		schemaVersion: 'rinspace-editor-project-creation/v1', enabled: true,
		kinds: ['article', 'book'], sourceFormats: ['latex', 'markdown', 'typst'],
		maxTags: 6, defaultVisibility: 'private', tagCreationEnabled: true,
	}));
	await waitFor(() => expect(screen.getByRole('button', { name: 'Create Project' })).toBeEnabled());
});
