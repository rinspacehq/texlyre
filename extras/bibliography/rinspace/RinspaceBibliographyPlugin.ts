// SPDX-License-Identifier: AGPL-3.0-or-later
import { BibliographyIcon } from '@/components/common/Icons';
import type { BibliographyPlugin } from '@/plugins/PluginInterface';
import type { BibEntry } from '@/types/bibliography';

const SEARCH_ENDPOINT = '/api/wiki/citations/search';
const PUBLIC_ORIGIN = 'https://rinspace.com';
const MAX_QUERY_LENGTH = 60;

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const record = (value: unknown): Record<string, unknown> | null =>
	typeof value === 'object' && value !== null
		? (value as Record<string, unknown>)
		: null;

const textField = (
	value: Record<string, unknown>,
	snakeName: string,
	camelName: string,
): string => {
	const field = value[snakeName] ?? value[camelName];
	return typeof field === 'string' || typeof field === 'number'
		? String(field).trim()
		: '';
};

const normalizeTagId = (value: string): string =>
	/^[1-9][0-9]*$/.test(value) ? value : '';

const normalizeSlug = (value: string): string => {
	const normalized = value.trim();
	if (!normalized || normalized.length > 120 || /[\s/#?]/.test(normalized)) {
		return '';
	}
	return normalized;
};

const cleanBibText = (value: string): string =>
	value
		.replace(/[\r\n\t]+/g, ' ')
		.replace(/[{}]/g, (character) => `\\${character}`)
		.replace(/\s+/g, ' ')
		.trim();

const dateStamp = (date: Date): string =>
	[
		date.getFullYear(),
		String(date.getMonth() + 1).padStart(2, '0'),
		String(date.getDate()).padStart(2, '0'),
	].join('-');

function citationEntry(
	value: unknown,
	origin: string,
	now: Date,
): BibEntry | null {
	const item = record(value);
	if (!item) return null;
	const targetType = textField(item, 'target_type', 'targetType') || 'tag';
	const targetId = normalizeTagId(textField(item, 'target_id', 'targetId'));
	const resolved = item.resolved === true;
	if (targetType !== 'tag' || !targetId || !resolved) return null;

	const slug = normalizeSlug(
		textField(item, 'target_slug_name', 'targetSlugName'),
	);
	const title = cleanBibText(
		textField(item, 'target_display_name', 'targetDisplayName') ||
			textField(item, 'label', 'label') ||
			`Rinspace tag ${targetId}`,
	);
	const key = `tags/${targetId}`;
	const tagPath = `/tags/${encodeURIComponent(targetId)}/${encodeURIComponent(
		slug || targetId,
	)}`;
	const url = new URL(tagPath, origin).href;
	const accessed = dateStamp(now);
	const fields = {
		author: '{Rinspace}',
		title,
		url,
		note: `Rinspace tag wiki, accessed ${accessed}`,
		year: accessed.slice(0, 4),
	};
	const rawEntry = [
		`@misc{${key},`,
		'  author = {{Rinspace}},',
		`  title = {{${title}}},`,
		`  url = {${url}},`,
		`  note = {${fields.note}},`,
		`  year = {${fields.year}}`,
		'}',
	].join('\n');

	return {
		key,
		entryType: 'misc',
		fields,
		rawEntry,
		providerId: 'rinspace-cite',
		providerName: 'Rin Cite',
		remoteId: `tag:${targetId}`,
	};
}

export function createRinspaceBibliographyPlugin(
	isIntegrationEnabled: () => boolean,
	fetcher: Fetcher = (input, init) => fetch(input, init),
	now: () => Date = () => new Date(),
): BibliographyPlugin {
	return {
		id: 'rinspace-cite',
		name: 'Rin Cite',
		version: '0.1.0',
		type: 'bibliography',
		searchMode: 'on-demand',
		icon: BibliographyIcon,
		isEnabled: isIntegrationEnabled,
		getConnectionStatus: () =>
			isIntegrationEnabled() ? 'connected' : 'disconnected',
		getStatusMessage: () =>
			isIntegrationEnabled()
				? 'Connected to Rinspace tag citations'
				: 'Rinspace integration is disabled',
		getSupportedFileTypes: () => [
			'tex',
			'latex',
			'typ',
			'typst',
			'md',
			'markdown',
			'bib',
			'bibtex',
		],
		getBibliographyEntries: async (
			query?: string,
			_localEntries?: BibEntry[],
			perPage?: number,
		) => {
			if (!isIntegrationEnabled()) {
				throw new Error('Rinspace integration is disabled');
			}
			const normalizedQuery = query?.trim() ?? '';
			if (!normalizedQuery) return [];
			if (Array.from(normalizedQuery).length > MAX_QUERY_LENGTH) {
				throw new Error('Rinspace citation search is limited to 60 characters');
			}
			const limit = Math.max(3, Math.min(24, Math.trunc(perPage ?? 12)));
			const params = new URLSearchParams({
				q: normalizedQuery,
				types: 'tag',
				limit: String(limit),
			});
			const response = await fetcher(`${SEARCH_ENDPOINT}?${params}`, {
				credentials: 'include',
				cache: 'no-store',
				headers: { Accept: 'application/json' },
			});
			if (!response.ok) {
				throw new Error(`Rinspace citation search failed (${response.status})`);
			}
			const payload = record(await response.json());
			const items = payload?.items ?? payload?.list;
			if (!Array.isArray(items)) return [];
			const seen = new Set<string>();
			return items
				.map((item) => citationEntry(item, PUBLIC_ORIGIN, now()))
				.filter((entry): entry is BibEntry => {
					if (!entry || seen.has(entry.key)) return false;
					seen.add(entry.key);
					return true;
				});
		},
	};
}
