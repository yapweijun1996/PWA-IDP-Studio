export function makePDF(count) {
  if (!Number.isInteger(count) || count < 1) throw new Error('PDF page count must be a positive integer');
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Count ${count} /Kids [${Array.from({ length: count }, (_, i) => `${3 + i * 2} 0 R`).join(' ')}] >>`];
  for (let i = 0; i < count; i++) {
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << >> /Contents ${4 + i * 2} 0 R >>`);
    const stream = '0.9 g 10 10 180 180 re f\n';
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`);
  }
  let pdf = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}
