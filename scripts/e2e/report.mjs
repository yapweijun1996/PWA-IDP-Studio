import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { redact } from './mocks.mjs';
export async function failureArtifacts(b, directory, error) {
  await mkdir(directory, { recursive: true });
  const failures = [];
  if (b) {
    // Mask credential widgets before both screenshot and DOM capture.
    try { await b.eval(`document.querySelectorAll('input[type="password"]').forEach(e=>{e.value='[REDACTED]';e.style.visibility='hidden'})`); } catch (e) { failures.push(e.message); }
    try { const shot = await b.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }); await writeFile(join(directory,'screenshot.png'), Buffer.from(shot.data,'base64')); } catch (e) { failures.push(e.message); }
    try { await writeFile(join(directory,'dom.txt'),redact(await b.eval('document.documentElement.outerHTML + "\\n\\nVISIBLE TEXT\\n" + document.body.innerText'))); } catch (e) { failures.push(e.message); }
    await writeFile(join(directory,'console.json'),redact(JSON.stringify({ logs:b.logs, errors:b.errors },null,2)));
  }
  await writeFile(join(directory,'failure.txt'),redact(`${error.stack || error}\n\nArtifact errors:\n${failures.join('\n')}`));
}
export async function report(results, directory) {
  await mkdir(directory,{recursive:true});
  console.table(results.map(({name,status,reason,flaky})=>({scenario:name,result:status,reason:redact(`${flaky?(status==='PASS'?'FLAKY: transport retry passed. ':'FLAKY: transport retry attempted. '):''}${reason||''}`)})));
  const failed=results.filter(r=>r.status==='FAIL').length;
  const flaky=results.filter(r=>r.flaky).length;
  console.log(`${results.filter(r=>r.status==='PASS').length} passed, ${failed} failed, ${results.filter(r=>r.status==='SKIP').length} skipped; ${flaky} flaky. Artifacts: ${directory}`);
  if(flaky>1) console.error('FAIL: more than one flaky scenario');
  await writeFile(join(directory,'report.json'),redact(JSON.stringify({results,failed,flaky},null,2)));
  return failed>0||flaky>1?1:0;
}
