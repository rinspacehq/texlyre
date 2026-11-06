// SPDX-License-Identifier: AGPL-3.0-or-later
import type React from 'react';
import { useEffect, useMemo, useState } from 'react';

import { t } from '@/i18n';
import { CloseIcon } from '@/components/common/Icons';
import type { WorkspaceCatalogProject } from '@/workspace/contracts';

import RinspaceCoverField from './RinspaceCoverField';
import { loadRinspaceSession } from './RinspaceSession';
import {
	searchBindableTags,
	updateProject,
	type BindableTag,
	type ProjectKind,
} from './RinspaceProjectCreation';

interface Props {
	project: WorkspaceCatalogProject;
	onClose(): void;
	onSaved(): void;
}

const RinspaceProjectEdit: React.FC<Props> = ({
	project,
	onClose,
	onSaved,
}) => {
	const management = project.management;
	const [actorId, setActorId] = useState('');
	const [title, setTitle] = useState(project.name);
	const [excerpt, setExcerpt] = useState(
		management?.excerpt || project.description,
	);
	const [coverRef, setCoverRef] = useState(management?.coverUrl || '');
	const [visibility, setVisibility] = useState<'private' | 'open'>(
		management?.sourceVisibility || (project.private ? 'private' : 'open'),
	);
	const [publicationStatus, setPublicationStatus] = useState<
		'draft' | 'published'
	>(management?.publicationStatus || 'draft');
	const [selectedTags, setSelectedTags] = useState<BindableTag[]>(
		() =>
			management?.tags.map((tag) => ({
				...tag,
				usageScope: '',
				parentTagIds: [],
			})) || [],
	);
	const [query, setQuery] = useState('');
	const [matches, setMatches] = useState<BindableTag[]>([]);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const kind = (
		project.contentType === 'book' ? 'book' : 'article'
	) satisfies ProjectKind;

	useEffect(() => {
		const controller = new AbortController();
		void loadRinspaceSession(globalThis.fetch, controller.signal)
			.then((session) => setActorId(session.user.id))
			.catch((cause: unknown) => {
				if (!controller.signal.aborted)
					setError(
						cause instanceof Error
							? cause.message
							: t('Rinspace is unavailable'),
					);
			});
		return () => controller.abort();
	}, []);
	useEffect(() => {
		if (!actorId || query.trim().length < 2) return;
		const controller = new AbortController();
		const timer = window.setTimeout(
			() =>
				void searchBindableTags(query.trim(), controller.signal, actorId)
					.then(setMatches)
					.catch((cause: unknown) => {
						if (!controller.signal.aborted)
							setError(
								cause instanceof Error
									? cause.message
									: t('Tag search unavailable'),
							);
					}),
			250,
		);
		return () => {
			window.clearTimeout(timer);
			controller.abort();
		};
	}, [actorId, query]);
	const availableMatches = useMemo(
		() =>
			matches.filter(
				(match) => !selectedTags.some((tag) => tag.id === match.id),
			),
		[matches, selectedTags],
	);
	if (!management)
		return (
			<p className='ui-message' data-tone='error'>
				{t('This project cannot be managed from the project home.')}
			</p>
		);

	const save = async () => {
		if (!title.trim() || !actorId || busy) return;
		setBusy(true);
		setError('');
		const controller = new AbortController();
		try {
			await updateProject(
				project.id,
				{
					title: title.trim(),
					excerpt: excerpt.trim(),
					coverRef,
					sourceVisibility: visibility,
					publicationStatus,
					tagIds: selectedTags.map((tag) => tag.id),
				},
				controller.signal,
				actorId,
			);
			onSaved();
		} catch (cause) {
			setError(
				cause instanceof Error
					? cause.message
					: t('Project update unavailable'),
			);
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className='ui-stack' data-gap='md'>
			{error && (
				<p className='ui-message' data-tone='error' role='alert'>
					{error}
				</p>
			)}
			<div
				className='ui-card ui-toolbar'
				data-padding='sm'
				data-justify='between'
			>
				<span>
					<strong>{kind === 'article' ? t('Article') : t('Book')}</strong> ·{' '}
					{management.sourceFormat === 'latex'
						? 'LaTeX'
						: management.sourceFormat === 'markdown'
							? 'Markdown'
							: 'Typst'}
				</span>
				<span className='ui-meta'>{project.repositoryLabel}</span>
			</div>
			<label className='ui-field'>
				<span className='ui-field-label'>{t('Project Name')}</span>
				<input
					className='ui-field-control'
					maxLength={180}
					value={title}
					onChange={(event) => setTitle(event.target.value)}
				/>
			</label>
			<label className='ui-field'>
				<span className='ui-field-label'>{t('Description')}</span>
				<textarea
					className='ui-field-control'
					maxLength={240}
					value={excerpt}
					onChange={(event) => setExcerpt(event.target.value)}
				/>
			</label>
			<div className='rinspace-project-edit-settings'>
				<label className='ui-field'>
					<span className='ui-field-label'>{t('Source visibility')}</span>
					<select
						className='ui-field-control'
						value={visibility}
						onChange={(event) =>
							setVisibility(event.target.value as 'private' | 'open')
						}
					>
						<option value='private'>{t('Private')}</option>
						<option value='open'>{t('Public')}</option>
					</select>
				</label>
				<label className='ui-field'>
					<span className='ui-field-label'>{t('Publication status')}</span>
					<select
						className='ui-field-control'
						value={publicationStatus}
						onChange={(event) =>
							setPublicationStatus(event.target.value as 'draft' | 'published')
						}
					>
						<option value='draft'>{t('Draft')}</option>
						<option value='published'>{t('Published')}</option>
					</select>
				</label>
			</div>
			<div className='ui-field'>
				<span className='ui-field-label'>{t('Cover image')}</span>
				<RinspaceCoverField
					actorId={actorId}
					disabled={busy || !actorId}
					kind={kind}
					value={coverRef}
					onChange={setCoverRef}
					onBusyChange={setBusy}
				/>
			</div>
			<div className='ui-stack' data-gap='sm'>
				<label className='ui-field'>
					<span className='ui-field-label'>{t('Tags')}</span>
					<input
						className='ui-field-control'
						type='search'
						value={query}
						placeholder={t('Search existing tags...')}
						onChange={(event) => {
							setQuery(event.target.value);
							setMatches([]);
						}}
					/>
				</label>
				{availableMatches.length > 0 && (
					<div className='ui-list' data-gap='xs' data-scroll='short'>
						{availableMatches.map((tag) => (
							<div
								key={tag.id}
								className='ui-list-item'
								data-align='center'
								data-justify='between'
								data-gap='sm'
								data-padding='sm'
							>
								<span className='ui-list-content' data-grow='true'>
									<strong>{tag.displayName}</strong>
									<span className='ui-meta'>{tag.usageScope}</span>
								</span>
								<button
									type='button'
									className='button secondary'
									disabled={selectedTags.length >= 6}
									onClick={() => {
										setSelectedTags((current) => [...current, tag]);
										setQuery('');
									}}
								>
									{t('Add')}
								</button>
							</div>
						))}
					</div>
				)}
				<div className='ui-tags'>
					{selectedTags.map((tag) => (
						<button
							type='button'
							key={tag.id}
							className='ui-badge'
							data-variant='tag'
							onClick={() =>
								setSelectedTags((current) =>
									current.filter((item) => item.id !== tag.id),
								)
							}
						>
							<span>{tag.displayName}</span>
							<CloseIcon />
						</button>
					))}
				</div>
			</div>
			<div className='ui-actions' data-variant='modal'>
				<button
					type='button'
					className='button secondary'
					disabled={busy}
					onClick={onClose}
				>
					{t('Cancel')}
				</button>
				<button
					type='button'
					className='button primary'
					disabled={busy || !actorId || !title.trim()}
					onClick={() => void save()}
				>
					{busy ? t('Saving...') : t('Save changes')}
				</button>
			</div>
		</div>
	);
};

export default RinspaceProjectEdit;
