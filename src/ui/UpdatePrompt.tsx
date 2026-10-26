import { useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

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
      {phase === 'updating' && (
        <div className="overlay" role="status" aria-live="polite">
          <div className="spinner" />
          <p>Updating IDP Studio…</p>
        </div>
      )}
      <div className="toast" role="alert">
        <span>{phase === 'failed' ? 'Update failed. Try again.' : 'New version available.'}</span>
        <button className="btn primary" disabled={phase === 'updating'} onClick={update}>
          {phase === 'failed' ? 'Retry' : 'Update now'}
        </button>
      </div>
    </>
  );
}
