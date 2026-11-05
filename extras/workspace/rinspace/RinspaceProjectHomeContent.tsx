// SPDX-License-Identifier: AGPL-3.0-or-later
import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { t } from '@/i18n';
import Modal from '@/components/common/Modal';
import WorkspaceProjectList from '@/components/project/WorkspaceProjectList';
import { pluginRegistry } from '@/plugins/PluginRegistry';
import type { WorkspaceCatalogProject } from '@/workspace/contracts';
import RinspaceProjectCreate from './RinspaceProjectCreate';
import type { ProjectCreationOperation } from './RinspaceProjectCreation';
import {
	publishRinspaceProjects,
	useRinspaceProjectHomeSnapshot,
} from './RinspaceProjectHomeState';

const PAGE_SIZE = 50;
const MAX_CATALOG_PAGES = 10;

interface Props {
	searchQuery?: string;
	createRequested?: boolean;
	refreshEpoch?: number;
	onCloseCreate?: () => void;
	onOpenProject(project: WorkspaceCatalogProject): Promise<void>;
}

const RinspaceProjectHomeContent: React.FC<Props> = ({
	searchQuery = '',
	createRequested = false,
	refreshEpoch = 0,
	onCloseCreate,
	onOpenProject,
}) => {
	const catalog = pluginRegistry.getWorkspaceExtensions().catalog;
	const filters = useRinspaceProjectHomeSnapshot();
	const requestRef = useRef<AbortController | null>(null);
	const refreshEpochRef = useRef(refreshEpoch);
	const [projects, setProjects] = useState<readonly WorkspaceCatalogProject[]>(
		filters.projects,
	);
	const [status, setStatus] = useState<
		'disabled' | 'loading' | 'anonymous' | 'authenticated' | 'error'
	>(catalog?.isEnabled() ? 'loading' : 'disabled');
	const [error, setError] = useState('');
	const query = searchQuery.trim();

	const loadCatalog = useCallback(async () => {
		requestRef.current?.abort();
		if (!catalog?.isEnabled()) {
			setStatus('disabled');
			return;
		}
		const controller = new AbortController();
		requestRef.current = controller;
		setStatus('loading');
		setError('');
		try {
			let nextPage = 1;
			let cursor: string | undefined;
			let accumulated: readonly WorkspaceCatalogProject[] = [];
			while (nextPage <= MAX_CATALOG_PAGES) {
				const result = await catalog.listPage(
					{
						page: nextPage,
						pageSize: PAGE_SIZE,
						...(query ? { query } : {}),
						...(cursor ? { cursor } : {}),
					},
					controller.signal,
				);
				if (controller.signal.aborted) return;
				if (result.status === 'anonymous') {
					setStatus('anonymous');
					setProjects([]);
					publishRinspaceProjects([]);
					return;
				}
				accumulated = [...accumulated, ...result.projects];
				setStatus('authenticated');
				setProjects(accumulated);
				publishRinspaceProjects(accumulated);
				if (!result.hasMore) return;
				if (!result.nextCursor)
					throw new Error(t('Failed to load Rinspace projects'));
				cursor = result.nextCursor;
				nextPage += 1;
			}
			throw new Error(t('Refine the search to show fewer projects'));
		} catch (cause) {
			if (!controller.signal.aborted) {
				setStatus('error');
				setError(
					cause instanceof Error
						? cause.message
						: t('Failed to load Rinspace projects'),
				);
			}
		} finally {
			if (requestRef.current === controller) requestRef.current = null;
		}
	}, [catalog, query]);

	useEffect(() => {
		if (!catalog) return;
		if (refreshEpochRef.current !== refreshEpoch) {
			refreshEpochRef.current = refreshEpoch;
			catalog.invalidate?.();
		}
		const reload = () => void loadCatalog();
		const unsubscribe = catalog.subscribe(reload);
		requestRef.current?.abort();
		const timer = window.setTimeout(reload, query ? 250 : 0);
		return () => {
			unsubscribe();
			window.clearTimeout(timer);
			requestRef.current?.abort();
		};
	}, [catalog, loadCatalog, query, refreshEpoch]);

	const visibleProjects = useMemo(
		() =>
			projects.filter(
				(project) =>
					(!filters.selectedType ||
						project.contentType === filters.selectedType) &&
					(!filters.selectedTag || project.tags?.includes(filters.selectedTag)),
			),
		[projects, filters.selectedTag, filters.selectedType],
	);

	if (!catalog || status === 'disabled') return null;
	if (status === 'anonymous')
		return (
			<section className='ui-empty-state' data-role='workspace-project-catalog'>
				<p>{t('Rinspace sign-in is required')}</p>
			</section>
		);

	const openCreatedProject = async (operation: ProjectCreationOperation) => {
		if (!operation.openIntent) throw new Error(t('Project is not ready'));
		const intent = operation.openIntent;
		await onOpenProject({
			id: operation.contentId,
			name: operation.title,
			description: '',
			repositoryLabel: `${intent.owner}/${intent.repository}`,
			contentType: operation.kind,
			defaultRef: intent.ref || 'main',
			private: operation.sourceVisibility !== 'open',
			access: 'owner',
			openIntent: intent,
		});
	};

	return (
		<>
			{status === 'error' && (
				<div className='ui-message' data-tone='error' role='alert'>
					<p>{error}</p>
					<button
						type='button'
						className='button'
						onClick={() => void loadCatalog()}
					>
						{t('Retry')}
					</button>
				</div>
			)}
			<WorkspaceProjectList
				projects={visibleProjects}
				loading={status === 'loading'}
				onOpenProject={async (project) => {
					try {
						await onOpenProject(project);
					} catch (cause) {
						setStatus('error');
						setError(
							cause instanceof Error
								? cause.message
								: t('Failed to open Rinspace project'),
						);
					}
				}}
			/>
			<Modal
				isOpen={createRequested}
				onClose={() => onCloseCreate?.()}
				title={t('Create New Project')}
				size='large'
				closeOnClickOutside={false}
			>
				<RinspaceProjectCreate
					onClose={() => onCloseCreate?.()}
					onOpen={openCreatedProject}
				/>
			</Modal>
		</>
	);
};

export default RinspaceProjectHomeContent;
