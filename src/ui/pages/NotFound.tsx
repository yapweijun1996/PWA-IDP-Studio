import { useEffect, useRef } from 'react';
import { Button, PageHeader } from '../../ds';
import { updates } from '../updates';
import { go } from '../useHash';

export function NotFound() {
  const checked = useRef(false);
  useEffect(() => {
    if (checked.current) return;
    checked.current = true;
    updates.start();
    void updates.check({ silent: true });
  }, []);
  return <><PageHeader title="Page not found" /><p>This address does not match a page. Return Home or browse your documents.</p><div className="ds-row"><Button variant="primary" onClick={() => go('#/')}>Go to Home</Button><Button onClick={() => go('#/documents')}>Documents</Button></div></>;
}
