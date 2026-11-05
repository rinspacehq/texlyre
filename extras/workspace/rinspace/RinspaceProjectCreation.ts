// SPDX-License-Identifier: AGPL-3.0-or-later
import { loadRinspaceSession } from './RinspaceSession';

const ROOT = '/rinspace/api/editor/v1/project-creations';
const TAG_ROOT = '/rinspace/api/v2';

export type ProjectKind = 'article' | 'book';
export type SourceFormat = 'latex' | 'markdown' | 'typst';

export interface ProjectCreationCapability {
	schemaVersion: 'rinspace-editor-project-creation/v1';
	enabled: boolean;
	kinds: ProjectKind[];
	sourceFormats: SourceFormat[];
	maxTags: number;
	defaultVisibility: 'private';
	tagCreationEnabled: boolean;
}

export interface BindableTag {
	id: string;
	displayName: string;
	usageScope: string;
	parentTagIds: string[];
}

export interface TagCandidate {
	id: number;
	displayName: string;
	usageScope: string;
	parentTagIds: number[];
}

export interface ProjectCreationIntent {
	kind: ProjectKind;
	sourceFormat: SourceFormat;
	title: string;
	excerpt: string;
	visibility: 'private' | 'open';
	coverRef: string;
	tagIds: string[];
	idempotencyKey: string;
}

export interface ProjectCreationOperation {
	operationId: string;
	contentId: string;
	kind: ProjectKind;
	sourceFormat: SourceFormat;
	sourceVisibility: 'private' | 'open';
	state: 'validating' | 'provisioning' | 'awaiting_source_activation' | 'ready' | 'retryable_failure' | 'reconciliation_required';
	title: string;
	openIntent?: Readonly<Record<string, string>>;
	retryable: boolean;
	publicCode?: string;
}

export interface TagCreationOperation {
	operationId: string;
	tagId?: number;
	state: string;
	currentStep?: string;
	publicErrorCode?: string;
	retryable?: boolean;
}

export class RinspaceRequestError extends Error {
	constructor(public readonly status: number, public readonly code: string, label: string) {
		super(`${label} (${status})`);
	}
}

async function jsonResponse<T>(response: Response, label: string): Promise<T> {
	if (!response.ok) {
		let code = '';
		try {
			const body = await response.json() as { error?: unknown };
			if (typeof body.error === 'string' && /^[a-z][a-z0-9_]{0,80}$/.test(body.error)) code = body.error;
		} catch { /* An HTTP status is still enough to report the failure. */ }
		throw new RinspaceRequestError(response.status, code, label);
	}
	return response.json() as Promise<T>;
}

async function request<T>(path: string, signal: AbortSignal, body?: unknown, expectedActorId?: string): Promise<T> {
	const session = await loadRinspaceSession(globalThis.fetch, signal);
	if (expectedActorId && session.user.id !== expectedActorId) throw new Error('Rinspace account changed. Reopen project creation for the current account.');
	signal.throwIfAborted();
	const response = await fetch(path, {
		method: body === undefined ? 'GET' : 'POST',
		credentials: 'include', cache: 'no-store', signal,
		headers: {
			Accept: 'application/json',
			...(body === undefined ? {} : {
				'Content-Type': 'application/json',
				'X-Rinspace-CSRF': session.csrfToken,
			}),
		},
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
	return jsonResponse<T>(response, 'Rinspace request');
}

export async function projectCreationCapability(signal: AbortSignal): Promise<ProjectCreationCapability> {
	const value = await request<ProjectCreationCapability>(`${ROOT}/capability`, signal);
	if (value.schemaVersion !== 'rinspace-editor-project-creation/v1' || !Array.isArray(value.kinds) || !Array.isArray(value.sourceFormats) ||
		value.maxTags !== 6 || value.defaultVisibility !== 'private') {
		throw new Error('Rinspace project creation capability is incompatible');
	}
	return value;
}

export async function searchBindableTags(query: string, signal: AbortSignal, actorId?: string): Promise<BindableTag[]> {
	const value = await request<{ schemaVersion: string; items: BindableTag[] }>(
		`/rinspace/api/editor/v1/tags?q=${encodeURIComponent(query)}`, signal, undefined, actorId,
	);
	if (value.schemaVersion !== 'rinspace-editor-tags/v1' || !Array.isArray(value.items) || value.items.length > 20 ||
		value.items.some((tag) => !/^[1-9][0-9]*$/.test(tag.id) || typeof tag.displayName !== 'string' || !Array.isArray(tag.parentTagIds))) {
		throw new Error('Rinspace Tag search response is incompatible');
	}
	return value.items;
}

export async function tagCandidates(name: string, signal: AbortSignal, actorId?: string): Promise<TagCandidate[]> {
	const value = await request<{ items: TagCandidate[] }>(
		`${TAG_ROOT}/tags/candidates?name=${encodeURIComponent(name)}`, signal, undefined, actorId,
	);
	if (!Array.isArray(value.items) || value.items.some((item) => !Number.isSafeInteger(item.id) || item.id <= 0 || typeof item.displayName !== 'string' || typeof item.usageScope !== 'string' || !Array.isArray(item.parentTagIds) || item.parentTagIds.some((id) => !Number.isSafeInteger(id) || id <= 0))) throw new Error('Rinspace Tag candidates are incompatible');
	return value.items;
}

export async function createTag(input: {
	displayName: string;
	usageScope: string;
	parentTagIds: number[];
	idempotencyKey: string;
}, signal: AbortSignal, actorId?: string): Promise<TagCreationOperation> {
	const value = await request<{ operationId: string; state: string; tag?: { id: number } }>(`${TAG_ROOT}/tags`, signal, input, actorId);
	if (!value.operationId || !value.state) throw new Error('Rinspace Tag operation is incompatible');
	return { operationId: value.operationId, state: value.state, tagId: value.tag?.id };
}

export async function tagOperation(id: string, signal: AbortSignal, actorId?: string): Promise<TagCreationOperation> {
	const value = await request<TagCreationOperation>(`${TAG_ROOT}/tag-operations/${encodeURIComponent(id)}`, signal, undefined, actorId);
	if (value.tagId !== undefined && (!Number.isSafeInteger(value.tagId) || value.tagId <= 0)) throw new Error('Rinspace Tag ID exceeds browser precision');
	return value;
}

export async function retryTagOperation(id: string, signal: AbortSignal, actorId?: string): Promise<TagCreationOperation> {
	return request<TagCreationOperation>(`${TAG_ROOT}/tag-operations/${encodeURIComponent(id)}/retry`, signal, {}, actorId);
}

export async function createProject(input: ProjectCreationIntent, signal: AbortSignal, actorId?: string): Promise<ProjectCreationOperation> {
	return request<ProjectCreationOperation>(ROOT, signal, input, actorId);
}

export async function recoverProject(key: string, signal: AbortSignal, actorId?: string): Promise<ProjectCreationOperation> {
	return request<ProjectCreationOperation>(`${ROOT}/recover`, signal, { idempotencyKey: key }, actorId);
}

export async function projectOperation(id: string, signal: AbortSignal, actorId?: string): Promise<ProjectCreationOperation> {
	return request<ProjectCreationOperation>(`${ROOT}/${encodeURIComponent(id)}`, signal, undefined, actorId);
}

export async function uploadProjectCover(file: File, signal: AbortSignal, actorId?: string): Promise<string> {
	const session = await loadRinspaceSession(globalThis.fetch, signal);
	if (actorId && session.user.id !== actorId) throw new Error('Rinspace account changed. Reopen project creation for the current account.');
	const form = new FormData();
	form.set('source', 'cover');
	form.set('file', file);
	const response = await fetch('/rinspace/api/file', {
		method: 'POST', credentials: 'include', cache: 'no-store', signal,
		headers: { Accept: 'application/json', 'X-Rinspace-CSRF': session.csrfToken },
		body: form,
	});
	const value = await jsonResponse<unknown>(response, 'Rinspace cover upload');
	if (typeof value !== 'string' || !value || value.length > 4096) throw new Error('Rinspace cover reference is invalid');
	return value;
}
