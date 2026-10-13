import type { Font } from 'opentype.js';

import { COVER_H, COVER_W, type CoverTemplate, type PhotoSlot } from './catalog';

/**
 * Cover artwork as SVG layers. The SAME functions feed both renderers:
 *   - the browser, for instant thumbnails and the live preview (`previewSvg`)
 *   - sharp on the server, which stacks background → masked photo → overlay
 *     into the print file (`app/api/compose/route.ts`)
 * so what the customer previews is what gets printed.
 */

export interface CoverText {
  title: string;
  babyName: string;
}

/**
 * Bundled fonts (public/fonts, all SIL OFL). Text is drawn as outlines from
 * these, never as SVG <text>: servers have no fonts installed (Vercel's Linux
 * has none), so <text> would render differently — or not at all — per machine.
 */
export type FontKey = 'title' | 'subtitle' | 'hand' | 'caps';
export type CoverFonts = Record<FontKey, Font>;
export const FONT_FILES: Record<FontKey, string> = {
  title: 'title.ttf', // Fraunces SemiBold
  subtitle: 'subtitle.ttf', // Fraunces Italic
  hand: 'hand.ttf', // Caveat Medium
  caps: 'caps.ttf', // Nunito Bold
};

/** Only used for the browser's first paint, before the fonts have loaded. */
const FALLBACK: Record<FontKey, string> = {
  title: `font-family="Georgia, serif" font-weight="700"`,
  subtitle: `font-family="Georgia, serif" font-style="italic"`,
  hand: `font-family="Segoe Print, Comic Sans MS, cursive"`,
  caps: `font-family="Verdana, sans-serif"`,
};

interface TextOpts {
  fill: string;
  opacity?: number;
  /** Tracking in em. */
  spacing?: number;
}

/**
 * Glyph-by-glyph layout: one glyph per character + pair kerning. Deliberately
 * NOT font.getPath(): opentype.js's substitution engine throws on lookups it
 * doesn't implement (Nunito: GSUB type 6 format 2), and covers don't need
 * ligatures — this works with any TTF.
 */
function layout(font: Font, str: string, size: number, spacing = 0) {
  const scale = size / font.unitsPerEm;
  const glyphs = Array.from(str, (ch) => font.charToGlyph(ch));
  const xs: number[] = [];
  let x = 0;
  glyphs.forEach((g, i) => {
    xs.push(x);
    x += (g.advanceWidth ?? 0) * scale + spacing * size;
    if (i < glyphs.length - 1) x += font.getKerningValue(g, glyphs[i + 1]) * scale;
  });
  return { glyphs, xs, width: x - (glyphs.length ? spacing * size : 0) };
}

/** One line of centred text at baseline `y`, as a <path> when fonts are available. */
function line(fonts: CoverFonts | undefined, key: FontKey, str: string, x: number, y: number, size: number, o: TextOpts) {
  const op = o.opacity === undefined ? '' : ` opacity="${o.opacity}"`;
  if (!fonts) {
    const ls = o.spacing ? ` letter-spacing="${o.spacing * size}"` : '';
    return `<text x="${x}" y="${y}" text-anchor="middle" ${FALLBACK[key]} font-size="${size}"${ls} fill="${o.fill}"${op}>${esc(str)}</text>`;
  }
  const font = fonts[key];
  const { glyphs, xs, width } = layout(font, str, size, o.spacing);
  const left = x - width / 2;
  const d = glyphs.map((g, i) => g.getPath(left + xs[i], y, size).toPathData(2)).join('');
  return `<path d="${d}" fill="${o.fill}"${op}/>`;
}

/** Largest size ≤ max at which `str` fits in `width`. */
function fitSize(fonts: CoverFonts | undefined, key: FontKey, str: string, max: number, width: number) {
  const w = fonts ? layout(fonts[key], str, max).width : str.length * max * 0.55;
  return Math.min(max, Math.floor((max * width) / Math.max(w, 1)));
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const svg = (w: number, h: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;

/** Deterministic scatter, so a template looks identical on every render. */
function scatter(seed: number, n: number) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  return Array.from({ length: n }, () => ({ x: rnd(), y: rnd(), r: rnd() }));
}

/** The slot's outline in slot-local coordinates (0,0 = slot top-left). */
export function slotPath({ w, h, shape }: PhotoSlot): string {
  if (shape === 'circle') {
    const r = Math.min(w, h) / 2;
    return `M ${w / 2 - r} ${h / 2} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0 Z`;
  }
  if (shape === 'arch') {
    const r = w / 2;
    return `M 0 ${h} L 0 ${r} A ${r} ${r} 0 0 1 ${w} ${r} L ${w} ${h} Z`;
  }
  const r = 28;
  return `M ${r} 0 H ${w - r} Q ${w} 0 ${w} ${r} V ${h - r} Q ${w} ${h} ${w - r} ${h} H ${r} Q 0 ${h} 0 ${h - r} V ${r} Q 0 0 ${r} 0 Z`;
}

/** White slot shape on transparent — sharp uses it with `blend: 'dest-in'`. */
export function maskSvg(slot: PhotoSlot): string {
  return svg(slot.w, slot.h, `<path d="${slotPath(slot)}" fill="#fff"/>`);
}

function decorations(t: CoverTemplate): string {
  const { slot } = t;
  const cx = slot.x + slot.w / 2;
  if (t.id === 'little-star') {
    const stars = scatter(7, 70)
      .map(({ x, y, r }) => `<circle cx="${(x * COVER_W).toFixed(0)}" cy="${(y * COVER_H).toFixed(0)}" r="${(1.5 + r * 4).toFixed(1)}" fill="${t.ink}" opacity="${(0.35 + r * 0.6).toFixed(2)}"/>`)
      .join('');
    const sparkle = (x: number, y: number, s: number) =>
      `<path transform="translate(${x} ${y}) scale(${s})" d="M0 -30 C4 -6 6 -4 30 0 C6 4 4 6 0 30 C-4 6 -6 4 -30 0 C-6 -4 -4 -6 0 -30 Z" fill="${t.accent}"/>`;
    return `${stars}
      <circle cx="1075" cy="105" r="52" fill="${t.accent}"/><circle cx="1098" cy="90" r="46" fill="${t.bg}"/>
      ${sparkle(170, 420, 1.3)}${sparkle(1040, 1000, 1)}${sparkle(230, 1080, 0.7)}${sparkle(960, 420, 0.6)}
      <path d="M0 1340 Q 300 1270 600 1330 T 1200 1310 V 1500 H 0 Z" fill="${t.spine}"/>`;
  }
  if (t.id === 'hello-world') {
    const dots = scatter(3, 46)
      .map(({ x, y, r }, i) => {
        const fill = ['#e88f7a', '#f2c46d', '#9cc5b0', '#a8b8e0'][i % 4];
        return `<circle cx="${(x * COVER_W).toFixed(0)}" cy="${(y * COVER_H).toFixed(0)}" r="${(5 + r * 9).toFixed(1)}" fill="${fill}" opacity="0.55"/>`;
      })
      .join('');
    const cy = slot.y + slot.w / 2;
    const bands = ['#e88f7a', '#f2c46d', '#9cc5b0', '#a8b8e0']
      .map((c, i) => {
        const r = slot.w / 2 + 90 - i * 22;
        return `<path d="M ${cx - r} ${cy + 60} A ${r} ${r} 0 0 1 ${cx + r} ${cy + 60}" fill="none" stroke="${c}" stroke-width="22" stroke-linecap="round"/>`;
      })
      .join('');
    return `${dots}${bands}`;
  }
  // wild-one
  const leaf = (x: number, y: number, rot: number, s: number, fill: string) =>
    `<path transform="translate(${x} ${y}) rotate(${rot}) scale(${s})" d="M0 0 C 40 -60 120 -60 160 0 C 120 60 40 60 0 0 Z M0 0 L160 0" fill="${fill}" stroke="${t.ink}" stroke-opacity="0.18" stroke-width="3"/>`;
  return `
    ${leaf(-20, 120, 20, 1.6, t.accent)}${leaf(40, 260, -10, 1.1, '#a9c39b')}
    ${leaf(1220, 90, 150, 1.5, '#a9c39b')}${leaf(1200, 260, 200, 1.1, t.accent)}
    ${leaf(-30, 1380, -30, 1.7, t.accent)}${leaf(1230, 1400, 210, 1.8, '#a9c39b')}${leaf(80, 1290, 10, 0.9, '#a9c39b')}
    <g transform="translate(${slot.x - 34} ${slot.y - 34})">
      <rect x="10" y="18" width="${slot.w + 68}" height="${slot.h + 150}" rx="14" fill="#000" opacity="0.12"/>
      <rect width="${slot.w + 68}" height="${slot.h + 150}" rx="14" fill="#fffdf8"/>
    </g>`;
}

/** Frame + text — drawn ABOVE the photo. */
function overlay(t: CoverText & { tpl: CoverTemplate; fonts?: CoverFonts }): string {
  const { tpl, fonts } = t;
  const { slot } = tpl;
  const title = t.title.trim() || tpl.defaultTitle;
  const name = t.babyName.trim();
  const local = `translate(${slot.x} ${slot.y})`;

  let frame = '';
  if (tpl.id === 'little-star') {
    frame = `<g transform="${local}"><path d="${slotPath(slot)}" fill="none" stroke="${tpl.ink}" stroke-width="10"/></g>
      <circle cx="${slot.x + slot.w / 2}" cy="${slot.y + slot.h / 2}" r="${slot.w / 2 + 28}" fill="none" stroke="${tpl.accent}" stroke-width="4" stroke-dasharray="2 16" stroke-linecap="round"/>`;
  } else if (tpl.id === 'hello-world') {
    frame = `<g transform="${local}"><path d="${slotPath(slot)}" fill="none" stroke="#fffaf6" stroke-width="16"/></g>`;
  } else {
    frame = line(fonts, 'hand', name ? `${name}, day one` : 'day one', slot.x + slot.w / 2, slot.y + slot.h + 88, 58, { fill: tpl.ink });
  }

  const subY = tpl.id === 'wild-one' ? 1250 : tpl.id === 'hello-world' ? 1230 : 1200;
  const sub = name ? `The story of ${name}` : 'The story of you';
  return `${frame}
    ${line(fonts, 'title', title, 600, 250, fitSize(fonts, 'title', title, 104, 1000), { fill: tpl.ink })}
    ${line(fonts, 'subtitle', sub, 600, subY, fitSize(fonts, 'subtitle', sub, 62, 900), { fill: tpl.ink })}
    ${line(fonts, 'caps', 'A STORY MADE WITH LOVE', 600, tpl.id === 'little-star' ? 1430 : 1410, 24, { fill: tpl.ink, opacity: 0.7, spacing: 0.3 })}`;
}

/** Layer 1 (server): everything below the photo. */
export function backgroundSvg(tpl: CoverTemplate): string {
  return svg(COVER_W, COVER_H, `<rect width="100%" height="100%" fill="${tpl.bg}"/>${decorations(tpl)}`);
}

/** Layer 3 (server): everything above the photo. */
export function overlaySvg(tpl: CoverTemplate, text: CoverText, fonts: CoverFonts): string {
  return svg(COVER_W, COVER_H, overlay({ ...text, tpl, fonts }));
}

/** Friendly stand-in shown in the slot until a photo is uploaded. */
function placeholderBaby(slot: PhotoSlot, tpl: CoverTemplate): string {
  const cx = slot.w / 2;
  const cy = slot.h / 2 + 20;
  const skin = '#f3d2bd';
  const line = '#8a5a4a';
  return `<rect width="${slot.w}" height="${slot.h}" fill="${tpl.id === 'little-star' ? '#2c3a62' : '#fff6ef'}"/>
    <ellipse cx="${cx}" cy="${cy + 250}" rx="230" ry="150" fill="${tpl.accent}" opacity="0.8"/>
    <circle cx="${cx - 150}" cy="${cy}" r="40" fill="${skin}"/><circle cx="${cx + 150}" cy="${cy}" r="40" fill="${skin}"/>
    <circle cx="${cx}" cy="${cy}" r="165" fill="${skin}"/>
    <path d="M ${cx - 20} ${cy - 160} q 30 -50 60 -20 q -30 -5 -25 25" fill="none" stroke="${line}" stroke-width="10" stroke-linecap="round"/>
    <path d="M ${cx - 75} ${cy - 5} q 22 18 44 0 M ${cx + 31} ${cy - 5} q 22 18 44 0" fill="none" stroke="${line}" stroke-width="9" stroke-linecap="round"/>
    <circle cx="${cx - 95}" cy="${cy + 45}" r="22" fill="#f0a99a" opacity="0.6"/><circle cx="${cx + 95}" cy="${cy + 45}" r="22" fill="#f0a99a" opacity="0.6"/>
    <path d="M ${cx - 32} ${cy + 60} q 32 30 64 0" fill="none" stroke="${line}" stroke-width="9" stroke-linecap="round"/>`;
}

/**
 * Whole cover as one SVG, for the browser only. With `photoHref` the photo is
 * clipped into the slot with CSS-like "cover" cropping; without it the
 * placeholder baby is shown. The server never uses this — it does the photo
 * step with sharp so it can smart-crop and output print resolution.
 */
export function previewSvg(tpl: CoverTemplate, text: CoverText, photoHref?: string, fonts?: CoverFonts): string {
  const { slot } = tpl;
  const inner = photoHref
    ? `<image href="${esc(photoHref)}" width="${slot.w}" height="${slot.h}" preserveAspectRatio="xMidYMid slice"/>`
    : placeholderBaby(slot, tpl);
  return svg(
    COVER_W,
    COVER_H,
    `<defs><clipPath id="slot"><path d="${slotPath(slot)}"/></clipPath></defs>
     <rect width="100%" height="100%" fill="${tpl.bg}"/>${decorations(tpl)}
     <g transform="translate(${slot.x} ${slot.y})" clip-path="url(#slot)">${inner}</g>
     ${overlay({ ...text, tpl, fonts })}`
  );
}

export const svgDataUrl = (s: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(s)}`;
