import { useEffect, useState } from 'react';
import type { Batch } from '../../contract/types';
import type { Settings } from '../../lib/settings';
import { Button, Card, Checkbox, EmptyState, Field, Input, Notice, PageHeader, Select, Toast } from '../../ds';
import { clampAgentConfig, loadAgentConfig, OPTIONAL_TOOLS, saveAgentConfig, type AgentConfig } from '../../lib/agentConfig';
import { extractionToolCatalog } from '../../lib/agent/tools';
import { imageLimits, PROVIDERS } from '../../lib/providers';
import { listRuns, type RunTrace } from '../../lib/db';

export interface StudioPageProps { docs: Batch[]; settings: Settings; loading?: boolean; refresh: () => Promise<void> }
const catalog = extractionToolCatalog();
export function AiAgents({ settings, loading }: StudioPageProps) {
  const [config, setConfig] = useState(() => loadAgentConfig(settings.provider));
  const [runs, setRuns] = useState<RunTrace[]>([]);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [outcome, setOutcome] = useState('all');
  const [selected, setSelected] = useState<string>();
  useEffect(() => { setConfig(loadAgentConfig(settings.provider)); }, [settings.provider]);
  useEffect(() => {
    let active = true;
    listRuns().then(rows => { if (active) setRuns(rows); }).catch(e => { if (active) setError(String(e)); }).finally(() => { if (active) setPending(false); });
    return () => { active = false; };
  }, []);
  const change = (patch: Partial<AgentConfig>) => { setConfig(clampAgentConfig({ ...config, ...patch }, settings.provider)); setSaved(''); };
  const save = (value: AgentConfig, message: string) => {
    try { setConfig(saveAgentConfig(value, settings.provider)); setSaved(message); setError(''); } catch (e) { setError(String(e)); }
  };
  const limits = imageLimits(settings.provider);
  const visible = runs.filter(run => outcome === 'all' || run.outcome === outcome);
  const detail = visible.find(run => run.id === selected);
  return <section className="ds-sheet">
    <PageHeader title="AI Agents" breadcrumb={<><a href="#/">Home</a> / AI Agents</>} description="Configure bounded extraction tools and inspect local run history. Traces never contain page images or extracted values." />
    {error && <Notice tone="error">{error}</Notice>}
    <Card><h2>Agent configuration</h2>
      <Field label="Maximum model turns"><Input type="number" min={1} max={16} value={config.maxTurns} onChange={e => change({ maxTurns: Number(e.target.value) })} /></Field>
      <Field label="Agent loop timeout (seconds)"><Input type="number" min={30} max={300} value={config.timeoutSeconds} onChange={e => change({ timeoutSeconds: Number(e.target.value) })} /></Field>
      <Field label="Extra tool images" hint={`Shared rendering budget; provider cap ${limits.toolImages}.`}><Input type="number" min={1} max={limits.toolImages} value={config.toolImages} onChange={e => change({ toolImages: Number(e.target.value) })} /></Field>
      <Field label="Boundary confidence threshold"><Input type="number" min={0.5} max={0.95} step={0.05} value={config.boundaryConfidence} onChange={e => change({ boundaryConfidence: Number(e.target.value) })} /></Field>
      {OPTIONAL_TOOLS.map(name => <Checkbox key={name} label={name} checked={config.tools[name]} onChange={e => change({ tools: { ...config.tools, [name]: e.target.checked } })} />)}
      <div className="ds-row"><Button variant="primary" onClick={() => save(config, 'Agent configuration saved.')}>Save agent configuration</Button><Button onClick={() => save(clampAgentConfig(null, settings.provider), 'Agent defaults restored.')}>Reset to defaults</Button></div>
    </Card>
    <Card><h2>Tool catalog</h2>{catalog.map(tool => <section key={tool.name}><h3>{tool.name} · {OPTIONAL_TOOLS.includes(tool.name as typeof OPTIONAL_TOOLS[number]) && !config.tools[tool.name as typeof OPTIONAL_TOOLS[number]] ? 'Disabled' : 'Enabled'}</h3><p>{tool.description}</p><p>Image-producing operations share the {config.toolImages}-image budget. Parameter limits are shown below.</p><dl>{Object.entries(tool.parameters.properties ?? {}).map(([name, schema]) => <div key={name}><dt>{name}</dt><dd>{JSON.stringify(schema)}</dd></div>)}</dl></section>)}</Card>
    <Card><h2>Provider limits</h2>{PROVIDERS.map(provider => { const cap = imageLimits(provider.id); return <div key={provider.id}><h3>{provider.label}</h3><p>Images/request: {Number.isFinite(cap.requestImages) ? cap.requestImages : 'No app cap'} · Window: {cap.window} · Extraction pages: {cap.extractPages} · Tool images: {cap.toolImages}</p></div>; })}<Notice>Demo gateway: 4 images/request, 20 requests/token with automatic renewal. Reasoning items are never replayed.</Notice></Card>
    <Card><h2>Run history</h2><Field label="Outcome filter"><Select value={outcome} onChange={e => { setOutcome(e.target.value); setSelected(undefined); }}>{['all', 'validated', 'review_required', 'failed', 'cancelled'].map(value => <option key={value} value={value}>{value}</option>)}</Select></Field>
      {(pending || loading) ? <Notice>Loading runs…</Notice> : visible.length ? <ul>{visible.map(run => <li key={run.id}><Button onClick={() => setSelected(run.id)}>{run.filename} · {run.outcome}</Button><span> {new Date(run.started).toLocaleString()} · {run.provider}/{run.model} · {run.mode}</span></li>)}</ul> : <EmptyState title="No runs" description="Completed extraction attempts appear here. Change the outcome filter to see other runs." />}
      {detail && <section aria-label="Run details"><h3>{detail.filename}</h3><p>{detail.outcome} · {new Date(detail.started).toLocaleString()} – {new Date(detail.ended).toLocaleString()}</p><p>Segmentation windows: {detail.segmentationWindows} · Documents extracted: {detail.documentsExtracted} · Failed: {detail.documentsFailed}</p><a href={`#/doc/${encodeURIComponent(detail.batchId)}`}>Open document</a>{detail.error && <Notice tone="error">{detail.error}</Notice>}<ol aria-label="Step timeline">{detail.steps.map((step, i) => <li key={i}>{new Date(step.at).toLocaleTimeString()} · {step.tool} · {step.ok ? 'OK' : 'Failed'} · {step.summary}</li>)}</ol><Button onClick={() => setSelected(undefined)}>Close details</Button></section>}
    </Card>
    {saved && <Toast>{saved}</Toast>}
  </section>;
}
