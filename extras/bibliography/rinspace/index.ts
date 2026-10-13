// SPDX-License-Identifier: AGPL-3.0-or-later
import { rinspaceManagedWorkspaceRuntime } from '@/plugins/workspace/rinspace/RinspaceWorkspacePlugin';

import { createRinspaceBibliographyPlugin } from './RinspaceBibliographyPlugin';

const rinspaceBibliographyPlugin = createRinspaceBibliographyPlugin(() =>
	rinspaceManagedWorkspaceRuntime.isEnabled(),
);

export * from './RinspaceBibliographyPlugin';
export default rinspaceBibliographyPlugin;
