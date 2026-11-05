// SPDX-License-Identifier: AGPL-3.0-or-later
import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { t } from '@/i18n';

import { loadRinspaceSession } from './RinspaceSession';
import RinspaceCoverCrop from './RinspaceCoverCrop';
import { MAX_COVER_INPUT_BYTES } from './RinspaceCoverCropGeometry';
import {
	createProject,
	createTag,
	projectCreationCapability,
	projectOperation,
	recoverProject,
	retryTagOperation,
	searchBindableTags,
	tagCandidates,
	tagOperation,
	uploadProjectCover,
	RinspaceRequestError,
	type BindableTag,
	type ProjectCreationCapability,
	type ProjectCreationIntent,
	type ProjectCreationOperation,
	type ProjectKind,
	type SourceFormat,
	type TagCandidate,
	type TagCreationOperation,
} from './RinspaceProjectCreation';

interface Props {
	onClose: () => void;
	onOpen: (operation: ProjectCreationOperation) => Promise<void>;
}

interface SavedDraft {
	step: 1 | 2 | 3;
	intent: ProjectCreationIntent;
	selectedTags: BindableTag[];
	parentTags: BindableTag[];
	operationId?: string;
	submitted?: boolean;
	tagOperationId?: string;
	tagName?: string;
	tagScope?: string;
	tagCreationKey?: string;
}

interface PendingCover {
	imageURL: string;
}

function initialIntent(): ProjectCreationIntent {
	return {
		kind: 'article',
		sourceFormat: 'latex',
		title: '',
		excerpt: '',
		visibility: 'private',
		coverRef: '',
		tagIds: [],
		idempotencyKey: crypto.randomUUID(),
	};
}

function storageKey(actorId: string): string {
	return `rinspace-project-create-v1:${actorId}`;
}

function readDraft(actorId: string): SavedDraft | null {
	try {
		const value = JSON.parse(
			localStorage.getItem(storageKey(actorId)) || 'null',
		) as SavedDraft | null;
		if (
			!value ||
			![1, 2, 3].includes(value.step) ||
			!value.intent ||
			!['article', 'book'].includes(value.intent.kind) ||
			!['latex', 'markdown', 'typst'].includes(value.intent.sourceFormat) ||
			!/^[A-Za-z0-9_-]{16,128}$/.test(value.intent.idempotencyKey) ||
			!Array.isArray(value.selectedTags) ||
			!Array.isArray(value.parentTags)
		)
			return null;
		return value.step === 1 ? { ...value, step: 2 } : value;
	} catch {
		return null;
	}
}

function saveDraft(actorId: string, draft: SavedDraft): void {
	try {
		localStorage.setItem(storageKey(actorId), JSON.stringify(draft));
	} catch {
		/* Optional recovery. */
	}
}

function projectStateMessage(state: ProjectCreationOperation['state']): string {
	switch (state) {
		case 'validating':
			return t('Checking project details...');
		case 'provisioning':
			return t('Creating the project repository...');
		case 'awaiting_source_activation':
			return t('Checking the initial project files...');
		case 'ready':
			return t('Project is ready');
		case 'retryable_failure':
			return t('Project creation failed. You can retry the same request.');
		case 'reconciliation_required':
			return t(
				'Project creation needs attention. Retry the same request if available.',
			);
	}
}

const RinspaceProjectCreate: React.FC<Props> = ({ onClose, onOpen }) => {
	const [actorId, setActorId] = useState('');
	const [capability, setCapability] =
		useState<ProjectCreationCapability | null>(null);
	const [step, setStep] = useState<1 | 2 | 3>(2);
	const [intent, setIntent] = useState<ProjectCreationIntent>(initialIntent);
	const [selectedTags, setSelectedTags] = useState<BindableTag[]>([]);
	const [parentTags, setParentTags] = useState<BindableTag[]>([]);
	const [tagQuery, setTagQuery] = useState('');
	const [tagMatches, setTagMatches] = useState<BindableTag[]>([]);
	const [newTagName, setNewTagName] = useState('');
	const [showNewTag, setShowNewTag] = useState(false);
	const [pendingCover, setPendingCover] = useState<PendingCover | null>(null);
	const [newTagScope, setNewTagScope] = useState('');
	const [candidates, setCandidates] = useState<TagCandidate[]>([]);
	const [candidatesReviewed, setCandidatesReviewed] = useState(false);
	const [tagOperationId, setTagOperationId] = useState('');
	const [tagStatus, setTagStatus] = useState<TagCreationOperation | null>(null);
	const [tagPollEpoch, setTagPollEpoch] = useState(0);
	const [tagCreationKey, setTagCreationKey] = useState('');
	const [operation, setOperation] = useState<ProjectCreationOperation | null>(
		null,
	);
	const [operationId, setOperationId] = useState('');
	const [submitted, setSubmitted] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const [creationKeyConflict, setCreationKeyConflict] = useState(false);
	const controllers = useRef(new Set<AbortController>());
	const pendingCoverURL = useRef<string | null>(null);
	useEffect(
		() => () => {
			if (pendingCoverURL.current) URL.revokeObjectURL(pendingCoverURL.current);
		},
		[],
	);
	const clearPendingCover = () => {
		if (pendingCoverURL.current) URL.revokeObjectURL(pendingCoverURL.current);
		pendingCoverURL.current = null;
		setPendingCover(null);
	};
	const choosePendingCover = (file: File) => {
		clearPendingCover();
		const imageURL = URL.createObjectURL(file);
		pendingCoverURL.current = imageURL;
		setPendingCover({ imageURL });
	};
	const controller = useCallback(() => {
		const next = new AbortController();
		controllers.current.add(next);
		return next;
	}, []);

	useEffect(() => {
		const pendingControllers = controllers.current;
		const active = controller();
		void Promise.all([
			loadRinspaceSession(globalThis.fetch, active.signal),
			projectCreationCapability(active.signal),
		])
			.then(([session, available]) => {
				if (active.signal.aborted) return;
				setActorId(session.user.id);
				setCapability(available);
				const saved = readDraft(session.user.id);
				if (saved) {
					setStep(saved.step);
					setIntent(saved.intent);
					setSelectedTags(saved.selectedTags);
					setParentTags(saved.parentTags);
					setOperationId(saved.operationId || '');
					setSubmitted(Boolean(saved.submitted));
					setTagOperationId(saved.tagOperationId || '');
					setTagCreationKey(saved.tagCreationKey || '');
					setNewTagName(saved.tagName || '');
					setShowNewTag(Boolean(saved.tagName));
					setNewTagScope(saved.tagScope || '');
				}
			})
			.catch((cause: unknown) => {
				if (!active.signal.aborted)
					setError(
						cause instanceof Error
							? cause.message
							: t('Rinspace is unavailable'),
					);
			})
			.finally(() => pendingControllers.delete(active));
		return () => {
			for (const pending of pendingControllers) pending.abort();
			pendingControllers.clear();
		};
	}, [controller]);

	useEffect(() => {
		if (!actorId) return;
		saveDraft(actorId, {
			step,
			intent: { ...intent, tagIds: selectedTags.map((tag) => tag.id) },
			selectedTags,
			parentTags,
			operationId: operationId || undefined,
			submitted,
			tagOperationId: tagOperationId || undefined,
			tagName: newTagName,
			tagScope: newTagScope,
			tagCreationKey: tagCreationKey || undefined,
		});
	}, [
		actorId,
		step,
		intent,
		selectedTags,
		parentTags,
		operationId,
		tagOperationId,
		newTagName,
		newTagScope,
		tagCreationKey,
		submitted,
	]);

	useEffect(() => {
		if (tagQuery.trim().length < 2 || !capability?.enabled) return;
		const pendingControllers = controllers.current;
		const active = controller();
		const timer = window.setTimeout(() => {
			void searchBindableTags(tagQuery.trim(), active.signal, actorId)
				.then((items) => {
					if (!active.signal.aborted) setTagMatches(items);
				})
				.catch((cause: unknown) => {
					if (!active.signal.aborted)
						setError(
							cause instanceof Error ? cause.message : t('Tag search failed'),
						);
				})
				.finally(() => pendingControllers.delete(active));
		}, 250);
		return () => {
			window.clearTimeout(timer);
			active.abort();
			pendingControllers.delete(active);
		};
	}, [tagQuery, capability?.enabled, actorId, controller]);

	/* biome-ignore lint/correctness/useExhaustiveDependencies(tagPollEpoch): A retry epoch intentionally restarts polling after a retry response. */
	useEffect(() => {
		if (!tagOperationId || !actorId) return;
		const pendingControllers = controllers.current;
		const active = controller();
		let timer = 0;
		const poll = async (attempt: number) => {
			try {
				const state = await tagOperation(
					tagOperationId,
					active.signal,
					actorId,
				);
				if (active.signal.aborted) return;
				setTagStatus(state);
				if (state.state === 'active' && state.tagId) {
					const tag: BindableTag = {
						id: String(state.tagId),
						displayName: newTagName,
						usageScope: newTagScope,
						parentTagIds: parentTags.map((parent) => parent.id),
					};
					setSelectedTags((current) =>
						current.some((entry) => entry.id === tag.id)
							? current
							: [...current, tag].slice(0, 6),
					);
					setTagOperationId('');
					setTagStatus(null);
					setTagCreationKey('');
					setNewTagName('');
					setShowNewTag(false);
					setNewTagScope('');
					setParentTags([]);
					setCandidates([]);
					setCandidatesReviewed(false);
					return;
				}
				if (
					state.state === 'failed' ||
					state.state === 'reconciliation_required'
				) {
					setError(t('Tag creation needs attention'));
					return;
				}
			} catch (cause) {
				if (active.signal.aborted) return;
				setError(
					cause instanceof Error
						? cause.message
						: t('Tag operation unavailable'),
				);
			}
			if (!active.signal.aborted)
				timer = window.setTimeout(
					() => void poll(attempt + 1),
					document.hidden
						? 15000
						: Math.min(8000, 1000 * 2 ** Math.min(attempt, 3)),
				);
		};
		void poll(0);
		return () => {
			window.clearTimeout(timer);
			active.abort();
			pendingControllers.delete(active);
		};
	}, [
		tagOperationId,
		tagPollEpoch,
		actorId,
		newTagName,
		newTagScope,
		parentTags,
		controller,
	]);
	const retryTag = async () => {
		if (!tagOperationId || !actorId || busy) return;
		setBusy(true);
		setError('');
		const active = controller();
		try {
			const state = await retryTagOperation(
				tagOperationId,
				active.signal,
				actorId,
			);
			if (!active.signal.aborted) {
				setTagStatus(state);
				setTagPollEpoch((value) => value + 1);
			}
		} catch (cause) {
			if (!active.signal.aborted)
				setError(
					cause instanceof Error ? cause.message : t('Tag retry unavailable'),
				);
		} finally {
			controllers.current.delete(active);
			setBusy(false);
		}
	};

	useEffect(() => {
		if (step !== 3 || !submitted || !actorId || operation?.state === 'ready')
			return;
		const pendingControllers = controllers.current;
		const active = controller();
		let timer = 0;
		const poll = async (attempt: number) => {
			try {
				const next = operationId
					? await projectOperation(operationId, active.signal, actorId)
					: await recoverProject(intent.idempotencyKey, active.signal, actorId);
				if (active.signal.aborted) return;
				setOperation(next);
				if (!operationId) setOperationId(next.operationId);
				if (next.state === 'ready') return;
				if (
					next.state === 'reconciliation_required' ||
					next.state === 'retryable_failure'
				) {
					setError(t('Project creation needs attention'));
					return;
				}
			} catch (cause) {
				if (active.signal.aborted) return;
				// Creation can still be running before its first durable content row.
				if (attempt > 1)
					setError(
						cause instanceof Error
							? cause.message
							: t('Project status unavailable'),
					);
			}
			if (!active.signal.aborted)
				timer = window.setTimeout(
					() => void poll(attempt + 1),
					document.hidden
						? 15000
						: Math.min(8000, 1000 * 2 ** Math.min(attempt, 3)),
				);
		};
		void poll(0);
		return () => {
			window.clearTimeout(timer);
			active.abort();
			pendingControllers.delete(active);
		};
	}, [
		step,
		submitted,
		actorId,
		operationId,
		intent.idempotencyKey,
		operation?.state,
		controller,
	]);

	const updateIntent = (patch: Partial<ProjectCreationIntent>) =>
		setIntent((current) => ({ ...current, ...patch }));
	const invalidateTagCandidateReview = () => {
		setCandidates([]);
		setCandidatesReviewed(false);
		if (!tagOperationId) setTagCreationKey('');
	};
	const chooseTag = (tag: BindableTag) => {
		setSelectedTags((current) =>
			current.some((entry) => entry.id === tag.id) || current.length >= 6
				? current
				: [...current, tag],
		);
	};
	const submit = async () => {
		if (
			!actorId ||
			!capability?.enabled ||
			!capability.kinds.includes(intent.kind) ||
			!capability.sourceFormats.includes(intent.sourceFormat) ||
			!intent.title.trim() ||
			busy ||
			tagOperationId
		)
			return;
		setBusy(true);
		setError('');
		setCreationKeyConflict(false);
		setStep(3);
		setSubmitted(true);
		const active = controller();
		try {
			const next = await createProject(
				{
					...intent,
					title: intent.title.trim(),
					excerpt: intent.excerpt.trim(),
					tagIds: selectedTags.map((tag) => tag.id),
				},
				active.signal,
				actorId,
			);
			if (!active.signal.aborted) {
				setOperation(next);
				setOperationId(next.operationId);
			}
		} catch (cause) {
			if (!active.signal.aborted) {
				setError(
					cause instanceof Error
						? cause.message
						: t('Project creation unavailable'),
				);
				setCreationKeyConflict(
					cause instanceof RinspaceRequestError &&
						cause.code === 'idempotency_key_conflict',
				);
				if (
					cause instanceof RinspaceRequestError &&
					[400, 403, 409, 413, 429].includes(cause.status)
				)
					setSubmitted(false);
			}
		} finally {
			controllers.current.delete(active);
			setBusy(false);
		}
	};
	const beginTagCreation = async () => {
		if (
			!newTagName.trim() ||
			!newTagScope.trim() ||
			!capability?.tagCreationEnabled ||
			busy ||
			selectedTags.length >= 6
		)
			return;
		setBusy(true);
		setError('');
		const active = controller();
		try {
			if (!tagCreationKey && !candidatesReviewed) {
				const matches = await tagCandidates(
					newTagName.trim(),
					active.signal,
					actorId,
				);
				if (active.signal.aborted) return;
				setCandidates(matches);
				if (matches.length) {
					setCandidatesReviewed(true);
					return;
				}
			}
			const stableKey = tagCreationKey || `editor-tag-${crypto.randomUUID()}`;
			setTagCreationKey(stableKey);
			const created = await createTag(
				{
					displayName: newTagName.trim(),
					usageScope: newTagScope.trim(),
					parentTagIds: parentTags.map((parent) => Number(parent.id)),
					idempotencyKey: stableKey,
				},
				active.signal,
				actorId,
			);
			if (!active.signal.aborted) {
				setCandidates([]);
				setCandidatesReviewed(false);
				setTagOperationId(created.operationId);
			}
		} catch (cause) {
			if (!active.signal.aborted) {
				setError(
					cause instanceof Error
						? cause.message
						: t('Tag creation unavailable'),
				);
				if (cause instanceof RinspaceRequestError && cause.status === 409) {
					try {
						setCandidates(
							await tagCandidates(newTagName.trim(), active.signal, actorId),
						);
						setCandidatesReviewed(true);
					} catch {
						/* Keep the explicit conflict error. */
					}
				}
			}
		} finally {
			controllers.current.delete(active);
			setBusy(false);
		}
	};
	const chooseCandidate = async (candidate: TagCandidate) => {
		const active = controller();
		try {
			const bindable = (
				await searchBindableTags(candidate.displayName, active.signal, actorId)
			).find((tag) => tag.id === String(candidate.id));
			if (!bindable)
				throw new Error(
					t('This Tag is not yet bindable. Wait for activation.'),
				);
			chooseTag(bindable);
			setCandidates([]);
			setCandidatesReviewed(false);
			setNewTagName('');
			setShowNewTag(false);
			setNewTagScope('');
			setParentTags([]);
			setTagCreationKey('');
		} catch (cause) {
			if (!active.signal.aborted)
				setError(
					cause instanceof Error ? cause.message : t('Tag is unavailable'),
				);
		} finally {
			controllers.current.delete(active);
		}
	};
	const reset = () => {
		if (actorId) {
			try {
				localStorage.removeItem(storageKey(actorId));
			} catch {
				/* Optional. */
			}
		}
		setIntent(initialIntent());
		clearPendingCover();
		setSelectedTags([]);
		setParentTags([]);
		setTagQuery('');
		setTagMatches([]);
		setNewTagName('');
		setShowNewTag(false);
		setNewTagScope('');
		setCandidates([]);
		setCandidatesReviewed(false);
		setTagCreationKey('');
		setTagOperationId('');
		setTagStatus(null);
		setOperation(null);
		setOperationId('');
		setSubmitted(false);
		setCreationKeyConflict(false);
		setStep(2);
		setError('');
	};

	return (
		<div className='ui-stack rinspace-project-create' data-gap='md'>
			{error && (
				<div className='ui-message' data-tone='error' role='alert'>
					{error}
				</div>
			)}
			{!capability && !error && <p>{t('Loading project capability...')}</p>}
			{capability && !capability.enabled && (
				<p>{t('Project creation is unavailable for this account.')}</p>
			)}
			{capability?.enabled && step === 2 && (
				<div className='ui-stack' data-gap='md'>
					<label className='ui-field'>
						<span className='ui-field-label'>{t('Project Name')}</span>
						<input
							className='ui-field-control'
							value={intent.title}
							maxLength={180}
							required
							onChange={(event) => updateIntent({ title: event.target.value })}
						/>
					</label>
					<label className='ui-field'>
						<span className='ui-field-label'>{t('Description')}</span>
						<textarea
							className='ui-field-control'
							value={intent.excerpt}
							maxLength={240}
							onChange={(event) =>
								updateIntent({ excerpt: event.target.value })
							}
						/>
					</label>
					<label className='ui-field'>
						<span className='ui-field-label'>{t('Project Type')}</span>
						<select
							className='ui-field-control'
							value={intent.kind}
							onChange={(event) => {
								const kind = event.target.value as ProjectKind;
								if (intent.kind !== kind) {
									updateIntent({ kind, coverRef: '' });
									clearPendingCover();
								}
							}}
						>
							{capability.kinds.map((kind: ProjectKind) => (
								<option key={kind} value={kind}>
									{kind === 'article' ? t('Article') : t('Book')}
								</option>
							))}
						</select>
					</label>
					<label className='ui-field'>
						<span className='ui-field-label'>{t('Source format')}</span>
						<select
							className='ui-field-control'
							value={intent.sourceFormat}
							onChange={(event) =>
								updateIntent({
									sourceFormat: event.target.value as SourceFormat,
								})
							}
						>
							{capability.sourceFormats.map((sourceFormat: SourceFormat) => (
								<option key={sourceFormat} value={sourceFormat}>
									{sourceFormat === 'latex'
										? 'LaTeX'
										: sourceFormat === 'markdown'
											? 'Markdown'
											: 'Typst'}
								</option>
							))}
						</select>
					</label>
					<label className='ui-field'>
						<span className='ui-field-label'>{t('Source visibility')}</span>
						<select
							className='ui-field-control'
							value={intent.visibility}
							onChange={(event) =>
								updateIntent({
									visibility: event.target.value as 'private' | 'open',
								})
							}
						>
							<option value='private'>{t('Private source')}</option>
							<option value='open'>{t('Open source')}</option>
						</select>
					</label>
					<label className='ui-field'>
						<span className='ui-field-label'>
							{t('Cover image (optional)')}
						</span>
						<input
							className='ui-field-control'
							type='file'
							accept='image/png,image/jpeg,image/webp'
							disabled={busy}
							onChange={(event) => {
								const file = event.target.files?.[0];
								event.target.value = '';
								if (!file) return;
								if (
									!['image/png', 'image/jpeg', 'image/webp'].includes(
										file.type,
									) ||
									file.size === 0 ||
									file.size > MAX_COVER_INPUT_BYTES
								) {
									setError(t('Choose a PNG, JPEG or WebP image under 20 MiB.'));
									return;
								}
								setError('');
								choosePendingCover(file);
							}}
						/>
					</label>
					{pendingCover && (
						<RinspaceCoverCrop
							key={pendingCover.imageURL}
							imageURL={pendingCover.imageURL}
							kind={intent.kind}
							onCancel={clearPendingCover}
							onUpload={async (cropped) => {
								const active = controller();
								setBusy(true);
								try {
									const coverRef = await uploadProjectCover(
										cropped,
										active.signal,
										actorId,
									);
									if (!active.signal.aborted) {
										updateIntent({ coverRef });
										clearPendingCover();
									}
								} finally {
									controllers.current.delete(active);
									setBusy(false);
								}
							}}
						/>
					)}
					{intent.coverRef && (
						<p className='ui-meta'>
							{t('Cover uploaded')}{' '}
							<button
								type='button'
								disabled={busy}
								onClick={() => updateIntent({ coverRef: '' })}
							>
								{t('Remove cover')}
							</button>
						</p>
					)}
					<div className='ui-stack' data-gap='sm'>
						<label className='ui-field'>
							<span className='ui-field-label'>{t('Tags')}</span>
							<input
								className='ui-field-control'
								type='search'
								placeholder={t('Search or create a tag...')}
								value={tagQuery}
								onChange={(event) => {
									setTagQuery(event.target.value);
									setTagMatches([]);
								}}
							/>
						</label>
						{tagQuery.trim().length >= 2 && tagMatches.length > 0 && (
							<ul className='rinspace-create-tag-results'>
								{tagMatches.map((tag) => (
									<li key={tag.id}>
										<span>
											{tag.displayName} <small>{tag.usageScope}</small>
										</span>
										<button
											type='button'
											className='button secondary'
											disabled={
												selectedTags.length >= 6 || Boolean(tagOperationId)
											}
											onClick={() => chooseTag(tag)}
										>
											{t('Add')}
										</button>
									</li>
								))}
							</ul>
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
											current.filter((entry) => entry.id !== tag.id),
										)
									}
								>
									{tag.displayName} ×
								</button>
							))}
						</div>
						{selectedTags.length === 0 && (
							<p className='ui-meta'>
								{t('No Tag selected. General will be attached automatically.')}
							</p>
						)}
						{capability.tagCreationEnabled &&
							!showNewTag &&
							tagQuery.trim() && (
								<button
									type='button'
									className='button secondary'
									onClick={() => {
										setNewTagName(tagQuery.trim());
										setShowNewTag(true);
									}}
								>
									{t('Create')} “{tagQuery.trim()}”
								</button>
							)}
						{capability.tagCreationEnabled && showNewTag && (
							<div className='ui-card ui-stack' data-padding='md' data-gap='sm'>
								<div className='ui-toolbar' data-justify='between'>
									<h3 className='ui-panel-title' data-size='body'>
										{t('New tag')}
									</h3>
									<button
										type='button'
										className='ui-icon-button'
										data-variant='subtle'
										aria-label={t('Cancel')}
										onClick={() => setShowNewTag(false)}
									>
										×
									</button>
								</div>
								<label className='ui-field'>
									<span className='ui-field-label'>{t('Tag name')}</span>
									<input
										className='ui-field-control'
										value={newTagName}
										maxLength={256}
										disabled={Boolean(tagOperationId)}
										onChange={(event) => {
											setNewTagName(event.target.value);
											invalidateTagCandidateReview();
										}}
									/>
								</label>
								<label className='ui-field'>
									<span className='ui-field-label'>{t('Usage scope')}</span>
									<textarea
										className='ui-field-control'
										value={newTagScope}
										maxLength={2000}
										disabled={Boolean(tagOperationId)}
										onChange={(event) => {
											setNewTagScope(event.target.value);
											invalidateTagCandidateReview();
										}}
									/>
								</label>
								{parentTags.length > 0 && (
									<p>
										{t('Parents')}:{' '}
										{parentTags.map((tag) => (
											<button
												type='button'
												key={tag.id}
												disabled={Boolean(tagOperationId)}
												onClick={() => {
													setParentTags((current) =>
														current.filter((item) => item.id !== tag.id),
													);
													invalidateTagCandidateReview();
												}}
											>
												{tag.displayName} ×
											</button>
										))}
									</p>
								)}
								<button
									type='button'
									className='button secondary'
									disabled={
										busy ||
										Boolean(tagOperationId) ||
										!newTagName.trim() ||
										!newTagScope.trim() ||
										selectedTags.length >= 6
									}
									onClick={() => void beginTagCreation()}
								>
									{candidatesReviewed ? t('Create tag') : t('Continue')}
								</button>
								{candidates.length > 0 && (
									<div role='status'>
										<p>{t('Matching Tags already exist. Choose one:')}</p>
										{candidates.map((candidate) => (
											<button
												type='button'
												key={candidate.id}
												disabled={Boolean(tagOperationId)}
												onClick={() => void chooseCandidate(candidate)}
											>
												{candidate.displayName} · {candidate.usageScope}
												{candidate.parentTagIds.length > 0
													? ` · ${candidate.parentTagIds.length} ${t('parent Tags')}`
													: ''}
											</button>
										))}
									</div>
								)}
								{tagOperationId && (
									<div role='status'>
										<p>
											{tagStatus?.state === 'failed' ||
											tagStatus?.state === 'reconciliation_required'
												? t('Tag creation needs attention')
												: t(
														'Tag creation is pending. It will be added when active.',
													)}
										</p>
										{(tagStatus?.state === 'failed' ||
											tagStatus?.state === 'reconciliation_required') &&
											tagStatus.retryable && (
												<button
													type='button'
													disabled={busy}
													onClick={() => void retryTag()}
												>
													{t('Retry Tag creation')}
												</button>
											)}
									</div>
								)}
							</div>
						)}
					</div>
					<div className='ui-actions' data-variant='modal'>
						<button
							type='button'
							className='button secondary'
							onClick={onClose}
						>
							{t('Cancel')}
						</button>
						<button
							type='button'
							className='button primary'
							disabled={
								!intent.title.trim() ||
								busy ||
								Boolean(tagOperationId) ||
								Boolean(pendingCover)
							}
							onClick={() => void submit()}
						>
							{busy ? t('Creating...') : t('Create Project')}
						</button>
					</div>
				</div>
			)}
			{capability?.enabled && step === 3 && (
				<div className='ui-stack' data-gap='md'>
					<h3>{intent.title || t('Untitled')}</h3>
					<p>
						{intent.kind === 'article' ? t('Article') : t('Book')} ·{' '}
						{intent.sourceFormat === 'latex'
							? 'LaTeX'
							: intent.sourceFormat === 'markdown'
								? 'Markdown'
								: 'Typst'}{' '}
						·{' '}
						{intent.visibility === 'private'
							? t('Private source')
							: t('Open source')}
					</p>
					<p>
						{t(
							'Draft; no publication or initial rendering job will be created.',
						)}
					</p>
					<p>
						{selectedTags.length
							? selectedTags.map((tag) => tag.displayName).join(', ')
							: t('General (automatic)')}
					</p>
					{operation ? (
						<div role='status'>
							<p>{projectStateMessage(operation.state)}</p>
							{operation.state === 'ready' && operation.openIntent && (
								<button
									type='button'
									className='button primary'
									onClick={() =>
										void onOpen(operation).catch((cause: unknown) =>
											setError(
												cause instanceof Error
													? cause.message
													: t('Project access unavailable'),
											),
										)
									}
								>
									{t('Open project')}
								</button>
							)}
							{(operation.state === 'reconciliation_required' ||
								operation.state === 'retryable_failure') &&
								operation.retryable && (
									<button
										type='button'
										onClick={() => void submit()}
										disabled={busy}
									>
										{t('Retry with the same request')}
									</button>
								)}
						</div>
					) : (
						<button
							type='button'
							className='button primary'
							disabled={busy || !intent.title.trim()}
							onClick={() => void submit()}
						>
							{busy ? t('Creating...') : t('Create draft')}
						</button>
					)}
					{creationKeyConflict && !operation && (
						<div role='alert'>
							<p>
								{t(
									'This draft changed after its creation request. Keep the original request or explicitly start over.',
								)}
							</p>
							<button
								type='button'
								className='button secondary'
								onClick={reset}
							>
								{t('Discard this attempt and start over')}
							</button>
						</div>
					)}
					<div className='ui-actions' data-variant='modal'>
						{!operation && (
							<button
								type='button'
								className='button secondary'
								onClick={() => setStep(2)}
							>
								{t('Back')}
							</button>
						)}
						{operation?.state === 'ready' && (
							<button
								type='button'
								className='button secondary'
								onClick={reset}
							>
								{t('Create another')}
							</button>
						)}
					</div>
				</div>
			)}
		</div>
	);
};

export default RinspaceProjectCreate;
