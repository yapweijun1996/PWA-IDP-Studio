function assemble(objects) {
  let pdf = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

export function makePDF(count) {
  if (!Number.isInteger(count) || count < 1) throw new Error('PDF page count must be a positive integer');
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Count ${count} /Kids [${Array.from({ length: count }, (_, i) => `${3 + i * 2} 0 R`).join(' ')}] >>`];
  for (let i = 0; i < count; i++) {
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << >> /Contents ${4 + i * 2} 0 R >>`);
    const stream = '0.9 g 10 10 180 180 re f\n';
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`);
  }
  return assemble(objects);
}

/**
 * One page of text in a NON-embedded CID font with a predefined CMap (Adobe-Japan1, 90ms-RKSJ-H). PDF.js can only decode
 * and draw it when its CMap resources are reachable, so it exposes a missing cMapUrl (the real-world defect that blanked
 * descriptions and addresses in ERP-exported purchase orders). makePDF has no fonts at all and cannot catch that.
 */
export function makeCidPDF() {
  const stream = 'BT /F1 24 Tf 20 40 Td <414243> Tj ET\n';
  return assemble([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Count 1 /Kids [3 0 R] >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 100] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,
    '<< /Type /Font /Subtype /Type0 /BaseFont /HeiseiMin-W3-90ms-RKSJ-H /Encoding /90ms-RKSJ-H /DescendantFonts [6 0 R] >>',
    '<< /Type /Font /Subtype /CIDFontType0 /BaseFont /HeiseiMin-W3 /CIDSystemInfo << /Registry (Adobe) /Ordering (Japan1) /Supplement 2 >> /FontDescriptor 7 0 R /DW 1000 >>',
    '<< /Type /FontDescriptor /FontName /HeiseiMin-W3 /Flags 6 /FontBBox [-123 -257 1001 910] /ItalicAngle 0 /Ascent 723 /Descent -241 /CapHeight 709 /StemV 69 >>',
  ]);
}
