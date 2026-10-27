import { getBatch, getFile, listDocuments, putBatch, putFile } from './db';
import { pageManifest, countPages } from './pdf';
import { sha256 } from './hash';
import { migrateV1Record } from '../contract/migrate';
import type { MediaType } from '../contract/types';

let running: Promise<{ migrated: number; skipped: number }> | undefined;
/** One in-flight migration, including React StrictMode's repeated startup effect. */
export function migrateStore(): Promise<{ migrated: number; skipped: number }> {
  if (running) return running;
  running = migrate().finally(() => { running = undefined; });
  return running;
}
async function migrate(): Promise<{ migrated: number; skipped: number }> {
  let migrated = 0;
  let skipped = 0;
  for (const record of await listDocuments()) {
    if (await getBatch(`legacy_${record.id}`)) continue;
    const blob = await getFile(record.id);
    if (!blob) { skipped++; continue; }
    // Preserve original media identities, including legacy TIFF records.
    if (!['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/tiff'].includes(blob.type || record.mime)) { skipped++; continue; }
    let pages;
    let dimensionsFallback = false;
    try { pages = await pageManifest(blob); }
    catch {
      dimensionsFallback = true;
      let count = Math.max(1, record.pageCount || 1);
      try { count = await countPages(blob); } catch { /* Saved page count is the only available manifest. */ }
      pages = Array.from({ length: count }, (_, i) => ({ page_number: i + 1, width: 595, height: 842 }));
    }
    const file_id = `legacy_file_${record.id}`;
    const batch = migrateV1Record(record, { file: { file_id, filename: record.name, media_type: (blob.type || record.mime) as MediaType, sha256: await sha256(blob), size: blob.size }, pages, dimensionsFallback });
    await putFile(file_id, blob);
    await putBatch(batch);
    migrated++;
  }
  return { migrated, skipped };
}
