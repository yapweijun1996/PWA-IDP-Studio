import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export const profiles = { desktop: { width: 1440, height: 900 }, tablet: { width: 768, height: 1024 }, phone: { width: 390, height: 844 } };
export class TransportError extends Error { constructor(message) { super(message); this.transport = true; } }
export async function until(fn, label, timeout = 20000) {
  const end = Date.now() + timeout;
  do { const result = await fn(); if (result) return result; await delay(50); } while (Date.now() < end);
  throw new Error(`Timed out: ${label}`);
}
export async function launchBrowser({ profile = 'desktop' } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'idp-e2e-'));
  const child = spawn(process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${dir}`, '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-default-apps', '--disable-extensions', '--no-proxy-server', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let startupError; let stderr = '';
  child.on('error', e => { startupError = e; });
  child.stderr.on('data', data => { stderr = (stderr + data).slice(-4000); });
  let socket;
  const close = async () => {
    socket?.close();
    if (child.exitCode === null && !startupError) {
      const exited = new Promise(resolve => child.once('exit', resolve));
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
      await exited; clearTimeout(timer);
    }
    await rm(dir, { recursive: true, force: true });
  };
  try {
    const port = await until(async () => {
      if (startupError) throw new Error(`Chrome launch: ${startupError.message}`);
      if (child.exitCode !== null) throw new Error(`Chrome exited ${child.exitCode}: ${stderr}`);
      try { return Number((await readFile(join(dir, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); } catch { return false; }
    }, 'Chrome DevToolsActivePort', 20000);
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const target = targets.find(t => t.type === 'page');
    if (!target) throw new TransportError('Chrome has no page target');
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new TransportError('CDP connect timeout')), 10000);
      socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener('error', () => { clearTimeout(timer); reject(new TransportError('CDP connect failed')); }, { once: true });
    });
    let id = 0; const pending = new Map(); const listeners = new Map();
    const logs = []; const errors = [];
    const failPending = () => { for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new TransportError('CDP disconnected')); } pending.clear(); };
    socket.addEventListener('close', failPending);
    socket.addEventListener('error', failPending);
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const p = pending.get(message.id); if (!p) return; pending.delete(message.id); clearTimeout(p.timer);
        if (message.error) p.reject(new Error(`${p.method}: ${message.error.message}`)); else p.resolve(message.result);
      } else for (const fn of listeners.get(message.method) || []) Promise.resolve().then(() => fn(message.params)).catch(e => errors.push(`CDP event handler: ${e.message}`));
    });
    const command = (method, params = {}) => new Promise((resolve, reject) => {
      if (socket.readyState !== WebSocket.OPEN) return reject(new TransportError('CDP socket not open'));
      const next = ++id; const timer = setTimeout(() => { pending.delete(next); reject(new TransportError(`CDP timeout: ${method}`)); }, 30000);
      pending.set(next, { resolve, reject, timer, method }); socket.send(JSON.stringify({ id: next, method, params }));
    });
    await command('Emulation.setFocusEmulationEnabled', { enabled: true });
    const b = {
      logs, errors, navigations: 0, close,
      on(event, fn) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(fn); return () => listeners.get(event).delete(fn); },
      async send(method, params = {}) { try { return await command(method, params); } catch (e) { if (!e.message.includes('Execution context was destroyed')) throw e; return command(method, params); } },
      async eval(expression) {
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const r = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
            if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
            return r.result.value;
          } catch (e) { if (attempt || !e.message.includes('Execution context was destroyed')) throw e; }
        }
      },
      async wait(expression, label = expression, timeout = 20000) { return until(() => b.eval(expression), label, timeout); },
      async navigate(url) { const r = await b.send('Page.navigate', { url }); if (r.errorText) throw new Error(`Navigation failed: ${r.errorText}`); await b.wait(`location.href === ${JSON.stringify(url)} && document.readyState === "complete"`, 'document loaded'); },
    };
    b.on('Runtime.consoleAPICalled', e => { const text = e.args.map(a => a.value ?? a.description ?? a.type).join(' '); logs.push({ type: e.type, text }); if (e.type === 'error') errors.push(text); });
    b.on('Runtime.exceptionThrown', e => errors.push(e.exceptionDetails.exception?.description || e.exceptionDetails.text));
    b.on('Log.entryAdded', e => { logs.push(e.entry); });
    b.on('Page.frameNavigated', e => { if (!e.frame.parentId) b.navigations++; });
    await b.send('Page.enable'); await b.send('Runtime.enable'); await b.send('Log.enable'); await b.send('Network.enable');
    await setProfile(b, profile);
    return b;
  } catch (e) { await close(); throw e; }
}
export async function setProfile(b, name) {
  const p = profiles[name]; if (!p) throw new Error(`Unknown profile ${name}`);
  await b.send('Emulation.setDeviceMetricsOverride', { ...p, deviceScaleFactor: 1, mobile: name === 'phone' });
  await b.send('Emulation.setTouchEmulationEnabled', { enabled: name === 'phone' });
  await b.send('Emulation.setUserAgentOverride', { userAgent: name === 'phone' ? 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36' : 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36' });
}
