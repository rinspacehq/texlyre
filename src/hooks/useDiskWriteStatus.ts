// SPDX-License-Identifier: AGPL-3.0-or-later
import { useSyncExternalStore } from 'react';
import { fileHandlerService } from '../services/FileHandlerService';

const subscribe = (notify: () => void) => fileHandlerService.addWriteStatusListener(notify);
const getSnapshot = () => fileHandlerService.getWriteStatus();

export const useDiskWriteStatus = () => useSyncExternalStore(subscribe, getSnapshot);
