// SPDX-License-Identifier: AGPL-3.0-or-later
import { load } from 'js-yaml';

import type { ManagedBuildState } from '@/types/projects';

const ROOT_FIELDS = [
	'type', 'status', 'sourceVisibility', 'title', 'excerpt', 'cover',
	'tags', 'tag', 'entry', 'build', 'metadata',
] as const;
const BUILD_FIELDS = ['format'] as const;
const METADATA_FIELDS = ['rinspacePostId', 'rinspaceTagId', 'templateVersion'] as const;
const TAGS_FIELDS = ['primary'] as const;
const TAG_FIELDS = ['displayName', 'usageExcerpt', 'parentTags'] as const;

type RecordValue = Record<string, unknown>;
type ProjectKind = 'article' | 'book' | 'tag-wiki' | 'pdf';

const PROJECTS: Record<string, { kind: ProjectKind; manifestType: string }> = {
	a: { kind: 'article', manifestType: 'blog' },
	b: { kind: 'book', manifestType: 'book' },
	tags: { kind: 'tag-wiki', manifestType: 'tag-wiki' },
	pdf: { kind: 'pdf', manifestType: 'pdf' },
};

function record(value: unknown, label: string): RecordValue {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`${label} must be a mapping`);
	}
	return value as RecordValue;
}

function knownFields(
	value: RecordValue,
	allowed: readonly string[],
	label: string,
): void {
	const unknown = Object.keys(value).find((key) => !allowed.includes(key));
	if (unknown) throw new Error(`${label}.${unknown} is not part of the Rinspace manifest contract`);
}

function string(value: unknown, label: string, required = true): string {
	if (value === undefined && !required) return '';
	if (typeof value !== 'string' || (required && !value)) {
		throw new Error(`${label} must be a non-empty string`);
	}
	return value;
}

function canonicalPath(value: unknown, label: string): string {
	const path = string(value, label);
	if (
		path.length > 1024 ||
		path.startsWith('/') ||
		path.endsWith('/') ||
		path.includes('\\') ||
		path.includes('\0') ||
		path.includes('//')
	) {
		throw new Error(`${label} must be a canonical repository-relative path`);
	}
	const segments = path.split('/');
	if (segments.some((part) => part === '.' || part === '..' || part.toLowerCase() === '.git')) {
		throw new Error(`${label} contains an unsafe path segment`);
	}
	return path;
}

function optionalText(value: unknown, label: string, limit: number): string {
	const text = string(value, label, false);
	if (text !== text.trim() || Array.from(text).length > limit || text.includes('\0')) {
		throw new Error(`${label} is not canonical or exceeds ${limit} characters`);
	}
	return text;
}

function stringArray(value: unknown, label: string): string[] {
	if (value === undefined) return [];
	if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
		throw new Error(`${label} must be a string list`);
	}
	return value as string[];
}

function validatePresentation(root: RecordValue, project: ProjectKind): void {
	const visibility = string(root.sourceVisibility, 'sourceVisibility', false);
	if (visibility && visibility !== 'open' && visibility !== 'private') {
		throw new Error('sourceVisibility must be open or private');
	}
	if (project === 'tag-wiki' && visibility && visibility !== 'open') {
		throw new Error('Tag manifest sourceVisibility must be open');
	}
	optionalText(root.title, 'title', 220);
	optionalText(root.excerpt, 'excerpt', 240);

	if (root.tags !== undefined) {
		const tags = record(root.tags, 'tags');
		knownFields(tags, TAGS_FIELDS, 'tags');
		const primary = stringArray(tags.primary, 'tags.primary');
		if (primary.length > 6 || new Set(primary).size !== primary.length) {
			throw new Error('tags.primary must contain at most six unique tags');
		}
		const pattern = /^[a-z0-9\p{Script=Han}]+(?:-[a-z0-9\p{Script=Han}]+)*$/u;
		if (primary.some((tag) => !pattern.test(tag))) {
			throw new Error('tags.primary contains a non-canonical tag');
		}
	}

	if (root.tag !== undefined) {
		const tag = record(root.tag, 'tag');
		knownFields(tag, TAG_FIELDS, 'tag');
		optionalText(tag.displayName, 'tag.displayName', 220);
		optionalText(tag.usageExcerpt, 'tag.usageExcerpt', 240);
		const parents = stringArray(tag.parentTags, 'tag.parentTags');
		if (parents.length > 12 || new Set(parents).size !== parents.length) {
			throw new Error('tag.parentTags must contain at most twelve unique Tags');
		}
		if (parents.some((parent) => !/^tags\/[1-9][0-9]*$/.test(parent))) {
			throw new Error('tag.parentTags contains a non-canonical Tag coordinate');
		}
	}
}

export function invalidManagedBuild(message: string): ManagedBuildState {
	return { authority: 'rinspace.yaml', status: 'invalid', message };
}

export function parseRinspaceManifest(
	content: string,
	owner: string,
	repository: string,
	filePaths: ReadonlySet<string>,
): ManagedBuildState {
	try {
		const project = PROJECTS[owner];
		if (!project || !/^[1-9][0-9]*$/.test(repository)) {
			throw new Error('repository coordinate is not a managed Rinspace project');
		}
		const root = record(load(content), 'rinspace.yaml');
		knownFields(root, ROOT_FIELDS, 'rinspace.yaml');
		if (string(root.type, 'type') !== project.manifestType) {
			throw new Error(`type does not match the ${project.kind} repository`);
		}
		const status = string(root.status, 'status');
		if (status !== 'draft' && status !== 'published') {
			throw new Error('status must be draft or published');
		}
		validatePresentation(root, project.kind);

		const build = record(root.build, 'build');
		knownFields(build, BUILD_FIELDS, 'build');
		const format = string(build.format, 'build.format');
		if (!['markdown', 'latex', 'typst', 'pdf'].includes(format)) {
			throw new Error(`build.format ${format} is not supported`);
		}
		if (project.kind === 'pdf' ? format !== 'pdf' : format === 'pdf') {
			throw new Error(`build.format ${format} does not match the ${project.kind} repository`);
		}
		if (format === 'typst' && project.kind !== 'article' && project.kind !== 'book') {
			throw new Error('Typst is supported only for blog and book repositories');
		}

		const entry = canonicalPath(root.entry, 'entry');
		const extension = entry.slice(entry.lastIndexOf('.')).toLowerCase();
		const extensions: Record<string, readonly string[]> = {
			markdown: ['.md', '.markdown'],
			latex: ['.tex', '.ltx', '.latex'],
			typst: ['.typ'],
			pdf: ['.pdf'],
		};
		if (!extensions[format].includes(extension)) {
			throw new Error(`entry extension does not match build.format ${format}`);
		}
		if (!filePaths.has(`/${entry}`)) throw new Error(`entry ${entry} does not exist`);

		const cover = string(root.cover, 'cover', false);
		if (cover) {
			const coverPath = canonicalPath(cover, 'cover');
			if (!/\.(?:png|jpe?g|webp|gif)$/i.test(coverPath)) {
				throw new Error('cover must use png, jpg, jpeg, webp, or gif');
			}
			if (!filePaths.has(`/${coverPath}`)) throw new Error(`cover ${coverPath} does not exist`);
		}

		const metadata = record(root.metadata, 'metadata');
		knownFields(metadata, METADATA_FIELDS, 'metadata');
		const postId = string(metadata.rinspacePostId, 'metadata.rinspacePostId', false);
		const tagId = string(metadata.rinspaceTagId, 'metadata.rinspaceTagId', false);
		const template = string(metadata.templateVersion, 'metadata.templateVersion', false);
		if (project.kind === 'tag-wiki') {
			const legacy = !tagId && postId === repository;
			if (tagId !== repository && !legacy) {
				throw new Error('metadata.rinspaceTagId does not match the Tag object ID');
			}
			if (!legacy && !template) throw new Error('metadata.templateVersion is required for Tags');
			const parents = root.tag === undefined
				? []
				: stringArray(record(root.tag, 'tag').parentTags, 'tag.parentTags');
			if (parents.includes(`tags/${repository}`)) throw new Error('Tag cannot be its own parent');
		} else if (postId !== repository) {
			throw new Error('metadata.rinspacePostId does not match the project object ID');
		}

		return {
			authority: 'rinspace.yaml',
			status: 'valid',
			format: format as 'markdown' | 'latex' | 'typst' | 'pdf',
			entry,
		};
	} catch (error) {
		return invalidManagedBuild(
			error instanceof Error ? error.message : 'rinspace.yaml is invalid',
		);
	}
}
