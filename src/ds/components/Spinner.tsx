/** Text remains visible when reduced motion stops the decorative spinner. */
export function Spinner({ label = 'Loading' }: { label?: string }) { return <span className="ds-row" role="status"><span className="ds-spinner" aria-hidden="true" />{label}</span>; }
