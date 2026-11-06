// SPDX-License-Identifier: AGPL-3.0-or-later
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import RinspaceProjectHomeContent from '@extras/workspace/rinspace/RinspaceProjectHomeContent';
import type { WorkspaceCatalogPage, WorkspaceCatalogProject, WorkspaceProjectCatalog } from '@src/workspace/contracts';

let catalog: WorkspaceProjectCatalog | undefined;
jest.mock('@/plugins/PluginRegistry', () => ({ pluginRegistry: { getWorkspaceExtensions: () => ({ catalog }) } }));
jest.mock('@src/i18n', () => ({
	t: (key: string, values?: Record<string, unknown>) => values
		? Object.entries(values).reduce((text, [name, value]) => text.replace(`{${name}}`, String(value)), key)
		: key,
}));

const ownedProject: WorkspaceCatalogProject = {
	id: '41', name: 'Owned article', description: 'Source project', repositoryLabel: 'a/41', contentType: 'article',
	defaultRef: 'main', private: false, access: 'owner', openIntent: { mode: 'managed', owner: 'a', repository: '41', ref: 'main' },
};
const managedProject: WorkspaceCatalogProject = {
	...ownedProject,
	management: {
		contentId: '41',
		slug: 'owned-article',
		excerpt: 'Source project',
		coverUrl: '',
		sourceFormat: 'latex',
		sourceVisibility: 'open',
		publicationStatus: 'draft',
		tags: [],
	},
};

function fakeCatalog(result: WorkspaceCatalogPage): WorkspaceProjectCatalog {
	return { isEnabled: () => true, subscribe: () => () => {}, listPage: jest.fn(async () => result) };
}

afterEach(() => {
	catalog = undefined;
	jest.clearAllMocks();
});

test('loads the bounded full catalog so native sorting and filters are not page-local', async () => {
	const listPage = jest.fn(async ({ page }: { page: number }) => ({
		status: 'authenticated' as const, accountLabel: 'alice', page, hasMore: page === 1,
		...(page === 1 ? { nextCursor: '73' } : {}),
		projects: [{ ...ownedProject, id: String(page), name: `Page project ${page}` }],
	}));
	catalog = { isEnabled: () => true, subscribe: () => () => {}, listPage };
	render(<RinspaceProjectHomeContent onOpenProject={jest.fn()} />);
	expect(await screen.findByText('Page project 1')).toBeInTheDocument();
	expect(await screen.findByText('Page project 2')).toBeInTheDocument();
	expect(listPage.mock.calls).toEqual([
		[{ page: 1, pageSize: 50 }, expect.any(AbortSignal)],
		[{ page: 2, pageSize: 50, cursor: '73' }, expect.any(AbortSignal)],
	]);
	expect(screen.queryByRole('button', { name: 'Next →' })).not.toBeInTheDocument();
});

test('warms account-scoped create capability while the Rinspace project home is visible', async () => {
	const getAccount = jest.fn(async () => ({
		actorId: 'native-1',
		displayName: 'Alice',
	}));
	catalog = {
		...fakeCatalog({
			status: 'authenticated',
			accountLabel: 'alice',
			page: 1,
			hasMore: false,
			projects: [ownedProject],
		}),
		getAccount,
	};
	render(<RinspaceProjectHomeContent onOpenProject={jest.fn()} />);
	await screen.findByText('Owned article');
	await waitFor(() => expect(getAccount).toHaveBeenCalledWith(expect.any(AbortSignal)));
});

test('an explicit refresh starts from page one and invalidates provider caches', async () => {
	const invalidate = jest.fn();
	const listPage = jest.fn(async () => ({ status: 'authenticated' as const, accountLabel: 'alice', page: 1, hasMore: false, projects: [ownedProject] }));
	catalog = { isEnabled: () => true, subscribe: () => () => {}, invalidate, listPage };
	const { rerender } = render(<RinspaceProjectHomeContent onOpenProject={jest.fn()} refreshEpoch={0} />);
	await screen.findByText('Owned article');
	rerender(<RinspaceProjectHomeContent onOpenProject={jest.fn()} refreshEpoch={1} />);
	await waitFor(() => expect(listPage).toHaveBeenCalledTimes(2));
	expect(invalidate).toHaveBeenCalledTimes(1);
	expect(listPage).toHaveBeenLastCalledWith({ page: 1, pageSize: 50 }, expect.any(AbortSignal));
});

test('ignores a late continuation after the complete-catalog search changes', async () => {
	let releaseNext: ((page: WorkspaceCatalogPage) => void) | undefined;
	const listPage = jest.fn(async ({ page, query }: { page: number; query?: string }): Promise<WorkspaceCatalogPage> => {
		if (page === 2) return new Promise((resolve) => { releaseNext = resolve; });
		return { status: 'authenticated', accountLabel: 'alice', page: 1, hasMore: !query,
			...(!query ? { nextCursor: '73' } : {}), projects: [{ ...ownedProject, name: query ? 'Fresh search result' : 'Initial page' }] };
	});
	catalog = { isEnabled: () => true, subscribe: () => () => {}, listPage };
	const { rerender } = render(<RinspaceProjectHomeContent onOpenProject={jest.fn()} />);
	await screen.findByText('Initial page');
	await waitFor(() => expect(releaseNext).toBeDefined());
	rerender(<RinspaceProjectHomeContent onOpenProject={jest.fn()} searchQuery='fresh' />);
	expect(await screen.findByText('Fresh search result')).toBeInTheDocument();
	await act(async () => releaseNext?.({ status: 'authenticated', accountLabel: 'alice', page: 2, hasMore: false, projects: [{ ...ownedProject, name: 'Obsolete page' }] }));
	expect(screen.queryByText('Obsolete page')).not.toBeInTheDocument();
});

test('does not request or display account projects when the integration is disabled', async () => {
	const listPage = jest.fn();
	catalog = { isEnabled: () => false, subscribe: () => () => {}, listPage };
	const { container } = render(<RinspaceProjectHomeContent onOpenProject={jest.fn()} />);
	await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
	expect(listPage).not.toHaveBeenCalled();
	expect(container).toBeEmptyDOMElement();
});

test('forwards debounced search to the complete server catalog', async () => {
	const listPage = jest.fn(async ({ query }: { query?: string }) => ({
		status: 'authenticated' as const, accountLabel: 'alice', page: 1, hasMore: false,
		projects: query ? [{ ...ownedProject, id: '9000', name: 'Global match' }] : [ownedProject],
	}));
	catalog = { isEnabled: () => true, subscribe: () => () => {}, listPage };
	const { rerender } = render(<RinspaceProjectHomeContent onOpenProject={jest.fn()} />);
	await screen.findByText('Owned article');
	rerender(<RinspaceProjectHomeContent onOpenProject={jest.fn()} searchQuery='remote title' />);
	expect(await screen.findByText('Global match')).toBeInTheDocument();
	expect(listPage).toHaveBeenLastCalledWith({ page: 1, pageSize: 50, query: 'remote title' }, expect.any(AbortSignal));
});

test('shows a sign-in state for an anonymous Native session', async () => {
	catalog = fakeCatalog({ status: 'anonymous', projects: [] });
	render(<RinspaceProjectHomeContent onOpenProject={jest.fn()} />);
	expect(await screen.findByText('Rinspace sign-in is required')).toBeInTheDocument();
});

test('renders native cards and delegates opening without Local-only actions', async () => {
	catalog = fakeCatalog({ status: 'authenticated', accountLabel: 'alice', page: 1, hasMore: false,
		projects: [{ ...ownedProject, name: 'Shared article', private: true, access: 'collaborator', tags: ['Math'] }] });
	const onOpen = jest.fn(async () => {});
	render(<RinspaceProjectHomeContent onOpenProject={onOpen} />);
	expect(await screen.findByText('Shared article')).toBeInTheDocument();
	expect(screen.getByText('Sort by:')).toBeInTheDocument();
	expect(screen.getByText('Collaborator · Private')).toBeInTheDocument();
	expect(screen.getByText('Math')).toBeInTheDocument();
	expect(screen.queryByText('Delete Project')).not.toBeInTheDocument();
	fireEvent.click(screen.getByRole('button', { name: 'Open' }));
	await waitFor(() => expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: '41' })));
});

test('uses the native TeXlyre warning, list, and danger-action pattern for deletion', async () => {
	catalog = fakeCatalog({
		status: 'authenticated',
		accountLabel: 'alice',
		page: 1,
		hasMore: false,
		projects: [managedProject],
	});
	render(<RinspaceProjectHomeContent onOpenProject={jest.fn()} />);
	fireEvent.click(await screen.findByTitle('Delete Project'));
	const warning = screen.getByText('Delete “Owned article” and its managed repository?').closest('.ui-message');
	expect(warning).toHaveAttribute('data-tone', 'warning');
	expect(document.querySelector('.modal-overlay .ui-list-item')).toHaveTextContent('a/41');
	expect(screen.getByRole('button', { name: 'Delete project' })).toHaveClass('button', 'danger');
});

test('keeps preparing projects visible but not openable', async () => {
	catalog = fakeCatalog({ status: 'authenticated', accountLabel: 'alice', page: 1, hasMore: false, projects: [{ ...ownedProject, readiness: 'preparing' }] });
	render(<RinspaceProjectHomeContent onOpenProject={jest.fn()} />);
	expect(await screen.findByText('Preparing project files...')).toBeInTheDocument();
	expect(screen.getByRole('button', { name: 'Open' })).toBeDisabled();
});

test('does not reload the catalog on focus or visibility', async () => {
	catalog = fakeCatalog({ status: 'authenticated', accountLabel: 'alice', page: 1, hasMore: false, projects: [] });
	render(<RinspaceProjectHomeContent onOpenProject={jest.fn()} />);
	await screen.findByText('No projects found matching the current criteria');
	const calls = (catalog.listPage as jest.Mock).mock.calls.length;
	fireEvent.focus(window);
	fireEvent(document, new Event('visibilitychange'));
	await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
	expect(catalog.listPage).toHaveBeenCalledTimes(calls);
});

test('reports a catalog failure locally and retries', async () => {
	let available = false;
	const listPage = jest.fn(async () => {
		if (!available) throw new Error('Catalog unavailable');
		return { status: 'authenticated', accountLabel: 'alice', page: 1, hasMore: false, projects: [ownedProject] } as const;
	});
	catalog = { isEnabled: () => true, subscribe: () => () => {}, listPage };
	render(<RinspaceProjectHomeContent onOpenProject={jest.fn()} />);
	expect(await screen.findByText('Catalog unavailable')).toBeInTheDocument();
	available = true;
	fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
	expect(await screen.findByText('Owned article')).toBeInTheDocument();
});
