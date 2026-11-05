// SPDX-License-Identifier: AGPL-3.0-or-later
import type React from 'react';
import { useEffect, useRef, useState } from 'react';

import { t } from '@/i18n';

import { loadRinspaceSession } from './RinspaceSession';
import RinspaceCoverCrop from './RinspaceCoverCrop';
import { MAX_COVER_INPUT_BYTES } from './RinspaceCoverCropGeometry';
import {
	createProject, createTag, projectCreationCapability, projectOperation,
	recoverProject, retryTagOperation, searchBindableTags, tagCandidates, tagOperation, uploadProjectCover, RinspaceRequestError,
	type BindableTag, type ProjectCreationCapability, type ProjectCreationIntent,
	type ProjectCreationOperation, type ProjectKind, type SourceFormat, type TagCandidate, type TagCreationOperation,
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

interface PendingCover { imageURL: string }

function initialIntent(): ProjectCreationIntent {
	return {
		kind: 'article', sourceFormat: 'latex', title: '', excerpt: '', visibility: 'private',
		coverRef: '', tagIds: [], idempotencyKey: crypto.randomUUID(),
	};
}

function storageKey(actorId: string): string {
	return `rinspace-project-create-v1:${actorId}`;
}

function readDraft(actorId: string): SavedDraft | null {
	try {
		const value = JSON.parse(localStorage.getItem(storageKey(actorId)) || 'null') as SavedDraft | null;
		if (!value || ![1, 2, 3].includes(value.step) || !value.intent ||
			!['article', 'book'].includes(value.intent.kind) ||
			!['latex', 'markdown', 'typst'].includes(value.intent.sourceFormat) ||
			!/^[A-Za-z0-9_-]{16,128}$/.test(value.intent.idempotencyKey) ||
			!Array.isArray(value.selectedTags) || !Array.isArray(value.parentTags)) return null;
		return value;
	} catch { return null; }
}

function saveDraft(actorId: string, draft: SavedDraft): void {
	try { localStorage.setItem(storageKey(actorId), JSON.stringify(draft)); } catch { /* Optional recovery. */ }
}

function projectStateMessage(state: ProjectCreationOperation['state']): string {
	switch (state) {
		case 'validating': return t('Checking project details...');
		case 'provisioning': return t('Creating the project repository...');
		case 'awaiting_source_activation': return t('Checking the initial project files...');
		case 'ready': return t('Project is ready');
		case 'retryable_failure': return t('Project creation failed. You can retry the same request.');
		case 'reconciliation_required': return t('Project creation needs attention. Retry the same request if available.');
	}
}

const RinspaceProjectCreate: React.FC<Props> = ({ onClose, onOpen }) => {
	const [actorId, setActorId] = useState('');
	const [capability, setCapability] = useState<ProjectCreationCapability | null>(null);
	const [step, setStep] = useState<1 | 2 | 3>(1);
	const [intent, setIntent] = useState<ProjectCreationIntent>(initialIntent);
	const [selectedTags, setSelectedTags] = useState<BindableTag[]>([]);
	const [parentTags, setParentTags] = useState<BindableTag[]>([]);
	const [tagQuery, setTagQuery] = useState('');
	const [tagMatches, setTagMatches] = useState<BindableTag[]>([]);
	const [newTagName, setNewTagName] = useState('');
	const [pendingCover, setPendingCover] = useState<PendingCover | null>(null);
	const [newTagScope, setNewTagScope] = useState('');
	const [candidates, setCandidates] = useState<TagCandidate[]>([]);
	const [candidatesReviewed, setCandidatesReviewed] = useState(false);
	const [tagOperationId, setTagOperationId] = useState('');
	const [tagStatus, setTagStatus] = useState<TagCreationOperation | null>(null);
	const [tagPollEpoch, setTagPollEpoch] = useState(0);
	const [tagCreationKey, setTagCreationKey] = useState('');
	const [operation, setOperation] = useState<ProjectCreationOperation | null>(null);
	const [operationId, setOperationId] = useState('');
	const [submitted, setSubmitted] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const [creationKeyConflict, setCreationKeyConflict] = useState(false);
	const controllers = useRef(new Set<AbortController>());
	const pendingCoverURL = useRef<string | null>(null);
	useEffect(() => () => {
		if (pendingCoverURL.current) URL.revokeObjectURL(pendingCoverURL.current);
	}, []);
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
	const controller = () => {
		const next = new AbortController();
		controllers.current.add(next);
		return next;
	};

	useEffect(() => {
		const pendingControllers = controllers.current;
		const active = controller();
		void Promise.all([
			loadRinspaceSession(globalThis.fetch, active.signal),
			projectCreationCapability(active.signal),
		]).then(([session, available]) => {
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
				setNewTagScope(saved.tagScope || '');
			}
		}).catch((cause: unknown) => {
			if (!active.signal.aborted) setError(cause instanceof Error ? cause.message : t('Rinspace is unavailable'));
		}).finally(() => pendingControllers.delete(active));
		return () => { for (const pending of pendingControllers) pending.abort(); pendingControllers.clear(); };
	}, []);

	useEffect(() => {
		if (!actorId) return;
		saveDraft(actorId, {
			step, intent: { ...intent, tagIds: selectedTags.map((tag) => tag.id) },
			selectedTags, parentTags, operationId: operationId || undefined, submitted,
			tagOperationId: tagOperationId || undefined, tagName: newTagName,
			tagScope: newTagScope, tagCreationKey: tagCreationKey || undefined,
		});
	}, [actorId, step, intent, selectedTags, parentTags, operationId, tagOperationId, newTagName, newTagScope, tagCreationKey, submitted]);

	useEffect(() => {
		if (tagQuery.trim().length < 2 || !capability?.enabled) return;
		const pendingControllers = controllers.current;
		const active = controller();
		const timer = window.setTimeout(() => {
			void searchBindableTags(tagQuery.trim(), active.signal, actorId).then((items) => {
				if (!active.signal.aborted) setTagMatches(items);
			}).catch((cause: unknown) => {
				if (!active.signal.aborted) setError(cause instanceof Error ? cause.message : t('Tag search failed'));
			}).finally(() => pendingControllers.delete(active));
		}, 250);
		return () => { window.clearTimeout(timer); active.abort(); pendingControllers.delete(active); };
	}, [tagQuery, capability?.enabled, actorId]);

	useEffect(() => {
		if (!tagOperationId || !actorId) return;
		const pendingControllers = controllers.current;
		const active = controller();
		let timer = 0;
		const poll = async (attempt: number) => {
			try {
				const state = await tagOperation(tagOperationId, active.signal, actorId);
				if (active.signal.aborted) return;
				setTagStatus(state);
				if (state.state === 'active' && state.tagId) {
					const tag: BindableTag = { id: String(state.tagId), displayName: newTagName, usageScope: newTagScope, parentTagIds: parentTags.map((parent) => parent.id) };
					setSelectedTags((current) => current.some((entry) => entry.id === tag.id) ? current : [...current, tag].slice(0, 6));
					setTagOperationId(''); setTagStatus(null); setTagCreationKey(''); setNewTagName(''); setNewTagScope(''); setParentTags([]); setCandidates([]); setCandidatesReviewed(false);
					return;
				}
				if (state.state === 'failed' || state.state === 'reconciliation_required') {
					setError(t('Tag creation needs attention'));
					return;
				}
			} catch (cause) {
				if (active.signal.aborted) return;
				setError(cause instanceof Error ? cause.message : t('Tag operation unavailable'));
			}
			if (!active.signal.aborted) timer = window.setTimeout(() => void poll(attempt + 1), document.hidden ? 15000 : Math.min(8000, 1000 * 2 ** Math.min(attempt, 3)));
		};
		void poll(0);
		return () => { window.clearTimeout(timer); active.abort(); pendingControllers.delete(active); };
	}, [tagOperationId, tagPollEpoch, actorId, newTagName, newTagScope, parentTags]);
	const retryTag = async () => {
		if (!tagOperationId || !actorId || busy) return;
		setBusy(true); setError('');
		const active = controller();
		try {
			const state = await retryTagOperation(tagOperationId, active.signal, actorId);
			if (!active.signal.aborted) { setTagStatus(state); setTagPollEpoch((value) => value + 1); }
		} catch (cause) {
			if (!active.signal.aborted) setError(cause instanceof Error ? cause.message : t('Tag retry unavailable'));
		} finally { controllers.current.delete(active); setBusy(false); }
	};

	useEffect(() => {
		if (step !== 3 || !submitted || !actorId || operation?.state === 'ready') return;
		const pendingControllers = controllers.current;
		const active = controller();
		let timer = 0;
		const poll = async (attempt: number) => {
			try {
				const next = operationId ? await projectOperation(operationId, active.signal, actorId) : await recoverProject(intent.idempotencyKey, active.signal, actorId);
				if (active.signal.aborted) return;
				setOperation(next);
				if (!operationId) setOperationId(next.operationId);
				if (next.state === 'ready') return;
				if (next.state === 'reconciliation_required' || next.state === 'retryable_failure') {
					setError(t('Project creation needs attention'));
					return;
				}
			} catch (cause) {
				if (active.signal.aborted) return;
				// Creation can still be running before its first durable content row.
				if (attempt > 1) setError(cause instanceof Error ? cause.message : t('Project status unavailable'));
			}
			if (!active.signal.aborted) timer = window.setTimeout(() => void poll(attempt + 1), document.hidden ? 15000 : Math.min(8000, 1000 * 2 ** Math.min(attempt, 3)));
		};
		void poll(0);
		return () => { window.clearTimeout(timer); active.abort(); pendingControllers.delete(active); };
	}, [step, submitted, actorId, operationId, intent.idempotencyKey, operation?.state]);

	const updateIntent = (patch: Partial<ProjectCreationIntent>) => setIntent((current) => ({ ...current, ...patch }));
	const invalidateTagCandidateReview = () => {
		setCandidates([]);
		setCandidatesReviewed(false);
		if (!tagOperationId) setTagCreationKey('');
	};
	const chooseTag = (tag: BindableTag) => {
		setSelectedTags((current) => current.some((entry) => entry.id === tag.id) || current.length >= 6 ? current : [...current, tag]);
	};
	const submit = async () => {
		if (!actorId || !capability?.enabled || !capability.kinds.includes(intent.kind) ||
			!capability.sourceFormats.includes(intent.sourceFormat) || !intent.title.trim() || busy || tagOperationId) return;
		setBusy(true); setError(''); setCreationKeyConflict(false); setStep(3); setSubmitted(true);
		const active = controller();
		try {
			const next = await createProject({ ...intent, title: intent.title.trim(), excerpt: intent.excerpt.trim(), tagIds: selectedTags.map((tag) => tag.id) }, active.signal, actorId);
			if (!active.signal.aborted) { setOperation(next); setOperationId(next.operationId); }
		} catch (cause) {
			if (!active.signal.aborted) {
				setError(cause instanceof Error ? cause.message : t('Project creation unavailable'));
				setCreationKeyConflict(cause instanceof RinspaceRequestError && cause.code === 'idempotency_key_conflict');
				if (cause instanceof RinspaceRequestError && [400, 403, 409, 413, 429].includes(cause.status)) setSubmitted(false);
			}
		} finally { controllers.current.delete(active); setBusy(false); }
	};
	const beginTagCreation = async () => {
		if (!newTagName.trim() || !newTagScope.trim() || !capability?.tagCreationEnabled || busy || selectedTags.length >= 6) return;
		setBusy(true); setError('');
		const active = controller();
		try {
			if (!tagCreationKey && !candidatesReviewed) {
				const matches = await tagCandidates(newTagName.trim(), active.signal, actorId);
				if (active.signal.aborted) return;
				setCandidates(matches);
				if (matches.length) { setCandidatesReviewed(true); return; }
			}
			const stableKey = tagCreationKey || `editor-tag-${crypto.randomUUID()}`;
			setTagCreationKey(stableKey);
			const created = await createTag({
				displayName: newTagName.trim(), usageScope: newTagScope.trim(),
				parentTagIds: parentTags.map((parent) => Number(parent.id)),
				idempotencyKey: stableKey,
			}, active.signal, actorId);
			if (!active.signal.aborted) { setCandidates([]); setCandidatesReviewed(false); setTagOperationId(created.operationId); }
		} catch (cause) {
			if (!active.signal.aborted) {
				setError(cause instanceof Error ? cause.message : t('Tag creation unavailable'));
				if (cause instanceof RinspaceRequestError && cause.status === 409) {
					try { setCandidates(await tagCandidates(newTagName.trim(), active.signal, actorId)); setCandidatesReviewed(true); }
					catch { /* Keep the explicit conflict error. */ }
				}
			}
		} finally { controllers.current.delete(active); setBusy(false); }
	};
	const chooseCandidate = async (candidate: TagCandidate) => {
		const active = controller();
		try {
			const bindable = (await searchBindableTags(candidate.displayName, active.signal, actorId)).find((tag) => tag.id === String(candidate.id));
			if (!bindable) throw new Error(t('This Tag is not yet bindable. Wait for activation.'));
			chooseTag(bindable);
			setCandidates([]); setCandidatesReviewed(false); setNewTagName(''); setNewTagScope(''); setParentTags([]); setTagCreationKey('');
		} catch (cause) {
			if (!active.signal.aborted) setError(cause instanceof Error ? cause.message : t('Tag is unavailable'));
		} finally { controllers.current.delete(active); }
	};
	const reset = () => {
		if (actorId) { try { localStorage.removeItem(storageKey(actorId)); } catch { /* Optional. */ } }
		setIntent(initialIntent()); clearPendingCover(); setSelectedTags([]); setParentTags([]); setTagQuery(''); setTagMatches([]); setNewTagName(''); setNewTagScope(''); setCandidates([]); setCandidatesReviewed(false); setTagCreationKey(''); setTagOperationId(''); setTagStatus(null); setOperation(null); setOperationId(''); setSubmitted(false); setCreationKeyConflict(false); setStep(1); setError('');
	};

	return <section className='ui-panel rinspace-project-create' aria-labelledby='rinspace-create-title'>
		<div className='ui-panel-header'>
			<h2 id='rinspace-create-title' className='ui-panel-title'>{t('Create Rinspace project')}</h2>
			<button type='button' className='button secondary' onClick={onClose}>{t('Close')}</button>
		</div>
		<div className='ui-panel-content' data-padding='md'>
			<p className='ui-meta'>{t('Step {step} of 3', { step })}</p>
			{error && <div className='ui-message' data-tone='error' role='alert'>{error}</div>}
			{!capability && !error && <p>{t('Loading project capability...')}</p>}
			{capability && !capability.enabled && <p>{t('Project creation is unavailable for this account.')}</p>}
			{capability?.enabled && step === 1 && <>
				<fieldset className='rinspace-create-fieldset'><legend>{t('What are you creating?')}</legend>
					<div className='rinspace-create-choices'>{capability.kinds.map((kind: ProjectKind) => <label key={kind} className='ui-card'>
						<input type='radio' name='project-kind' checked={intent.kind === kind} onChange={() => {
							if (intent.kind !== kind) { updateIntent({ kind, coverRef: '' }); clearPendingCover(); }
						}} /> {kind === 'article' ? t('Article') : t('Book')}
					</label>)}</div>
				</fieldset>
				<fieldset className='rinspace-create-fieldset'><legend>{t('Source format')}</legend>
					<div className='rinspace-create-choices'>{capability.sourceFormats.map((sourceFormat: SourceFormat) => <label key={sourceFormat} className='ui-card'>
						<input type='radio' name='source-format' checked={intent.sourceFormat === sourceFormat} onChange={() => updateIntent({ sourceFormat })} /> {sourceFormat === 'latex' ? 'LaTeX' : sourceFormat === 'markdown' ? 'Markdown' : 'Typst'}
					</label>)}</div>
				</fieldset>
				<p>{t('The project begins as a draft. Source visibility can be changed before publishing.')}</p>
				<button type='button' className='button primary' onClick={() => setStep(2)}>{t('Continue')}</button>
			</>}
			{capability?.enabled && step === 2 && <div className='rinspace-create-form'>
				<label>{t('Title')}<input value={intent.title} maxLength={180} required onChange={(event) => updateIntent({ title: event.target.value })} /></label>
				<label>{t('Summary')}<textarea value={intent.excerpt} maxLength={240} onChange={(event) => updateIntent({ excerpt: event.target.value })} /></label>
				<fieldset className='rinspace-create-fieldset'><legend>{t('Source visibility')}</legend>
					<label><input type='radio' name='source-visibility' checked={intent.visibility === 'private'} onChange={() => updateIntent({ visibility: 'private' })} /> {t('Private source')}</label>
					<label><input type='radio' name='source-visibility' checked={intent.visibility === 'open'} onChange={() => updateIntent({ visibility: 'open' })} /> {t('Open source')}</label>
				</fieldset>
				<label>{t('Cover image (optional)')}<input type='file' accept='image/png,image/jpeg,image/webp' disabled={busy} onChange={(event) => {
					const file = event.target.files?.[0]; event.target.value = '';
					if (!file) return;
					if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size === 0 || file.size > MAX_COVER_INPUT_BYTES) {
						setError(t('Choose a PNG, JPEG or WebP image under 20 MiB.')); return;
					}
					setError(''); choosePendingCover(file);
				}} /></label>
				{pendingCover && <RinspaceCoverCrop key={pendingCover.imageURL} imageURL={pendingCover.imageURL} kind={intent.kind} onCancel={clearPendingCover} onUpload={async (cropped) => {
					const active = controller(); setBusy(true);
					try {
						const coverRef = await uploadProjectCover(cropped, active.signal, actorId);
						if (!active.signal.aborted) { updateIntent({ coverRef }); clearPendingCover(); }
					} finally { controllers.current.delete(active); setBusy(false); }
				}} />}
				{intent.coverRef && <p className='ui-meta'>{t('Cover uploaded')} <button type='button' disabled={busy} onClick={() => updateIntent({ coverRef: '' })}>{t('Remove cover')}</button></p>}
				<div className='rinspace-create-tags'>
					<label>{t('Search Tags')}<input type='search' value={tagQuery} onChange={(event) => { setTagQuery(event.target.value); setTagMatches([]); }} /></label>
					{tagQuery.trim().length >= 2 && tagMatches.length > 0 && <ul className='rinspace-create-tag-results'>{tagMatches.map((tag) => <li key={tag.id}>
						<span>{tag.displayName} <small>{tag.usageScope}</small></span>
						<button type='button' disabled={selectedTags.length >= 6 || Boolean(tagOperationId)} onClick={() => chooseTag(tag)}>{t('Add')}</button>
						<button type='button' disabled={Boolean(tagOperationId)} onClick={() => { setParentTags((current) => current.some((entry) => entry.id === tag.id) ? current : [...current, tag].slice(0, 12)); invalidateTagCandidateReview(); }}>{t('Use as parent')}</button>
					</li>)}</ul>}
					<h3>{t('Selected Tags')} ({selectedTags.length}/6)</h3>
					{selectedTags.length === 0 ? <p>{t('No Tag selected. General will be attached automatically.')}</p> :
						<ul>{selectedTags.map((tag) => <li key={tag.id}>{tag.displayName} <button type='button' onClick={() => setSelectedTags((current) => current.filter((entry) => entry.id !== tag.id))}>{t('Remove')}</button></li>)}</ul>}
					{capability.tagCreationEnabled && <div className='rinspace-create-new-tag'>
						<h3>{t('Create a Tag')}</h3>
						<label>{t('Tag name')}<input value={newTagName} maxLength={256} disabled={Boolean(tagOperationId)} onChange={(event) => { setNewTagName(event.target.value); invalidateTagCandidateReview(); }} /></label>
						<label>{t('Usage scope')}<textarea value={newTagScope} maxLength={2000} disabled={Boolean(tagOperationId)} onChange={(event) => { setNewTagScope(event.target.value); invalidateTagCandidateReview(); }} /></label>
						{parentTags.length > 0 && <p>{t('Parents')}: {parentTags.map((tag) => <button type='button' key={tag.id} disabled={Boolean(tagOperationId)} onClick={() => { setParentTags((current) => current.filter((item) => item.id !== tag.id)); invalidateTagCandidateReview(); }}>{tag.displayName} ×</button>)}</p>}
						<button type='button' disabled={busy || Boolean(tagOperationId) || !newTagName.trim() || !newTagScope.trim() || selectedTags.length >= 6} onClick={() => void beginTagCreation()}>{candidatesReviewed ? t('Create Tag after reviewing matches') : t('Check name and create Tag')}</button>
						{candidates.length > 0 && <div role='status'><p>{t('Matching Tags already exist. Choose one:')}</p>{candidates.map((candidate) => <button type='button' key={candidate.id} disabled={Boolean(tagOperationId)} onClick={() => void chooseCandidate(candidate)}>{candidate.displayName} · {candidate.usageScope}{candidate.parentTagIds.length > 0 ? ` · ${candidate.parentTagIds.length} ${t('parent Tags')}` : ''}</button>)}</div>}
						{tagOperationId && <div role='status'><p>{tagStatus?.state === 'failed' || tagStatus?.state === 'reconciliation_required' ? t('Tag creation needs attention') : t('Tag creation is pending. It will be added when active.')}</p>
							{(tagStatus?.state === 'failed' || tagStatus?.state === 'reconciliation_required') && tagStatus.retryable && <button type='button' disabled={busy} onClick={() => void retryTag()}>{t('Retry Tag creation')}</button>}
						</div>}
					</div>}
				</div>
				<div className='ui-toolbar-actions'><button type='button' className='button secondary' onClick={() => setStep(1)}>{t('Back')}</button>
					<button type='button' className='button primary' disabled={!intent.title.trim() || busy || Boolean(tagOperationId) || Boolean(pendingCover)} onClick={() => setStep(3)}>{t('Review')}</button></div>
			</div>}
			{capability?.enabled && step === 3 && <div className='rinspace-create-review'>
				<h3>{intent.title || t('Untitled')}</h3>
				<p>{intent.kind === 'article' ? t('Article') : t('Book')} · {intent.sourceFormat === 'latex' ? 'LaTeX' : intent.sourceFormat === 'markdown' ? 'Markdown' : 'Typst'} · {intent.visibility === 'private' ? t('Private source') : t('Open source')}</p>
				<p>{t('Draft; no publication or initial rendering job will be created.')}</p>
				<p>{selectedTags.length ? selectedTags.map((tag) => tag.displayName).join(', ') : t('General (automatic)')}</p>
				{operation ? <div role='status'><p>{projectStateMessage(operation.state)}</p>
					{operation.state === 'ready' && operation.openIntent && <button type='button' className='button primary' onClick={() => void onOpen(operation).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : t('Project access unavailable')))}>{t('Open project')}</button>}
					{(operation.state === 'reconciliation_required' || operation.state === 'retryable_failure') && operation.retryable && <button type='button' onClick={() => void submit()} disabled={busy}>{t('Retry with the same request')}</button>}
				</div> : <button type='button' className='button primary' disabled={busy || !intent.title.trim()} onClick={() => void submit()}>{busy ? t('Creating...') : t('Create draft')}</button>}
				{creationKeyConflict && !operation && <div role='alert'><p>{t('This draft changed after its creation request. Keep the original request or explicitly start over.')}</p><button type='button' className='button secondary' onClick={reset}>{t('Discard this attempt and start over')}</button></div>}
				<div className='ui-toolbar-actions'>{!operation && <button type='button' className='button secondary' onClick={() => setStep(2)}>{t('Back')}</button>}
					{operation?.state === 'ready' && <button type='button' className='button secondary' onClick={reset}>{t('Create another')}</button>}</div>
			</div>}
		</div>
	</section>;
};

export default RinspaceProjectCreate;
