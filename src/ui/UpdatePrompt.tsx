import { useEffect } from 'react';
import { Button, Spinner, Toast } from '../ds';
import { updates, useUpdateState } from './updates';

export function UpdatePrompt() {
  const state = useUpdateState();
  useEffect(() => { updates.start(); }, []);
  const failed = state.phase === 'failed' && state.message.startsWith('Update failed');
  if (state.phase !== 'available' && state.phase !== 'updating' && !failed) return null;
  const updating = state.phase === 'updating';
  return (
    <Toast>
      {updating && <Spinner label="Updating IDP Studio…" />}
      <span>{failed ? 'Update failed. Try again.' : 'A newer version is available'}</span>
      <Button variant="primary" loading={updating} onClick={() => void updates.apply()}>{failed ? 'Retry' : 'Update now'}</Button>
    </Toast>
  );
}
