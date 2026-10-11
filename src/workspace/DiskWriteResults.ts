// SPDX-License-Identifier: AGPL-3.0-or-later
export type DiskWriteReason =
	| 'invalid-path' | 'protected-path' | 'duplicate-path' | 'not-linked' | 'suppressed'
	| 'deleted' | 'missing-content' | 'target-changed' | 'write-failed';

export interface DiskWriteEntry {
	readonly fileId: string;
	readonly path: string;
	readonly type: 'file' | 'directory';
	// Captured FileStore metadata, NOT a durable project revision or snapshot ack.
	readonly lastModified: number;
	readonly sequence: number;
	readonly outcome: 'writing' | 'written' | 'failed' | 'skipped';
	readonly reason?: DiskWriteReason;
	readonly error?: unknown;
	readonly baselineAvailable?: boolean;
	readonly baselineError?: unknown;
}

/** In-memory operation result: close completion is not read-back verification. */
export interface DiskWriteReport {
	readonly projectId: string | null;
	readonly targetGeneration: number;
	readonly sequence: number;
	readonly entries: readonly DiskWriteEntry[];
}

export interface DiskWriteStatus {
	readonly projectId: string | null;
	readonly targetGeneration: number;
	readonly entries: readonly DiskWriteEntry[];
}
