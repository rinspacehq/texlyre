// SPDX-License-Identifier: AGPL-3.0-or-later
import type React from 'react';
import { useMemo } from 'react';

import { t } from '@/i18n';
import { formatLastModified } from '@/utils/dateUtils';
import { NewProjectIcon, RefreshIcon } from '@/components/common/Icons';
import type { WorkspaceCatalogProject } from '@/workspace/contracts';
import {
	setRinspaceProjectTag,
	setRinspaceProjectType,
	useRinspaceProjectHomeSnapshot,
} from './RinspaceProjectHomeState';

interface Props {
	searchQuery: string;
	onSearch(query: string): void;
	onCreate(): void;
	onRefresh(): void;
	onOpenProject(project: WorkspaceCatalogProject): Promise<void>;
}

const RinspaceProjectHomeSidebar: React.FC<Props> = ({
	searchQuery,
	onSearch,
	onCreate,
	onRefresh,
	onOpenProject,
}) => {
	const state = useRinspaceProjectHomeSnapshot();
	const tags = useMemo(
		() =>
			[
				...new Set(state.projects.flatMap((project) => project.tags ?? [])),
			].sort(),
		[state.projects],
	);
	const types = useMemo(
		() =>
			[...new Set(state.projects.map((project) => project.contentType))].sort(),
		[state.projects],
	);
	const recent = useMemo(
		() =>
			[...state.projects]
				.filter((project) => project.updatedAt !== undefined)
				.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
				.slice(0, 5),
		[state.projects],
	);

	return (
		<div className='file-explorer' data-role='project-panel'>
			<div className='ui-panel-header' data-role='explorer' data-position='top'>
				<h3 className='ui-panel-title' data-size='body' data-shrink='true'>
					{t('Projects')}
				</h3>
				<div
					className='ui-toolbar-actions scroll-x'
					data-gap='sm'
					data-active-style='filled'
				>
					<button
						type='button'
						className='ui-icon-button'
						data-variant='subtle'
						title={t('New Project')}
						onClick={onCreate}
					>
						<NewProjectIcon />
					</button>
					<button
						type='button'
						className='ui-icon-button'
						data-variant='subtle'
						title={t('Refresh projects')}
						onClick={onRefresh}
					>
						<RefreshIcon />
					</button>
				</div>
			</div>
			<div
				className='ui-stack'
				data-role='project-search'
				data-gap='sm'
				data-padding='sm'
			>
				<div className='ui-search-field'>
					<input
						type='search'
						aria-label={t('Search Rinspace projects')}
						placeholder={t('Search projects...')}
						value={searchQuery}
						onChange={(event) => onSearch(event.target.value)}
						className='search-input ui-field-control ui-search-control'
					/>
					{searchQuery && (
						<button
							type='button'
							aria-label={t('Clear search')}
							className='ui-search-clear'
							onClick={() => onSearch('')}
							title={t('Clear search')}
						>
							<span aria-hidden='true'>×</span>
						</button>
					)}
				</div>
				<select
					value={state.selectedTag}
					onChange={(event) => setRinspaceProjectTag(event.target.value)}
					className='tag-filter ui-field-control'
				>
					<option value=''>{t('All tags')}</option>
					{tags.map((tag) => (
						<option key={tag} value={tag}>
							{tag}
						</option>
					))}
				</select>
				<select
					value={state.selectedType}
					onChange={(event) => setRinspaceProjectType(event.target.value)}
					className='type-filter ui-field-control'
				>
					<option value=''>{t('All types')}</option>
					{types.map((type) => (
						<option key={type} value={type}>
							{type}
						</option>
					))}
				</select>
				<section className='ui-stack' data-gap='xs'>
					<h4 className='ui-meta'>{t('Recent')}</h4>
					<div className='ui-list' data-gap='xs' data-scroll='medium'>
						{recent.map((project) => (
							<button
								type='button'
								key={project.id}
								className='ui-list-item'
								data-border='none'
								data-surface='secondary'
								data-align='center'
								data-justify='between'
								data-padding='xs'
								title={project.description}
								onClick={() => void onOpenProject(project)}
							>
								<span className='ui-list-content' data-grow='true'>
									{project.name}
								</span>
								<span className='ui-meta'>
									{formatLastModified(project.updatedAt ?? 0)}
								</span>
							</button>
						))}
					</div>
				</section>
			</div>
		</div>
	);
};

export default RinspaceProjectHomeSidebar;
