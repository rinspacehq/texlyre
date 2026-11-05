// SPDX-License-Identifier: AGPL-3.0-or-later
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import RinspaceCoverCrop from '@extras/workspace/rinspace/RinspaceCoverCrop';

jest.mock('@/i18n', () => ({ t: (key: string) => key }));

it('exports the previewed 16:9 rectangle as a bounded JPEG only after confirmation', async () => {
	const drawImage = jest.fn();
	const getContext = jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
	const toBlob = jest.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(new Blob(['cropped'], { type: 'image/jpeg' })));
	try {
		const onUpload = jest.fn(async (_cropped: File) => {});
		const view = render(<RinspaceCoverCrop imageURL='blob:cover-fixture' kind='article' onCancel={jest.fn()} onUpload={onUpload} />);
		const image = await waitFor(() => {
			const element = screen.getByRole('img', { name: 'Cover crop preview' }).querySelector('img');
			if (!element) throw new Error('preview is loading');
			return element;
		});
		Object.defineProperties(image, { naturalWidth: { value: 4000 }, naturalHeight: { value: 3000 } });
		fireEvent.load(image);
		expect(onUpload).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole('button', { name: 'Crop and upload cover' }));
		await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(1));
		expect(drawImage).toHaveBeenCalledWith(image, 0, 375, 4000, 2250, 0, 0, 1600, 900);
		expect(onUpload.mock.calls[0][0]).toMatchObject({ name: 'rinspace-article-cover.jpg', type: 'image/jpeg' });
		view.unmount();
	} finally {
		getContext.mockRestore(); toBlob.mockRestore();
	}
});
