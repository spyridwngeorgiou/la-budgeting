// Bytes -> text for uploaded statements. Greek e-banking still exports
// windows-1253 more often than UTF-8. TextDecoder("windows-1253") exists in
// Node (full ICU) and browsers, but a Cloudflare Worker may only ship UTF-8,
// so the 128 upper code points are also built in here -- decoding never
// depends on the runtime's label support.

export type TextEncoding = "utf-8" | "windows-1253";

// windows-1253 bytes 0x80-0xFF -> Unicode code point; 0 = unassigned in the
// codepage. 0x00-0x7F are ASCII. Unassigned bytes decode exactly as the
// runtime TextDecoder does (checked byte-for-byte in csv.test.ts): 0x80-0x9F
// to the C1 control of the same value, 0xAA to «ª», 0xD2 and 0xFF to U+FFFD.
// prettier-ignore
const CP1253_HIGH: number[] = [
  // 0x80
  0x20ac, 0, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0, 0x2030, 0, 0x2039, 0, 0, 0, 0,
  // 0x90
  0, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0, 0x2122, 0, 0x203a, 0, 0, 0, 0,
  // 0xA0
  0x00a0, 0x0385, 0x0386, 0x00a3, 0x00a4, 0x00a5, 0x00a6, 0x00a7, 0x00a8, 0x00a9, 0x00aa, 0x00ab, 0x00ac, 0x00ad, 0x00ae, 0x2015,
  // 0xB0
  0x00b0, 0x00b1, 0x00b2, 0x00b3, 0x0384, 0x00b5, 0x00b6, 0x00b7, 0x0388, 0x0389, 0x038a, 0x00bb, 0x038c, 0x00bd, 0x038e, 0x038f,
  // 0xC0-0xFF: Greek letters U+0390-U+03CE in order, with 0xD2 and 0xFF unassigned
  ...Array.from({ length: 64 }, (_, i) => (i === 0x12 || i === 0x3f ? 0 : 0x0390 + i)),
];

export function decodeWindows1253(bytes: Uint8Array): string {
  let out = "";
  // Build in chunks: String.fromCharCode(...hugeArray) overflows the stack.
  const CHUNK = 8192;
  for (let start = 0; start < bytes.length; start += CHUNK) {
    const codes: number[] = [];
    const end = Math.min(bytes.length, start + CHUNK);
    for (let i = start; i < end; i++) {
      const b = bytes[i];
      codes.push(b < 0x80 ? b : CP1253_HIGH[b - 0x80] || (b < 0xa0 ? b : 0xfffd));
    }
    out += String.fromCharCode(...codes);
  }
  return out;
}

// Inverse table, for building fixtures and for round-trip tests.
export function encodeWindows1253(text: string): Uint8Array {
  const reverse = new Map<number, number>();
  CP1253_HIGH.forEach((cp, i) => {
    if (cp) reverse.set(cp, 0x80 + i);
  });
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const cp = text.charCodeAt(i);
    const b = cp < 0x80 ? cp : reverse.get(cp);
    if (b === undefined) throw new Error(`Ο χαρακτήρας «${text[i]}» δεν υπάρχει στο windows-1253.`);
    out[i] = b;
  }
  return out;
}

function hasUtf8Bom(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
}

export interface DecodedText {
  text: string;
  encoding: TextEncoding;
}

// Decode with the profile's encoding when known; otherwise UTF-8 if the
// bytes are valid UTF-8 (a BOM settles it outright), else windows-1253.
// Plain ASCII is valid in both, so the guess can only be wrong for files
// that are valid UTF-8 *and* meant as 1253 -- vanishingly rare for Greek text.
export function decodeBytes(input: ArrayBuffer | Uint8Array, encoding?: TextEncoding | null): DecodedText {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (hasUtf8Bom(bytes)) {
    return { text: new TextDecoder("utf-8").decode(bytes.subarray(3)), encoding: "utf-8" };
  }
  if (encoding === "windows-1253") return { text: decodeWindows1253(bytes), encoding };
  if (encoding === "utf-8") return { text: new TextDecoder("utf-8").decode(bytes), encoding };
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "utf-8" };
  } catch {
    return { text: decodeWindows1253(bytes), encoding: "windows-1253" };
  }
}
