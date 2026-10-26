import { Input } from './Input';
import { IconButton } from './IconButton';
/** Controlled search; clear remains keyboard reachable. */
export function SearchInput({ value, onChange, label = 'Search', placeholder }: { value: string; onChange: (value: string) => void; label?: string; placeholder?: string }) { return <div className="ds-search"><Input type="search" aria-label={label} placeholder={placeholder} value={value} onChange={event => onChange(event.target.value)} />{value && <IconButton icon="close" label={`Clear ${label.toLowerCase()}`} onClick={() => onChange('')} />}</div>; }
