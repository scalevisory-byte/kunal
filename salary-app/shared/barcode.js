/**
 * Code 128 barcodes, drawn as SVG.
 *
 * The brief asks for "barcode / QR generation" for asset labels. This does the
 * barcode half, and does it with no dependency at all.
 *
 * **Why a barcode rather than a QR code.** A QR code needs Reed-Solomon error
 * correction, which is a few hundred lines of finite-field arithmetic that is
 * easy to get subtly wrong and hard to eyeball - the kind of code that should
 * come from a library that thousands of people have scanned. Code 128 needs a
 * lookup table and a weighted checksum, which is small enough to read, test and
 * trust. It scans with any phone barcode app and with the cheap USB scanners an
 * office already has, which is what an asset label is for.
 *
 * If a QR code is specifically wanted, it should be a small library rather than
 * this file growing one.
 *
 * Dependency-free, so the server and the browser draw the same label.
 */

/*
 * The 107 Code 128 patterns. Each is six digits: the widths of three bars and
 * three spaces, alternating, bar first. Taken from the specification; the
 * check-digit test at the bottom of barcode.test.js is what says they were
 * transcribed correctly.
 */
const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312',
  '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222',
  '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131',
  '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321',
  '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121',
  '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321',
  '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224',
  '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114',
  '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112',
  '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113',
  '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412',
  '211214', '211232', '2331112',
];

const START_B = 104;
const STOP = 106;

/** Code 128 Set B covers ASCII 32..126, which is every character a code uses. */
const valueOf = (ch) => {
  const code = ch.charCodeAt(0);
  return code >= 32 && code <= 126 ? code - 32 : null;
};

/** True when every character can be encoded. */
export const canEncode = (text) =>
  String(text || '').length > 0 && [...String(text)].every((ch) => valueOf(ch) !== null);

/**
 * The bar widths for one string, as a flat list starting with a bar.
 *
 * @returns {{ widths: number[], checksum: number }} or null for anything that
 *   cannot be encoded - never a barcode that scans as the wrong thing.
 */
export function encode128(text) {
  const chars = [...String(text || '')];
  if (!canEncode(text)) return null;

  const values = chars.map(valueOf);
  // The checksum is the start value plus each character's value times its
  // position, modulo 103. Getting this wrong produces a barcode that looks
  // perfect and scans as nothing.
  let sum = START_B;
  values.forEach((v, i) => {
    sum += v * (i + 1);
  });
  const checksum = sum % 103;

  const sequence = [START_B, ...values, checksum, STOP];
  const widths = [];
  for (const value of sequence) {
    for (const digit of PATTERNS[value]) widths.push(Number(digit));
  }
  return { widths, checksum, modules: widths.reduce((a, b) => a + b, 0) };
}

/**
 * The barcode as an SVG string.
 *
 * Drawn as rectangles rather than a font, so it does not depend on anything
 * being installed, and sized in millimetres so a printed label is the size it
 * says it is. The quiet zone either side is part of the specification: without
 * it, scanners miss the first bar.
 */
export function barcodeSvg(text, { heightMm = 12, moduleMm = 0.33, quietModules = 10, showText = true } = {}) {
  const encoded = encode128(text);
  if (!encoded) return null;

  const quiet = Math.max(10, quietModules);
  const totalModules = encoded.modules + quiet * 2;
  const widthMm = totalModules * moduleMm;
  const textMm = showText ? 3.6 : 0;
  const fullHeight = heightMm + textMm;

  const bars = [];
  let x = quiet;
  encoded.widths.forEach((width, i) => {
    // Even positions are bars, odd are spaces.
    if (i % 2 === 0) {
      bars.push(
        `<rect x="${(x * moduleMm).toFixed(3)}" y="0" width="${(width * moduleMm).toFixed(3)}" height="${heightMm}"/>`
      );
    }
    x += width;
  });

  const label = showText
    ? `<text x="${(widthMm / 2).toFixed(2)}" y="${(heightMm + 2.9).toFixed(2)}" font-family="monospace" font-size="2.9" text-anchor="middle">${escapeXml(text)}</text>`
    : '';

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${widthMm.toFixed(2)}mm" height="${fullHeight.toFixed(2)}mm" ` +
    `viewBox="0 0 ${widthMm.toFixed(2)} ${fullHeight.toFixed(2)}" shape-rendering="crispEdges">` +
    `<rect width="${widthMm.toFixed(2)}" height="${fullHeight.toFixed(2)}" fill="#fff"/>` +
    `<g fill="#000">${bars.join('')}</g>${label}</svg>`
  );
}

const escapeXml = (s) =>
  String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
