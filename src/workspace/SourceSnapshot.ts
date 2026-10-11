// SPDX-License-Identifier: AGPL-3.0-or-later
import type { SnapshotClock, SnapshotFile, SourceSnapshot, WorkspaceBinding } from './contracts';

export interface SnapshotInput {
	readonly binding: WorkspaceBinding | null;
	readonly clock: SnapshotClock;
	readonly projectionVersion: string;
	readonly files: readonly { readonly path: string; readonly mode: SnapshotFile['mode']; readonly bytes: Uint8Array }[];
}

async function sha256(bytes: Uint8Array): Promise<string> {
	const buffer = new ArrayBuffer(bytes.byteLength);
	new Uint8Array(buffer).set(bytes);
	const digest = await crypto.subtle.digest('SHA-256', buffer);
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function validatePath(path: string): void {
	if (!path || /[\\\u0000-\u001f]/.test(path) || path.startsWith('/') || /^[A-Za-z]:/.test(path)
		|| path.split('/').some((part) => !part || part === '.' || part === '..' || part.toLowerCase() === '.git')) {
		throw new Error('Snapshot path must be a safe repository-relative path');
	}
}

/** Copy ALL input synchronously before the first await; no half-live capture. */
export async function captureSourceSnapshot(input: SnapshotInput, signal?: AbortSignal): Promise<SourceSnapshot> {
	signal?.throwIfAborted();
	if (!input.projectionVersion) throw new Error('Snapshot projection version is required');
	if (!['local', 'checkpoint'].includes(input.clock.kind)) throw new Error('Invalid snapshot clock kind');
	const clock = Object.freeze(input.clock.kind === 'local'
		? { kind: 'local' as const, revision: input.clock.revision }
		: { kind: 'checkpoint' as const, cutSeq: input.clock.cutSeq });
	const sequence = clock.kind === 'local' ? clock.revision : clock.cutSeq;
	if (!Number.isSafeInteger(sequence) || sequence < 0) throw new Error('Invalid snapshot sequence');
	const binding = input.binding ? Object.freeze({
		repositoryId: input.binding.repositoryId,
		branchBindingId: input.binding.branchBindingId,
		ref: input.binding.ref,
		workspaceId: input.binding.workspaceId,
		generation: input.binding.generation,
		baseCommit: input.binding.baseCommit,
		objectFormat: input.binding.objectFormat,
	}) : null;
	if (binding) {
		const length = binding.objectFormat === 'sha1' ? 40 : binding.objectFormat === 'sha256' ? 64 : 0;
		if (!length || !new RegExp(`^[0-9a-f]{${length}}$`).test(binding.baseCommit)
			|| [binding.repositoryId, binding.branchBindingId, binding.ref, binding.workspaceId]
				.some((value) => typeof value !== 'string' || !value.trim())
			|| !Number.isSafeInteger(binding.generation) || binding.generation < 1) {
			throw new Error('Invalid snapshot baseline');
		}
	}
	const projectionVersion = input.projectionVersion;
	const contents = new Map<string, Uint8Array>();
	const copied = input.files.map((file) => {
		validatePath(file.path);
		if (!['100644', '100755', '120000'].includes(file.mode)) throw new Error('Unsupported snapshot file mode');
		if (contents.has(file.path)) throw new Error('Duplicate snapshot path');
		const bytes = new Uint8Array(file.bytes);
		contents.set(file.path, bytes);
		return { path: file.path, mode: file.mode, bytes };
	}).sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
	const files: SnapshotFile[] = [];
	for (const file of copied) {
		signal?.throwIfAborted();
		files.push(Object.freeze({ path: file.path, mode: file.mode, byteLength: file.bytes.byteLength, sha256: await sha256(file.bytes) }));
	}
	const id = `sha256:${await sha256(new TextEncoder().encode(JSON.stringify({ binding, clock, projectionVersion, files })))}`;
	signal?.throwIfAborted();
	return Object.freeze({
		id, binding, clock, projectionVersion, files: Object.freeze(files),
		readFile(path: string): Uint8Array {
			const bytes = contents.get(path);
			if (!bytes) throw new Error('File is not in this source snapshot');
			return new Uint8Array(bytes);
		},
	});
}
