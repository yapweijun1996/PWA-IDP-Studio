import { useEffect, useRef, useState } from 'react';
import { Button } from './Button';
import { Field } from './Field';
import { Input } from './Input';
import { copyJSONText, serializeJSON } from '../../lib/jsonExport';
import { Icon } from '../../ui/Icon';

const escape = (key: string) => key.replaceAll('~', '~0').replaceAll('/', '~1');
const container = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object';
interface Node { path: string; value: unknown; label: string; parent: string | null; depth: number }
export function JsonTree({ value, onFocus, expandTopLevel = false }: { value: unknown; onFocus?: (pointer: string, value: unknown) => void; expandTopLevel?: boolean }) {
  const [expanded, setExpanded] = useState(() => {
    const paths = new Set(['']);
    if (expandTopLevel && container(value)) {
      const keys = Array.isArray(value) ? value.keys() : Object.keys(value);
      let count = 0;
      for (const key of keys) {
        if (count++ >= 100) break;
        if (container(value[String(key)])) paths.add(`/${escape(String(key))}`);
      }
    }
    return paths;
  });
  const [limits, setLimits] = useState<Record<string, number>>({});
  const [starts, setStarts] = useState<Record<string, number>>({});
  const [focused, setFocused] = useState('');
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<Node[]>([]);
  const [index, setIndex] = useState(-1);
  const [searching, setSearching] = useState(false);
  const [status, setStatus] = useState('');
  const [manualCopy, setManualCopy] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let cancelled = false; let timer: number;
    setMatches([]); setIndex(-1);
    if (!query.trim()) { setSearching(false); setStarts({}); setLimits({}); return; }
    setSearching(true);
    timer = window.setTimeout(() => {
      const found: Node[] = []; const needle = query.toLowerCase();
      // Iterators avoid eagerly allocating an entry for every array element.
      const walk = function* (): Generator<Node> {
        const stack: { iterator: Iterator<string | number>; value: Record<string, unknown>; path: string; depth: number }[] = [];
        let node: Node | undefined = { path: '', value, label: '$', parent: null, depth: 1 };
        while (node || stack.length) {
          if (node) { yield node; if (container(node.value)) stack.push({ iterator: Array.isArray(node.value) ? node.value.keys() : Object.keys(node.value).values(), value: node.value, path: node.path, depth: node.depth }); node = undefined; }
          const frame = stack[stack.length - 1]; if (!frame) break;
          const next = frame.iterator.next(); if (next.done) { stack.pop(); continue; }
          const key = String(next.value); node = { path: `${frame.path}/${escape(key)}`, value: frame.value[key], label: key, parent: frame.path, depth: frame.depth + 1 };
        }
      };
      const iterator = walk();
      const chunk = () => {
        if (cancelled) return;
        for (let n = 0; n < 500; n++) {
          const next = iterator.next();
          if (next.done) { setMatches(found); setSearching(false); return; }
          const node = next.value;
          if (node.label.toLowerCase().includes(needle) || (!container(node.value) && String(node.value).toLowerCase().includes(needle))) found.push(node);
        }
        timer = window.setTimeout(chunk, 0);
      }; chunk();
    }, 200);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, value]);
  const visible: Node[] = [];
  const visit = (node: Node) => {
    visible.push(node);
    if (!container(node.value) || !expanded.has(node.path)) return;
    const array = Array.isArray(node.value) ? node.value : null;
    const keys = array ? null : Object.keys(node.value);
    const count = Math.min(limits[node.path] ?? 100, array ? array.length : keys!.length);
    for (let i = starts[node.path] ?? 0; i < count; i++) {
      const key = keys ? keys[i] : String(i);
      visit({ path: `${node.path}/${escape(key)}`, value: node.value[key], label: key, parent: node.path, depth: node.depth + 1 });
    }
  };
  visit({ path: '', value, label: '$', parent: null, depth: 1 });
  const selected = visible.find(n => n.path === focused) ?? visible[0];
  const focus = (node: Node) => {
    setFocused(node.path); onFocus?.(node.path, node.value);
    requestAnimationFrame(() => [...(root.current?.querySelectorAll<HTMLElement>('[data-pointer]') ?? [])].find(row => row.dataset.pointer === node.path)?.focus());
  };
  const toggle = (path: string) => setExpanded(old => { const next = new Set(old); if (next.has(path)) next.delete(path); else next.add(path); return next; });
  const match = (direction: number) => {
    if (!matches.length) return;
    const next = index < 0 ? direction > 0 ? 0 : matches.length - 1 : (index + direction + matches.length) % matches.length; setIndex(next);
    const node = matches[next]; const parts = node.path.split('/');
    setExpanded(old => { const result = new Set(old); for (let i = 1; i < parts.length; i++) result.add(parts.slice(0, i).join('/')); return result; });
    const nextStarts: Record<string, number> = {}; const nextLimits: Record<string, number> = {}; let current = value;
    for (let i = 1; i < parts.length; i++) {
      const key = parts[i].replaceAll('~1', '/').replaceAll('~0', '~'); const parent = parts.slice(0, i).join('/');
      if (container(current)) { const position = Array.isArray(current) ? Number(key) : Object.keys(current).indexOf(key); const start = Math.floor(position / 100) * 100; nextStarts[parent] = start; nextLimits[parent] = start + 100; current = current[key]; }
    }
    setStarts(nextStarts); setLimits(nextLimits);
    focus(node);
  };
  const copy = async (text: string, label: string) => {
    setManualCopy(null); setStatus(`Copying ${label.toLowerCase()}…`);
    try { await copyJSONText(text); setStatus(`${label} copied.`); }
    catch { setManualCopy(text); setStatus(`${label} copy unavailable. Select the text below and copy manually.`); }
  };
  return <div className="ds-sheet ds-json-tree"><Field label="Search JSON"><Input value={query} onChange={e => setQuery(e.target.value)} /></Field><div className="ds-row"><span role="status">{searching ? 'Searching…' : `${matches.length} matches`}{index >= 0 ? ` · Match ${index + 1}` : ''}</span><Button disabled={!matches.length} onClick={() => match(-1)}>Previous match</Button><Button disabled={!matches.length} onClick={() => match(1)}>Next match</Button></div>
    <div className="ds-row"><span className="ds-json-pointer">JSON Pointer: {selected.path || '(root)'}</span><Button onClick={() => void copy(selected.path, 'Pointer')}>Copy pointer</Button><Button onClick={() => void copy(serializeJSON(selected.value), 'Value')}>Copy value</Button></div><p role="status">{status}</p>
    {manualCopy !== null && <pre aria-label="Manual copy" className="ds-json" tabIndex={0}>{manualCopy}</pre>}
    <div role="tree" aria-label="JSON tree" ref={root}>{visible.map((node, position) => {
      const branch = container(node.value); const keys = Array.isArray(node.value) ? node.value : container(node.value) ? Object.keys(node.value) : []; const open = expanded.has(node.path);
      return <div key={node.path}><div role="treeitem" aria-level={node.depth} aria-expanded={branch ? open : undefined} aria-label={node.path || 'Root'} data-pointer={node.path} tabIndex={selected.path === node.path ? 0 : -1} className="ds-json-node" style={{ paddingInlineStart: `calc(var(--space-3) * ${node.depth - 1} + var(--space-2))` }} onFocus={() => { setFocused(node.path); onFocus?.(node.path, node.value); }} onClick={() => { focus(node); if (branch) toggle(node.path); }} onKeyDown={e => {
        if (!['ArrowDown','ArrowUp','ArrowLeft','ArrowRight','Enter','Home','End'].includes(e.key)) return; e.preventDefault();
        if (e.key === 'Enter' && branch) toggle(node.path);
        if (e.key === 'ArrowRight' && branch) { if (!open) toggle(node.path); else if (visible[position + 1]?.parent === node.path) focus(visible[position + 1]); }
        if (e.key === 'ArrowLeft') { if (branch && open) toggle(node.path); else { const parent = visible.find(n => n.path === node.parent); if (parent) focus(parent); } }
        if (e.key === 'ArrowDown') focus(visible[Math.min(position + 1, visible.length - 1)]);
        if (e.key === 'ArrowUp') focus(visible[Math.max(position - 1, 0)]);
        if (e.key === 'Home') focus(visible[0]); if (e.key === 'End') focus(visible[visible.length - 1]);
      }}><span>{branch && <Icon name={open ? 'chevron-down' : 'chevron-right'} size="sm" />}{node.label}: </span><span className={branch ? 'ds-muted' : node.value === null ? 'ds-json-null' : `ds-json-${typeof node.value}`}>{branch ? `${Array.isArray(node.value) ? 'Array' : 'Object'} (${keys.length})` : serializeJSON(node.value)}</span></div>{branch && open && keys.length > (limits[node.path] ?? 100) && <Button aria-label={`Show next 100 at ${node.path || 'root'}`} onClick={() => setLimits(old => ({ ...old, [node.path]: (old[node.path] ?? 100) + 100 }))}>Show next 100</Button>}</div>;
    })}</div></div>;
}
