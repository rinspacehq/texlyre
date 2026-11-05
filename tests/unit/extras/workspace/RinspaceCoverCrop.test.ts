// SPDX-License-Identifier: AGPL-3.0-or-later
import { coverCropRect, coverOutput } from '@extras/workspace/rinspace/RinspaceCoverCropGeometry';

test('uses the same centered crop ratios as the main site for articles and books', () => {
	expect(coverOutput('article')).toEqual({ width: 1600, height: 900, aspect: 16 / 9 });
	expect(coverOutput('book')).toEqual({ width: 900, height: 1350, aspect: 2 / 3 });
	expect(coverCropRect(4000, 3000, 16 / 9, 1, 50, 50)).toEqual({ x: 0, y: 375, width: 4000, height: 2250 });
	expect(coverCropRect(4000, 3000, 2 / 3, 1, 50, 50)).toEqual({ x: 1000, y: 0, width: 2000, height: 3000 });
});

test('keeps keyboard slider positions within the original image', () => {
	expect(coverCropRect(4000, 3000, 16 / 9, 2, 0, 100)).toEqual({ x: 0, y: 1875, width: 2000, height: 1125 });
	expect(() => coverCropRect(4000, 3000, 16 / 9, 4, 50, 50)).toThrow('Invalid cover crop');
});
