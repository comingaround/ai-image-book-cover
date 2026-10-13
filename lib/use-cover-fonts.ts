'use client';

import { useEffect, useState } from 'react';

import { parseCoverFonts, type CoverFonts } from './cover-svg';

let pending: Promise<CoverFonts> | null = null;

/** The cover fonts, or undefined while they load (previews use system fonts meanwhile). */
export function useCoverFonts(): CoverFonts | undefined {
  const [fonts, setFonts] = useState<CoverFonts>();
  useEffect(() => {
    let live = true;
    pending ??= parseCoverFonts((file) => fetch(`/fonts/${file}`).then((r) => r.arrayBuffer()));
    pending.then((f) => live && setFonts(f)).catch(() => (pending = null));
    return () => {
      live = false;
    };
  }, []);
  return fonts;
}
