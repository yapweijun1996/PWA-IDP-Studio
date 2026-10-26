/** Omit value for indeterminate progress; max defaults to 100. */
export function Progress({ label, value, max = 100 }: { label: string; value?: number; max?: number }) { return <label className="ds-field">{label}<progress aria-label={label} value={value} max={max} /></label>; }
