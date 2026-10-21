import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { t } from '@/i18n';
import { formatLastModified } from '@/utils/dateUtils';
import { pluginRegistry } from '../../plugins/PluginRegistry';
import type { WorkspaceCatalogProject } from '../../workspace/contracts';
import { FolderIcon } from '../common/Icons';

const PAGE_SIZE = 12;

interface WorkspaceCatalogSectionProps {
	searchQuery?: string;
	onOpenProject: (project: WorkspaceCatalogProject) => Promise<void>;
}

const WorkspaceCatalogSection: React.FC<WorkspaceCatalogSectionProps> = ({
	searchQuery = '',
	onOpenProject,
}) => {
	const catalog = pluginRegistry.getWorkspaceExtensions().catalog;
	const requestRef = useRef<AbortController | null>(null);
	const pageCursorsRef = useRef(new Map<number, string | undefined>([[1, undefined]]));
	const [projects, setProjects] = useState<readonly WorkspaceCatalogProject[]>(
		[],
	);
	const [accountLabel, setAccountLabel] = useState('');
	const [page, setPage] = useState(0);
	const [hasMore, setHasMore] = useState(false);
	const [status, setStatus] = useState<
		'disabled' | 'loading' | 'anonymous' | 'authenticated' | 'error'
	>(catalog?.isEnabled() ? 'loading' : 'disabled');
	const [error, setError] = useState('');
	const [openingId, setOpeningId] = useState('');
	const query = searchQuery.trim();

	const loadPage = useCallback(
		async (nextPage: number, reset = false) => {
			requestRef.current?.abort();
			if (!catalog?.isEnabled()) {
				setStatus('disabled');
				setProjects([]);
				setAccountLabel('');
				return;
			}
			const controller = new AbortController();
			requestRef.current = controller;
			setStatus('loading');
			setError('');
			if (reset) {
				pageCursorsRef.current = new Map([[1, undefined]]);
				setProjects([]);
				setHasMore(false);
				setPage(0);
			}
			try {
				if (nextPage > 1 && !pageCursorsRef.current.has(nextPage)) {
					throw new Error(t('Failed to load Rinspace projects'));
				}
				const cursor = pageCursorsRef.current.get(nextPage);
				const result = await catalog.listPage(
					{ page: nextPage, pageSize: PAGE_SIZE, ...(query ? { query } : {}),
						...(cursor ? { cursor } : {}) },
					controller.signal,
				);
				if (controller.signal.aborted) return;
				if (result.status === 'anonymous') {
					setStatus('anonymous');
					setProjects([]);
					setAccountLabel('');
					setPage(0);
					pageCursorsRef.current = new Map([[1, undefined]]);
					setHasMore(false);
					return;
				}
				setStatus('authenticated');
				setAccountLabel(result.accountLabel);
				setProjects(result.projects);
				setPage(result.page);
				setHasMore(result.hasMore);
				// Retain only cursor metadata, not every visited page's cards.
				// Going back may observe changed rows, so replace later cursors.
				for (const knownPage of pageCursorsRef.current.keys()) {
					if (knownPage > nextPage) pageCursorsRef.current.delete(knownPage);
				}
				if (result.nextCursor) pageCursorsRef.current.set(nextPage + 1, result.nextCursor);
			} catch (loadError) {
				if (controller.signal.aborted) return;
				setStatus('error');
				setError(
					loadError instanceof Error
						? loadError.message
						: t('Failed to load Rinspace projects'),
				);
			} finally {
				if (requestRef.current === controller) requestRef.current = null;
			}
		},
		[catalog, query],
	);

	useEffect(() => {
		if (!catalog) return;
		const reload = () => void loadPage(1, true);
		const unsubscribe = catalog.subscribe(reload);
		// Cancel the previous query immediately, but debounce the next request.
		requestRef.current?.abort();
		pageCursorsRef.current = new Map([[1, undefined]]);
		setProjects([]);
		setHasMore(false);
		const timer = window.setTimeout(reload, query ? 250 : 0);
		return () => {
			unsubscribe();
			window.clearTimeout(timer);
			requestRef.current?.abort();
		};
	}, [catalog, loadPage, query]);

	if (!catalog || status === 'disabled' || status === 'anonymous') return null;

	return (
		<section className='ui-panel' data-role='workspace-project-catalog'>
			<div className='ui-panel-header'>
				<div>
					<h2 className='ui-panel-title'>{t('Rinspace Projects')}</h2>
					{accountLabel && <span className='ui-meta'>{accountLabel}</span>}
				</div>
				<button
					type='button'
					className='button secondary'
					onClick={() => void loadPage(1, true)}
					disabled={status === 'loading'}
				>
					{t('Refresh')}
				</button>
			</div>

			<div className='ui-panel-content' data-padding='sm'>
				{status === 'error' ? (
					<div className='ui-message' data-tone='error'>
						<p>{error}</p>
						<button
							type='button'
							className='button'
							onClick={() => void loadPage(page || 1)}
						>
							{t('Retry')}
						</button>
					</div>
				) : status === 'loading' && projects.length === 0 ? (
					<div className='ui-loading-state'>
						<div className='loading-spinner' />
						<p>{t('Loading Rinspace projects...')}</p>
					</div>
				) : projects.length === 0 ? (
					<div className='ui-empty-state'>
						<p>{t('No Rinspace projects found')}</p>
					</div>
				) : (
					<div className='projects-grid' data-role='workspace-project-grid'>
						{projects.map((project) => (
							<article
								className='ui-card'
								data-role='workspace-project'
								data-padding='md'
								key={project.id}
							>
								<div className='ui-toolbar' data-justify='between'>
									<h3 className='ui-panel-title' data-size='body'>
										{project.name}
									</h3>
									<span className='ui-badge' data-variant='label'>
										{project.contentType}
									</span>
								</div>
								<p className='project-card-description'>
									{project.description || project.repositoryLabel}
								</p>
								<div
									className='ui-meta'
									data-layout='row'
									data-justify='between'
								>
									<span>{project.repositoryLabel}</span>
									<span>
										{project.access === 'owner'
											? t('Owner')
											: t('Collaborator')}
										{project.private ? ` · ${t('Private')}` : ''}
									</span>
								</div>
								{project.updatedAt !== undefined && (
									<p className='ui-meta'>
										{t('Updated {updatedAt}', {
											updatedAt: formatLastModified(project.updatedAt),
										})}
									</p>
								)}
								<div className='ui-toolbar-actions' data-role='project-actions'>
									<button
										type='button'
										className='button primary'
										disabled={Boolean(openingId)}
										onClick={async () => {
											setOpeningId(project.id);
											try {
												await onOpenProject(project);
											} catch (openError) {
												setStatus('error');
												setError(
													openError instanceof Error
														? openError.message
														: t('Failed to open Rinspace project'),
												);
											} finally {
												setOpeningId('');
											}
										}}
									>
										<FolderIcon />
										{openingId === project.id ? t('Opening...') : t('Open')}
									</button>
								</div>
							</article>
						))}
					</div>
				)}
			</div>

			{(hasMore || page > 1) && status !== 'error' && (
				<div className='ui-pagination' data-justify='center'>
					<button
						type='button'
						className='button'
						disabled={status === 'loading' || page <= 1}
						onClick={() => void loadPage(page - 1)}
					>
						{t('← Prev')}
					</button>
					<span className='ui-meta' aria-live='polite'>
						{t('Page {currentPage}', { currentPage: page })}
					</span>
					<button
						type='button'
						className='button'
						disabled={status === 'loading' || !hasMore}
						onClick={() => void loadPage(page + 1)}
					>
						{t('Next →')}
					</button>
				</div>
			)}
		</section>
	);
};

export default WorkspaceCatalogSection;
