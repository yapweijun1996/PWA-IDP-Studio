import { useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { Button, Spinner, Toast } from '../ds';

type Phase = 'idle' | 'updating' | 'failed';

export function UpdatePrompt() {
  const [phase, setPhase] = useState<Phase>('idle');
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  if (!needRefresh) return null;

  const update = async () => {
    setPhase('updating');
    try {
      await updateServiceWorker(true); // activates the waiting worker, then reloads
    } catch {
      setPhase('failed');
    }
  };

  return (
    <>
      <Toast>
        {phase === 'updating' && <Spinner label="Updating IDP Studio…" />}
        <span>{phase === 'failed' ? 'Update failed. Try again.' : 'New version available.'}</span>
        <Button variant="primary" loading={phase === 'updating'} onClick={update}>
          {phase === 'failed' ? 'Retry' : 'Update now'}
        </Button>
      </Toast>
    </>
  );
}
