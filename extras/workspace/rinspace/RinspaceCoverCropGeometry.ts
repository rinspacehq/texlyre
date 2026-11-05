// SPDX-License-Identifier: AGPL-3.0-or-later
import type { ProjectKind } from './RinspaceProjectCreation';

export const MAX_COVER_INPUT_BYTES = 20 * 1024 * 1024;
export const MAX_COVER_OUTPUT_BYTES = 10 * 1024 * 1024;
export const MAX_COVER_PIXELS = 32_000_000;

export function coverOutput(kind: ProjectKind): { width: number; height: number; aspect: number } {
	const width = kind === 'article' ? 1600 : 900;
	const height = kind === 'article' ? 900 : 1350;
	return { width, height, aspect: width / height };
}

export interface CoverCropRect { x: number; y: number; width: number; height: number }

/** A normalized crop uses the same rectangle in preview and canvas export. */
export function coverCropRect(
	imageWidth: number, imageHeight: number, aspect: number,
	zoom: number, horizontal: number, vertical: number,
): CoverCropRect {
	if (![imageWidth, imageHeight, aspect, zoom, horizontal, vertical].every(Number.isFinite) ||
		imageWidth <= 0 || imageHeight <= 0 || aspect <= 0 || zoom < 1 || zoom > 3 ||
		horizontal < 0 || horizontal > 100 || vertical < 0 || vertical > 100) {
		throw new Error('Invalid cover crop');
	}
	const baseWidth = Math.min(imageWidth, imageHeight * aspect);
	const width = baseWidth / zoom;
	const height = width / aspect;
	return {
		x: (imageWidth - width) * horizontal / 100,
		y: (imageHeight - height) * vertical / 100,
		width, height,
	};
}
