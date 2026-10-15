// SPDX-License-Identifier: AGPL-3.0-or-later
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import WorkspaceCatalogSection from '@src/components/project/WorkspaceCatalogSection';
import type {
	WorkspaceCatalogPage,
	WorkspaceCatalogProject,
	WorkspaceProjectCatalog,
} from '@src/workspace/contracts';

let catalog: WorkspaceProjectCatalog | undefined;
jest.mock('@src/plugins/PluginRegistry', () => ({
	pluginRegistry: {
		getWorkspaceExtensions: () => ({ catalog }),
	},
}));
jest.mock('@src/i18n', () => ({
	t: (key: string, values?: Record<string, unknown>) =>
		values
			? Object.entries(values).reduce(
				(current, [name, value]) => current.replace(`{${name}}`, String(value)),
				key,
			)
			: key,
}));

function fakeCatalog(result: WorkspaceCatalogPage): WorkspaceProjectCatalog {
	return {
		isEnabled: () => true,
		subscribe: () => () => {},
		listPage: jest.fn(async () => result),
	};
}

const ownedProject: WorkspaceCatalogProject = {
	id: '41',
	name: 'Owned article',
	description: 'Source project',
	repositoryLabel: 'a/41',
	contentType: 'article',
	defaultRef: 'main',
	private: false,
	access: 'owner',
	openIntent: { mode: 'managed', owner: 'a', repository: '41', ref: 'main' },
};

describe('WorkspaceCatalogSection', () => {
	it('forwards an opaque continuation and clears it when the query changes', async () => {
		const listPage = jest.fn(async ({ page, query }: {page:number;query?:string}) => ({
			status: 'authenticated' as const, accountLabel: 'alice', page, hasMore: page === 1,
			...(page === 1 ? {nextCursor: 'opaque-next'} : {}),
			projects: [{...ownedProject, id: query ? '90' : String(page), name: query ? 'Search match' : `Project ${page}`}],
		}));
		catalog = {isEnabled:()=>true,subscribe:()=>()=>{},listPage};
		const onOpen=jest.fn();
		const {rerender}=render(<WorkspaceCatalogSection onOpenProject={onOpen}/>);
		await screen.findByText('Project 1');
		fireEvent.click(screen.getByRole('button',{name:/Load more/i}));
		await screen.findByText('Project 2');
		expect(listPage).toHaveBeenLastCalledWith({page:2,pageSize:24,cursor:'opaque-next'},expect.any(AbortSignal));
		rerender(<WorkspaceCatalogSection onOpenProject={onOpen} searchQuery='new search'/>);
		await screen.findByText('Search match');
		expect(listPage).toHaveBeenLastCalledWith({page:1,pageSize:24,query:'new search'},expect.any(AbortSignal));
	});
	it('searches the complete server catalog, rather than filtering loaded cards', async () => {
		const listPage = jest.fn(async ({ query, page }: { query?: string; page: number }) => ({
			status: 'authenticated' as const, accountLabel: 'alice', page, hasMore: false,
			projects: query ? [{ ...ownedProject, id: '9000', name: 'Global tag', repositoryLabel: 'tags/9000' }] : [ownedProject],
		}));
		catalog = { isEnabled: () => true, subscribe: () => () => {}, listPage };
		const onOpen = jest.fn();
		const { rerender } = render(<WorkspaceCatalogSection onOpenProject={onOpen} />);
		await screen.findByText('Owned article');
		rerender(<WorkspaceCatalogSection onOpenProject={onOpen} searchQuery='remote title' />);
		expect(await screen.findByText('Global tag')).toBeInTheDocument();
		expect(listPage).toHaveBeenLastCalledWith({ page: 1, pageSize: 24, query: 'remote title' }, expect.any(AbortSignal));
		expect(screen.queryByText('Owned article')).not.toBeInTheDocument();
		rerender(<WorkspaceCatalogSection onOpenProject={onOpen} />);
		expect(await screen.findByText('Owned article')).toBeInTheDocument();
		expect(screen.queryByText('Global tag')).not.toBeInTheDocument();
	});
	afterEach(() => {
		catalog = undefined;
		jest.clearAllMocks();
	});

	it('stays absent for an anonymous visitor', async () => {
		catalog = fakeCatalog({ status: 'anonymous', projects: [] });
		const { container } = render(
			<WorkspaceCatalogSection onOpenProject={jest.fn()} />,
		);
		await waitFor(() => expect(catalog?.listPage).toHaveBeenCalled());
		await waitFor(() =>
			expect(screen.queryByText('Rinspace Projects')).not.toBeInTheDocument(),
		);
		expect(container).toBeEmptyDOMElement();
	});

	it('renders account metadata and delegates opening without local project actions', async () => {
		catalog = fakeCatalog({
			status: 'authenticated',
			accountLabel: 'alice',
			page: 1,
			hasMore: false,
			projects: [
				{
					id: '41',
					name: 'A shared article',
					description: 'Collaborative source',
					repositoryLabel: 'a/41',
					contentType: 'article',
					defaultRef: 'main',
					private: true,
					access: 'collaborator',
					openIntent: { mode: 'managed', owner: 'a', repository: '41', ref: 'main' },
				},
			],
		});
		const onOpen = jest.fn(async () => {});
		render(<WorkspaceCatalogSection onOpenProject={onOpen} />);

		expect(await screen.findByText('A shared article')).toBeInTheDocument();
		expect(screen.getByText('Rinspace Projects')).toBeInTheDocument();
		expect(screen.getByText('Collaborator · Private')).toBeInTheDocument();
		expect(screen.queryByText('Delete Project')).not.toBeInTheDocument();
		fireEvent.click(screen.getByRole('button', { name: 'Open' }));
		await waitFor(() => expect(onOpen).toHaveBeenCalledWith(
			expect.objectContaining({ repositoryLabel: 'a/41' }),
		));
	});

	it('refreshes the account catalog when the window regains focus', async () => {
		catalog = fakeCatalog({
			status: 'authenticated',
			accountLabel: 'alice',
			page: 1,
			hasMore: false,
			projects: [],
		});
		render(<WorkspaceCatalogSection onOpenProject={jest.fn()} />);
		await screen.findByText('No Rinspace projects found');
		const callsBeforeFocus = (catalog?.listPage as jest.Mock).mock.calls.length;

		fireEvent.focus(window);

		await waitFor(() =>
			expect(catalog?.listPage).toHaveBeenCalledTimes(callsBeforeFocus + 1),
		);
	});

	it('renders an authenticated empty account catalog without hiding local UI', async () => {
		catalog = fakeCatalog({
			status: 'authenticated',
			accountLabel: 'alice',
			page: 1,
			hasMore: false,
			projects: [],
		});
		render(<WorkspaceCatalogSection onOpenProject={jest.fn()} />);

		expect(await screen.findByText('No Rinspace projects found')).toBeInTheDocument();
		expect(screen.getByText('alice')).toBeInTheDocument();
	});

	it('loads the next account page only after the user asks for it', async () => {
		const listPage = jest.fn(async ({ page }: { page: number }) => ({
			status: 'authenticated' as const,
			accountLabel: 'alice',
			page,
			hasMore: page === 1,
			projects:
				page === 1
					? [ownedProject]
					: [{ ...ownedProject, id: '73', name: 'Second page book', repositoryLabel: 'b/73' }],
		}));
		catalog = {
			isEnabled: () => true,
			subscribe: () => () => {},
			listPage,
		};
		render(<WorkspaceCatalogSection onOpenProject={jest.fn()} />);

		expect(await screen.findByText('Owned article')).toBeInTheDocument();
		expect(screen.queryByText('Second page book')).not.toBeInTheDocument();
		fireEvent.click(screen.getByRole('button', { name: 'Load more' }));

		expect(await screen.findByText('Second page book')).toBeInTheDocument();
		expect(listPage).toHaveBeenLastCalledWith(
			{ page: 2, pageSize: 24 },
			expect.any(AbortSignal),
		);
	});

	it('reports a catalog failure locally and retries without replacing the page', async () => {
		let available = false;
		const listPage = jest.fn(async () => {
			if (!available) throw new Error('Gitea unavailable');
			return {
				status: 'authenticated',
				accountLabel: 'alice',
				page: 1,
				hasMore: false,
				projects: [ownedProject],
			} as const;
		});
		catalog = {
			isEnabled: () => true,
			subscribe: () => () => {},
			listPage,
		};
		render(<WorkspaceCatalogSection onOpenProject={jest.fn()} />);

		expect(await screen.findByText('Gitea unavailable')).toBeInTheDocument();
		available = true;
		fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
		expect(await screen.findByText('Owned article')).toBeInTheDocument();
		expect(listPage).toHaveBeenCalled();
	});

	it('removes account projects on logout and reloads the replacement account', async () => {
		let notify = () => {};
		let account: 'alice' | 'anonymous' | 'bob' = 'alice';
		const listPage = jest.fn(async () => {
			if (account === 'anonymous') return { status: 'anonymous' as const, projects: [] };
			if (account === 'bob') {
				return {
					status: 'authenticated' as const,
					accountLabel: 'bob',
					page: 1,
					hasMore: false,
					projects: [{ ...ownedProject, id: '73', name: 'Bob book', repositoryLabel: 'b/73' }],
				};
			}
			return {
				status: 'authenticated',
				accountLabel: 'alice',
				page: 1,
				hasMore: false,
				projects: [ownedProject],
			} as const;
		});
		catalog = {
			isEnabled: () => true,
			subscribe: (listener) => {
				notify = listener;
				return () => {};
			},
			listPage,
		};
		render(<WorkspaceCatalogSection onOpenProject={jest.fn()} />);
		expect(await screen.findByText('Owned article')).toBeInTheDocument();

		account = 'anonymous';
		act(() => notify());
		await waitFor(() =>
			expect(screen.queryByText('Rinspace Projects')).not.toBeInTheDocument(),
		);
		account = 'bob';
		act(() => notify());

		expect(await screen.findByText('Bob book')).toBeInTheDocument();
		expect(screen.getByText('bob')).toBeInTheDocument();
		expect(screen.queryByText('Owned article')).not.toBeInTheDocument();
	});
});
