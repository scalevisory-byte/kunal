/**
 * QR codes for the asset labels.
 *
 * The Code 128 barcode in barcode.js is written out by hand, and the comment
 * there says why that was reasonable: it is a lookup table and a weighted
 * checksum. A QR code is not that. It is Reed-Solomon error correction over a
 * finite field, mask selection, format and version bits - hundreds of lines
 * that are easy to get subtly wrong and produce a code that looks perfect and
 * scans as nothing. So this one comes from a library that thousands of people
 * have scanned, exactly as that comment said to do.
 *
 * The library is handed in rather than imported, the same way ExcelJS is, so
 * everything under shared/ stays dependency-free and the server and the
 * browser cannot end up on different versions of it.
 */

const escapeXml = (s) =>
  String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

/**
 * One QR code, as an SVG string, sized in millimetres so a printed sticker is
 * the size it says it is.
 *
 * @param text    what to encode - for a label, the asset's own code
 * @param qr      the qrcode-generator factory, handed in
 * @param sizeMm  the side of the code itself, not counting the quiet zone
 * @param ecc     'L' | 'M' | 'Q' | 'H'. 'M' by default, and 'Q' is worth it on
 *                something that will be rubbed, scuffed or stuck on a vehicle.
 */
export function qrSvg(text, { qr, sizeMm = 18, ecc = 'M', quietModules = 4, label = '' } = {}) {
  const value = String(text || '').trim();
  if (!value || typeof qr !== 'function') return null;

  // Type 0 lets the library pick the smallest version that fits.
  const code = qr(0, ecc);
  code.addData(value);
  code.make();

  const n = code.getModuleCount();
  // The quiet zone is part of the specification, not decoration: without it a
  // scanner cannot find the code's edge against whatever it is stuck to.
  const quiet = Math.max(4, quietModules);
  const total = n + quiet * 2;
  const module = sizeMm / n;
  const sideMm = total * module;
  const textMm = label ? 3.6 : 0;

  const rects = [];
  for (let row = 0; row < n; row++) {
    // Runs of dark modules go out as one rectangle rather than one each: it is
    // the same picture in a fraction of the bytes, and a sheet of 40 labels is
    // 40 of these.
    let start = -1;
    for (let col = 0; col <= n; col++) {
      const dark = col < n && code.isDark(row, col);
      if (dark && start < 0) start = col;
      if (!dark && start >= 0) {
        rects.push(
          `<rect x="${((start + quiet) * module).toFixed(3)}" y="${((row + quiet) * module).toFixed(3)}" ` +
            `width="${((col - start) * module).toFixed(3)}" height="${module.toFixed(3)}"/>`
        );
        start = -1;
      }
    }
  }

  const caption = label
    ? `<text x="${(sideMm / 2).toFixed(2)}" y="${(sideMm + 2.9).toFixed(2)}" font-family="monospace" font-size="2.9" text-anchor="middle">${escapeXml(label)}</text>`
    : '';

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${sideMm.toFixed(2)}mm" height="${(sideMm + textMm).toFixed(2)}mm" ` +
    `viewBox="0 0 ${sideMm.toFixed(2)} ${(sideMm + textMm).toFixed(2)}" shape-rendering="crispEdges">` +
    `<rect width="${sideMm.toFixed(2)}" height="${(sideMm + textMm).toFixed(2)}" fill="#fff"/>` +
    `<g fill="#000">${rects.join('')}</g>${caption}</svg>`
  );
}

/** How many modules a code came out as - useful for a test, and nothing else. */
export function qrModules(text, { qr, ecc = 'M' } = {}) {
  const code = qr(0, ecc);
  code.addData(String(text));
  code.make();
  return code.getModuleCount();
}
