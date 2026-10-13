// SPDX-License-Identifier: AGPL-3.0-or-later
import { act, renderHook, waitFor } from '@testing-library/react';
import { useEditorOutput } from '@src/hooks/editor/useEditorOutput';
import { typesetterRegistryService } from '@src/services/TypesetterRegistryService';
import type { Project } from '@src/types/projects';

jest.mock('@src/i18n', () => ({ t: (key: string) => key }));
jest.mock('@src/hooks/useAuth', () => ({
	useAuth: () => ({ getProjectById: mockGetProjectById }),
}));
jest.mock('@src/hooks/useSettings', () => ({
	useSettings: () => ({ getSetting: () => undefined }),
}));

const project: Project = {
	id: 'local-output-fixture', name: '中文混合目录', description: '',
	type: 'files', group: 'files', docUrl: '',
	createdAt: 1, updatedAt: 1, ownerId: 'local-fixture',
	tags: [], isFavorite: false,
};
const mockGetProjectById = jest.fn<Promise<Project | null>, [string]>();

describe('upstream output selection for a neutral local project', () => {
	beforeEach(() => {
		mockGetProjectById.mockReset().mockResolvedValue(project);
		sessionStorage.setItem('currentProjectId', project.id);
		typesetterRegistryService.registerBuiltins();
	});
	afterEach(() => sessionStorage.removeItem('currentProjectId'));

	it('keeps LaTeX and Typst available when switching files without changing project metadata', async () => {
		const { result } = renderHook(() => useEditorOutput());
		await waitFor(() => expect(result.current.projectType).toBe('files'));
		act(() => result.current.setOutputForFileName('章节/main.tex'));
		expect(result.current.showLatexOutput).toBe(true);
		expect(result.current.showTypstOutput).toBe(false);
		act(() => result.current.setOutputForFileName('章节/文档.TYP'));
		expect(result.current.showLatexOutput).toBe(false);
		expect(result.current.showTypstOutput).toBe(true);
		expect(result.current.activeExternalProvider).toBeNull();
		expect(result.current.projectType).toBe('files');
		expect(mockGetProjectById).toHaveBeenCalledWith(project.id);
	});

	it.each([undefined, 'README.md', '图片.png', 'refs.bib'])(
		'does not invent a typesetter target for %s', async (name) => {
			const { result } = renderHook(() => useEditorOutput());
			await waitFor(() => expect(result.current.projectType).toBe('files'));
			act(() => result.current.setOutputForFileName(name));
			expect(result.current.showLatexOutput).toBe(false);
			expect(result.current.showTypstOutput).toBe(false);
			expect(result.current.activeExternalProvider).toBeNull();
		},
	);

	it('re-resolves the already open file after neutral project metadata loads', async () => {
		let resolveProject!: (value: Project | null) => void;
		mockGetProjectById.mockReturnValue(
			new Promise((resolve) => {
				resolveProject = resolve;
			}),
		);
		const { result } = renderHook(() => useEditorOutput());
		act(() => result.current.setOutputForFileName('README.md'));
		act(() => resolveProject(project));

		await waitFor(() => expect(result.current.projectType).toBe('files'));
		expect(result.current.showLatexOutput).toBe(false);
		expect(result.current.showTypstOutput).toBe(false);
	});

	it('preserves the existing provider and metadata-update behavior for typed projects', async () => {
		const { result } = renderHook(() => useEditorOutput());
		await waitFor(() => expect(result.current.projectType).toBe('files'));
		mockGetProjectById.mockResolvedValue({
			...project, type: 'typst', compilerId: 'internal:typst',
		});
		act(() => document.dispatchEvent(new Event('project-metadata-updated')));
		await waitFor(() => expect(result.current.projectType).toBe('typst'));
		act(() => result.current.setOutputForFileName('main.typ'));
		expect(result.current.showTypstOutput).toBe(true);
		act(() => result.current.setOutputForFileName('main.tex'));
		expect(result.current.showLatexOutput).toBe(true);
		expect(result.current.showTypstOutput).toBe(false);
	});
});
