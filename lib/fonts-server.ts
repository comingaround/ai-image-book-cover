import 'server-only';

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { parseCoverFonts, type CoverFonts } from './cover-svg';

const g = globalThis as unknown as { coverFonts?: Promise<CoverFonts> };

/** Cover fonts parsed once per server instance (next.config.ts ships public/fonts with the route). */
export function serverFonts(): Promise<CoverFonts> {
  g.coverFonts ??= parseCoverFonts(async (file) => {
    const buf = await readFile(join(process.cwd(), 'public', 'fonts', file));
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  });
  return g.coverFonts;
}
