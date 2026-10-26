import { useEffect, useState } from 'react';
import { Badge } from './Badge';
/** Reports browser connectivity, not remote service availability. */
export function useOnlineStatus() {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}
export function OnlineStatus() {
  const online = useOnlineStatus();
  return <span role="status"><Badge tone={online ? 'success' : 'warning'} icon={online ? 'check' : 'alert'}>{online ? 'Online' : 'Offline'}</Badge></span>;
}
