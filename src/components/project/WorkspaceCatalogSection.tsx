import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { t } from '@/i18n';
import { formatLastModified } from '@/utils/dateUtils';
import { pluginRegistry } from '../../plugins/PluginRegistry';
import type { WorkspaceCatalogProject } from '../../workspace/contracts';
import { FolderIcon } from '../common/Icons';

const PAGE_SIZE = 24;

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

	const loadPage = useCallback(
		async (nextPage: number, append: boolean) => {
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
			try {
				const result = await catalog.listPage(
					{ page: nextPage, pageSize: PAGE_SIZE },
					controller.signal,
				);
				if (controller.signal.aborted) return;
				if (result.status === 'anonymous') {
					setStatus('anonymous');
					setProjects([]);
					setAccountLabel('');
					setPage(0);
					setHasMore(false);
					return;
				}
				setStatus('authenticated');
				setAccountLabel(result.accountLabel);
				setProjects((current) =>
					append
						? [
								...current,
								...result.projects.filter(
									(project) => !current.some((item) => item.id === project.id),
								),
							]
						: result.projects,
				);
				setPage(result.page);
				setHasMore(result.hasMore);
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
		[catalog],
	);

	useEffect(() => {
		if (!catalog) return;
		const reload = () => void loadPage(1, false);
		const reloadWhenVisible = () => {
			if (document.visibilityState === 'visible') reload();
		};
		const unsubscribe = catalog.subscribe(reload);
		window.addEventListener('focus', reload);
		document.addEventListener('visibilitychange', reloadWhenVisible);
		reload();
		return () => {
			unsubscribe();
			window.removeEventListener('focus', reload);
			document.removeEventListener('visibilitychange', reloadWhenVisible);
			requestRef.current?.abort();
		};
	}, [catalog, loadPage]);

	const filteredProjects = useMemo(() => {
		const query = searchQuery.trim().toLowerCase();
		if (!query) return projects;
		return projects.filter((project) =>
			[
				project.name,
				project.description,
				project.repositoryLabel,
				project.contentType,
			].some((value) => value.toLowerCase().includes(query)),
		);
	}, [projects, searchQuery]);

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
					onClick={() => void loadPage(1, false)}
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
							onClick={() => void loadPage(1, false)}
						>
							{t('Retry')}
						</button>
					</div>
				) : status === 'loading' && projects.length === 0 ? (
					<div className='ui-loading-state'>
						<div className='loading-spinner' />
						<p>{t('Loading Rinspace projects...')}</p>
					</div>
				) : filteredProjects.length === 0 ? (
					<div className='ui-empty-state'>
						<p>{t('No Rinspace projects found')}</p>
					</div>
				) : (
					<div className='projects-grid' data-role='workspace-project-grid'>
						{filteredProjects.map((project) => (
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

			{hasMore && status !== 'error' && (
				<div className='ui-pagination' data-justify='center'>
					<button
						type='button'
						className='button'
						disabled={status === 'loading'}
						onClick={() => void loadPage(page + 1, true)}
					>
						{status === 'loading' ? t('Loading...') : t('Load more')}
					</button>
				</div>
			)}
		</section>
	);
};

export default WorkspaceCatalogSection;
