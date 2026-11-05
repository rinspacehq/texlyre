// SPDX-License-Identifier: AGPL-3.0-or-later
import { useSyncExternalStore } from 'react';
import type { WorkspaceCatalogProject } from '@/workspace/contracts';

interface Snapshot {
	readonly projects: readonly WorkspaceCatalogProject[];
	readonly selectedTag: string;
	readonly selectedType: string;
}

let snapshot: Snapshot = { projects: [], selectedTag: '', selectedType: '' };
const listeners = new Set<() => void>();

function update(patch: Partial<Snapshot>) {
	snapshot = { ...snapshot, ...patch };
	for (const listener of listeners) listener();
}

export const publishRinspaceProjects = (
	projects: readonly WorkspaceCatalogProject[],
) => update({ projects });
export const setRinspaceProjectTag = (selectedTag: string) =>
	update({ selectedTag });
export const setRinspaceProjectType = (selectedType: string) =>
	update({ selectedType });
export const getRinspaceProjectHomeSnapshot = () => snapshot;
export function useRinspaceProjectHomeSnapshot(): Snapshot {
	return useSyncExternalStore(
		(listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		() => snapshot,
		() => snapshot,
	);
}
