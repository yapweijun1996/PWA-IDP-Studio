import { Button } from './Button';
/** Controlled one-based page; caller supplies page count, not a guessed total. */
export function Pagination({ page, pageCount, onChange }: { page: number; pageCount: number; onChange: (page: number) => void }) { return <nav aria-label="Pagination" className="ds-row"><Button disabled={page <= 1 || pageCount === 0} onClick={() => onChange(page - 1)}>Previous</Button><span role="status">Page {pageCount ? page : 0} of {pageCount}</span><Button disabled={page >= pageCount || pageCount === 0} onClick={() => onChange(page + 1)}>Next</Button></nav>; }
