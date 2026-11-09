/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Detects whether a string has un-decoded Korean EUC-KR bytes and decodes it.
 */
export function decodeLegacyKoreanIfNeeded(str: string): string {
  if (!str || typeof str !== 'string') return '';
  let highCount = 0;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code > 0xff) return str; // Already Unicode
    if (code >= 0x80 && code <= 0xfe) highCount++;
  }
  if (highCount >= 2) {
    try {
      const bytes = new Uint8Array(str.length);
      for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i) & 0xff;
      const decoded = new TextDecoder('euc-kr', { fatal: false }).decode(bytes);
      if (decoded && !decoded.includes('\uFFFD')) return decoded;
    } catch {
      // Ignore decoding failure
    }
  }
  return str;
}

/**
 * Cleans AutoCAD formatting escapes, Korean character sequences, and dimension symbols.
 */
export function cleanCadText(rawStr: unknown): string {
  if (rawStr === undefined || rawStr === null) return '';
  let s = decodeLegacyKoreanIfNeeded(String(rawStr));

  // Unicode character escapes: \U+xxxx or \u+xxxx
  s = s.replace(/\\[Uu]\+([0-9A-Fa-f]{4})/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16))
  );

  // AutoCAD special symbol codes
  s = s
    .replace(/%%[cC]/g, 'Ø')
    .replace(/%%[dD]/g, '°')
    .replace(/%%[pP]/g, '±')
    .replace(/%%[uUoOkK]/g, '');

  // Paragraph / line breaks
  s = s.replace(/\\P/gi, '\n');

  // Fractions: \S1/2; or \S1^2;
  s = s.replace(/\\S([^;]*);/gi, (_, frac) => frac.replace(/[\^#]/g, '/'));

  // Fonts / styling escapes: \A1; \H0.8x; \W0.75; etc.
  s = s.replace(/\\[A-Za-z][^;\\]*;/g, '');

  // Non-breaking spaces and format braces
  s = s
    .replace(/\\~+/g, ' ')
    .replace(/\\[LlOoKk]/g, '')
    .replace(/[{}]/g, '');

  return s
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');
}

/**
 * Decodes a raw Uint8Array buffer attempting UTF-8 first, then EUC-KR fallback.
 */
export function decodeTextBuffer(uint8: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(uint8);
  } catch {
    try {
      return new TextDecoder('euc-kr', { fatal: false }).decode(uint8);
    } catch {
      return new TextDecoder('utf-8', { fatal: false }).decode(uint8);
    }
  }
}

/**
 * Checks the AutoCAD signature header (AC10xx)
 */
export function detectDwgHeader(uint8: Uint8Array): string | null {
  if (!uint8 || uint8.length < 6) return null;
  const sig = String.fromCharCode(
    uint8[0],
    uint8[1],
    uint8[2],
    uint8[3],
    uint8[4],
    uint8[5]
  );
  const map: Record<string, string> = {
    AC1032: 'AutoCAD 2018+',
    AC1027: 'AutoCAD 2013',
    AC1024: 'AutoCAD 2010',
    AC1021: 'AutoCAD 2007',
    AC1018: 'AutoCAD 2004',
    AC1015: 'AutoCAD 2000',
    AC1014: 'AutoCAD R14',
    AC1012: 'AutoCAD R13',
  };
  if (map[sig]) return map[sig];
  if (sig.startsWith('AC10')) return `DWG (${sig})`;
  return null;
}

/**
 * Extracts embedded BMP/PNG thumbnail from DWG binary header if available.
 */
export function extractThumbnailBmp(buffer: ArrayBuffer): string | null {
  try {
    const u8 = new Uint8Array(buffer);
    if (u8.length < 64) return null;
    const view = new DataView(buffer);
    const imgSentinelOffset = view.getUint32(0x0d, true);
    if (!imgSentinelOffset || imgSentinelOffset + 30 >= u8.length) return null;

    // Look for PNG signature or BMP DIB header near sentinel
    for (let i = imgSentinelOffset; i < Math.min(u8.length - 8, imgSentinelOffset + 256); i++) {
      // PNG magic: 89 50 4E 47 0D 0A 1A 0A
      if (
        u8[i] === 0x89 &&
        u8[i + 1] === 0x50 &&
        u8[i + 2] === 0x4e &&
        u8[i + 3] === 0x47
      ) {
        const endLimit = Math.min(u8.length - 8, i + 512 * 1024);
        for (let j = i + 8; j < endLimit; j++) {
          if (
            u8[j] === 0x49 &&
            u8[j + 1] === 0x45 &&
            u8[j + 2] === 0x4e &&
            u8[j + 3] === 0x44
          ) {
            const pngSlice = u8.slice(i, j + 8);
            const blob = new Blob([pngSlice], { type: 'image/png' });
            return URL.createObjectURL(blob);
          }
        }
      }
    }
  } catch {
    // ignore
  }
  return null;
}
