import { useSyncExternalStore } from 'react';
import { registerSW } from 'virtual:pwa-register';
import { createUpdateController } from './updateController';

export const updates = createUpdateController(options => registerSW(options));
export const useUpdateState = () => useSyncExternalStore(updates.subscribe, updates.getState);
