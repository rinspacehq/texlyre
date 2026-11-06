// SPDX-License-Identifier: AGPL-3.0-or-later
import type React from 'react';
import { useEffect, useMemo, useState } from 'react';

import { t } from '@/i18n';
import type { WorkspaceCatalogProject } from '@/workspace/contracts';
import { formatDate, formatLastModified } from '@/utils/dateUtils';
import { FolderIcon, GridIcon, ListIcon } from '../common/Icons';

type SortKey = 'name' | 'createdAt' | 'updatedAt';

interface Props {
	projects: readonly WorkspaceCatalogProject[];
	onOpenProject(project: WorkspaceCatalogProject): Promise<void>;
	onEditProject?(project: WorkspaceCatalogProject): void;
	onDeleteProject?(project: WorkspaceCatalogProject): void;
	loading?: boolean;
}

const WorkspaceProjectList: React.FC<Props> = ({
	projects,
	onOpenProject,
	onEditProject,
	onDeleteProject,
	loading = false,
}) => {
	const [sortBy, setSortBy] = useState<SortKey>('updatedAt');
	const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
	const [viewMode, setViewMode] = useState<'grid' | 'list'>(() => {
		try {
			return localStorage.getItem('texlyre-workspace-project-view') === 'list'
				? 'list'
				: 'grid';
		} catch {
			return 'grid';
		}
	});
	const [openingId, setOpeningId] = useState('');

	useEffect(() => {
		try {
			localStorage.setItem('texlyre-workspace-project-view', viewMode);
		} catch {
			/* Optional preference. */
		}
	}, [viewMode]);

	const sortedProjects = useMemo(
		() =>
			[...projects].sort((a, b) => {
				let comparison: number;
				if (sortBy === 'name') comparison = a.name.localeCompare(b.name);
				else comparison = (a[sortBy] ?? 0) - (b[sortBy] ?? 0);
				return sortDirection === 'asc' ? comparison : -comparison;
			}),
		[projects, sortBy, sortDirection],
	);

	const changeSort = (next: SortKey) => {
		if (next === sortBy)
			setSortDirection((value) => (value === 'asc' ? 'desc' : 'asc'));
		else {
			setSortBy(next);
			setSortDirection(next === 'name' ? 'asc' : 'desc');
		}
	};

	return (
		<div className='ui-panel' data-height='full' data-role='project-list'>
			<div className='ui-panel-header' data-role='project-list'>
				<div className='ui-toolbar' data-gap='sm'>
					<span>{t('Sort by:')}</span>
					{(['name', 'createdAt', 'updatedAt'] as const).map((key) => (
						<button
							key={key}
							type='button'
							className={`button ${sortBy === key ? 'active' : ''}`}
							onClick={() => changeSort(key)}
						>
							{key === 'name'
								? t('Name')
								: key === 'createdAt'
									? t('Created')
									: t('Updated')}
							{sortBy === key ? (sortDirection === 'asc' ? ' ↑' : ' ↓') : ''}
						</button>
					))}
					<button
						type='button'
						className='button'
						onClick={() =>
							setViewMode((value) => (value === 'grid' ? 'list' : 'grid'))
						}
						title={viewMode === 'grid' ? t('List View') : t('Grid View')}
					>
						{viewMode === 'grid' ? <ListIcon /> : <GridIcon />}
					</button>
					{loading && (
						<span className='ui-meta' role='status'>
							{t('Refreshing...')}
						</span>
					)}
				</div>
			</div>
			<div className='ui-panel-content' data-overflow='y' data-padding='sm'>
				{sortedProjects.length === 0 ? (
					<div className='ui-empty-state'>
						{loading ? (
							<>
								<div className='loading-spinner' />
								<p>{t('Loading Rinspace projects...')}</p>
							</>
						) : (
							<p>{t('No projects found matching the current criteria')}</p>
						)}
					</div>
				) : (
					<div
						className={
							viewMode === 'list' ? 'projects-list ui-list' : 'projects-grid'
						}
						data-gap={viewMode === 'list' ? 'xs' : undefined}
					>
						{sortedProjects.map((project) => (
							<article
								className='ui-card'
								data-role='project'
								data-padding='md'
								data-hover='lift'
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
									data-role='project-meta'
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
								{project.createdAt !== undefined && (
									<p className='ui-meta'>
										{t('Created: {createdAt}', {
											createdAt: formatDate(project.createdAt),
										})}
									</p>
								)}
								{project.updatedAt !== undefined && (
									<p className='ui-meta'>
										{t('Last Modified: {lastModified}', {
											lastModified: formatLastModified(project.updatedAt),
										})}
									</p>
								)}
								{project.readiness === 'preparing' && (
									<p className='ui-meta' role='status'>
										{t('Preparing project files...')}
									</p>
								)}
								{project.readiness === 'attention' && (
									<p className='ui-meta' role='status'>
										{t('Project creation needs attention')}
									</p>
								)}
								<div className='ui-toolbar-actions' data-role='project-actions'>
									<button
										type='button'
										className='button primary'
										disabled={
											Boolean(openingId) ||
											project.readiness === 'preparing' ||
											project.readiness === 'attention'
										}
										onClick={async () => {
											setOpeningId(project.id);
											try {
												await onOpenProject(project);
											} finally {
												setOpeningId('');
											}
										}}
									>
										<FolderIcon />
										{openingId === project.id ? t('Opening...') : t('Open')}
									</button>
									{project.management && onEditProject && <button type='button' className='button secondary' disabled={Boolean(openingId)} onClick={() => onEditProject(project)}>{t('Edit')}</button>}
									{project.management && onDeleteProject && <button type='button' className='button secondary danger' disabled={Boolean(openingId)} onClick={() => onDeleteProject(project)}>{t('Delete')}</button>}
								</div>
								{project.tags && project.tags.length > 0 && (
									<div className='ui-tags' data-role='project-tags'>
										{project.tags.map((tag) => (
											<span key={tag} className='ui-badge' data-variant='tag'>
												{tag}
											</span>
										))}
									</div>
								)}
							</article>
						))}
					</div>
				)}
			</div>
		</div>
	);
};

export default WorkspaceProjectList;
