// SPDX-License-Identifier: AGPL-3.0-or-later
import { applyDesktopViewport, requestResponsiveViewport } from '@src/utils/viewportUtils';

it('keeps a host responsive across later theme viewport changes', () => {
	const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]') ?? document.createElement('meta');
	meta.setAttribute('name', 'viewport');
	if (!meta.isConnected) document.head.appendChild(meta);
	try {
		requestResponsiveViewport(true);
		applyDesktopViewport();
		expect(meta.content).toContain('width=device-width');
		requestResponsiveViewport(false);
		expect(meta.content).toContain('width=1200');
	} finally {
		requestResponsiveViewport(false);
	}
});
