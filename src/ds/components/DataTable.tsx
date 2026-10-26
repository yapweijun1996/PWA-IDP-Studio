import { useState, type ReactNode } from 'react';
import { Button } from './Button';
import { Spinner } from './Spinner';
import { Notice } from './Notice';
import { EmptyState } from './EmptyState';

export interface Column<T> {
  key: string;
  label: string;
  render: (row: T) => ReactNode;
  sortValue?: (row: T) => string | number;
}
export interface DataTableProps<T> {
  caption: string;
  columns: readonly Column<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  selectedKey?: string;
  density?: 'normal' | 'compact';
  loading?: boolean;
  error?: string;
  emptyMessage?: string;
}
/** Client-side stable sort; interactive row descendants retain their own activation. */
export function DataTable<T>({
  caption, columns, rows, rowKey, onRowClick, selectedKey,
  density = 'normal', loading, error, emptyMessage = 'No records',
}: DataTableProps<T>) {
  const [sort, setSort] = useState<{ key: string; direction: 'ascending' | 'descending' }>();
  const column = columns.find(item => item.key === sort?.key);
  const sortValue = column?.sortValue;
  const sorted = sortValue ? [...rows].sort((a, b) => {
    const x = sortValue(a);
    const y = sortValue(b);
    const order = typeof x === 'number' && typeof y === 'number'
      ? x - y : String(x).localeCompare(String(y));
    return order * (sort?.direction === 'descending' ? -1 : 1);
  }) : rows;

  return (
    <div className="ds-table-container" role="region" aria-label={caption}
      tabIndex={0} aria-busy={loading || undefined}>
      {loading ? <Spinner label={`Loading ${caption}`} />
        : error ? <Notice tone="error">{error}</Notice>
          : <table className={`ds-table ds-density-${density}`}>
            <caption>{caption}</caption>
            <thead><tr>{columns.map(item => (
              <th key={item.key} scope="col"
                aria-sort={item.sortValue ? sort?.key === item.key ? sort.direction : 'none' : undefined}>
                {item.sortValue ? (
                  <Button variant="ghost" onClick={() => setSort({
                    key: item.key,
                    direction: sort?.key === item.key && sort.direction === 'ascending'
                      ? 'descending' : 'ascending',
                  })}>
                    {item.label}
                    {sort?.key === item.key && (sort.direction === 'ascending' ? ' ↑' : ' ↓')}
                  </Button>
                ) : item.label}
              </th>
            ))}</tr></thead>
            <tbody>{sorted.length ? sorted.map(row => (
              <tr key={rowKey(row)} tabIndex={onRowClick ? 0 : undefined}
                aria-selected={selectedKey === rowKey(row) || undefined}
                className={onRowClick ? 'ds-clickable' : undefined}
                onClick={event => {
                  if (!(event.target as HTMLElement).closest('button,a,input,select,textarea'))
                    onRowClick?.(row);
                }}
                onKeyDown={event => {
                  if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
                    event.preventDefault();
                    onRowClick?.(row);
                  }
                }}>
                {columns.map(item => <td key={item.key}>{item.render(row)}</td>)}
              </tr>
            )) : <tr><td colSpan={columns.length}><EmptyState title={emptyMessage} /></td></tr>}</tbody>
          </table>}
    </div>
  );
}
