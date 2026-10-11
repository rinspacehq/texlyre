// SPDX-License-Identifier: AGPL-3.0-or-later
import config from '../../texlyre.config';
import { resolveStartupIntent } from './StartupPolicy';

export function getStartupIntent() {
	return resolveStartupIntent(window.location.search, config.startup?.profile === 'persistent-local');
}
