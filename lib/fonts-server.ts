import 'server-only';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parse } from 'opentype.js';

import { FONT_FILES, type CoverFonts, type FontKey } from './cover-svg';

const g = globalThis as unknown as { babyBookFonts?: CoverFonts };

/**
 * Parsed once per server instance. Read from public/fonts, which
 * next.config.ts traces into the compose function's bundle on Vercel.
 */
export function serverFonts(): CoverFonts {
  if (!g.babyBookFonts) {
    const dir = join(process.cwd(), 'public', 'fonts');
    g.babyBookFonts = Object.fromEntries(
      (Object.keys(FONT_FILES) as FontKey[]).map((k) => {
        const buf = readFileSync(join(dir, FONT_FILES[k]));
        return [k, parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))];
      })
    ) as CoverFonts;
  }
  return g.babyBookFonts;
}
