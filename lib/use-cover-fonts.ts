'use client';

import { parse } from 'opentype.js';
import { useEffect, useState } from 'react';

import { FONT_FILES, type CoverFonts, type FontKey } from './cover-svg';

let pending: Promise<CoverFonts> | null = null;

function loadFonts(): Promise<CoverFonts> {
  pending ??= Promise.all(
    (Object.keys(FONT_FILES) as FontKey[]).map(async (k) => {
      const res = await fetch(`/fonts/${FONT_FILES[k]}`);
      return [k, parse(await res.arrayBuffer())] as const;
    })
  ).then((entries) => Object.fromEntries(entries) as CoverFonts);
  return pending;
}

/** The cover fonts, or undefined until they arrive (previews fall back to system fonts meanwhile). */
export function useCoverFonts(): CoverFonts | undefined {
  const [fonts, setFonts] = useState<CoverFonts>();
  useEffect(() => {
    let live = true;
    loadFonts()
      .then((f) => live && setFonts(f))
      .catch(() => (pending = null));
    return () => {
      live = false;
    };
  }, []);
  return fonts;
}
