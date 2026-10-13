import { parse, type Font } from 'opentype.js';

import { COVER_H, COVER_W, type CoverTemplate, type PhotoSlot, type TemplateId } from './catalog';

/**
 * Cover artwork as SVG layers. The same functions feed both renderers: the
 * browser (thumbnails and live preview) and sharp on the server (print file),
 * so the preview matches what gets printed.
 */

export interface CoverText {
  title: string;
  babyName: string;
}

export const resolveTitle = (tpl: CoverTemplate, title: string) => title.trim() || tpl.defaultTitle;

// ---- fonts ---------------------------------------------------------------------

/**
 * Bundled fonts (public/fonts, SIL OFL). Text is drawn as glyph outlines rather
 * than SVG <text>, because servers have no fonts installed.
 */
export type FontKey = 'title' | 'subtitle' | 'hand' | 'caps';
export type CoverFonts = Record<FontKey, Font>;
export const FONT_FILES: Record<FontKey, string> = {
  title: 'title.ttf', // Fraunces SemiBold
  subtitle: 'subtitle.ttf', // Fraunces Italic
  hand: 'hand.ttf', // Caveat Medium
  caps: 'caps.ttf', // Nunito Bold
};

/** Parses every cover font; `read` supplies a file's bytes (disk on the server, fetch in the browser). */
export async function parseCoverFonts(read: (file: string) => ArrayBuffer | Promise<ArrayBuffer>): Promise<CoverFonts> {
  const keys = Object.keys(FONT_FILES) as FontKey[];
  const fonts = await Promise.all(keys.map(async (k) => parse(await read(FONT_FILES[k]))));
  return Object.fromEntries(keys.map((k, i) => [k, fonts[i]])) as CoverFonts;
}

/** System-font look-alikes for the browser's first paint, before the fonts load. */
const FALLBACK: Record<FontKey, string> = {
  title: `font-family="Georgia, serif" font-weight="700"`,
  subtitle: `font-family="Georgia, serif" font-style="italic"`,
  hand: `font-family="Segoe Print, Comic Sans MS, cursive"`,
  caps: `font-family="Verdana, sans-serif"`,
};

interface TextOpts {
  fill: string;
  opacity?: number;
  /** Letter spacing in em. */
  spacing?: number;
}

/**
 * Lays glyphs out one per character with pair kerning. font.getPath() isn't used
 * because opentype.js throws on some substitution tables (e.g. Nunito's).
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

/** One centred line of text at baseline `y`. */
function line(fonts: CoverFonts | undefined, key: FontKey, str: string, x: number, y: number, size: number, o: TextOpts) {
  const op = o.opacity === undefined ? '' : ` opacity="${o.opacity}"`;
  if (!fonts) {
    const ls = o.spacing ? ` letter-spacing="${o.spacing * size}"` : '';
    return `<text x="${x}" y="${y}" text-anchor="middle" ${FALLBACK[key]} font-size="${size}"${ls} fill="${o.fill}"${op}>${esc(str)}</text>`;
  }
  const { glyphs, xs, width } = layout(fonts[key], str, size, o.spacing);
  const left = x - width / 2;
  const d = glyphs.map((g, i) => g.getPath(left + xs[i], y, size).toPathData(2)).join('');
  return `<path d="${d}" fill="${o.fill}"${op}/>`;
}

/** Largest font size ≤ max at which `str` fits in `width`. */
function fitSize(fonts: CoverFonts | undefined, key: FontKey, str: string, max: number, width: number) {
  const w = fonts ? layout(fonts[key], str, max).width : str.length * max * 0.55;
  return Math.min(max, Math.floor((max * width) / Math.max(w, 1)));
}

// ---- shapes & helpers ----------------------------------------------------------

const CX = COVER_W / 2;

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const svg = (w: number, h: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;

/** Seeded pseudo-random points, so decorations are identical on every render. */
function scatter(seed: number, n: number) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  return Array.from({ length: n }, () => ({ x: rnd() * COVER_W, y: rnd() * COVER_H, r: rnd() }));
}

/** The slot outline in slot-local coordinates. */
function slotPath({ w, h, shape }: PhotoSlot): string {
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

const slotOutline = (slot: PhotoSlot, stroke: string, width: number) =>
  `<g transform="translate(${slot.x} ${slot.y})"><path d="${slotPath(slot)}" fill="none" stroke="${stroke}" stroke-width="${width}"/></g>`;

// ---- per-template artwork --------------------------------------------------------

interface TemplateArt {
  /** Drawn below the photo. */
  decorations(t: CoverTemplate): string;
  /** Drawn above the photo, around the slot. */
  frame(t: CoverTemplate, name: string, fonts?: CoverFonts): string;
}

const CONFETTI = ['#e88f7a', '#f2c46d', '#9cc5b0', '#a8b8e0'];
const LEAF_LIGHT = '#a9c39b';

const ART: Record<TemplateId, TemplateArt> = {
  'little-star': {
    decorations(t) {
      const stars = scatter(7, 70)
        .map(({ x, y, r }) => `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${(1.5 + r * 4).toFixed(1)}" fill="${t.ink}" opacity="${(0.35 + r * 0.6).toFixed(2)}"/>`)
        .join('');
      const sparkle = (x: number, y: number, s: number) =>
        `<path transform="translate(${x} ${y}) scale(${s})" d="M0 -30 C4 -6 6 -4 30 0 C6 4 4 6 0 30 C-4 6 -6 4 -30 0 C-6 -4 -4 -6 0 -30 Z" fill="${t.accent}"/>`;
      const moon = `<circle cx="1075" cy="105" r="52" fill="${t.accent}"/><circle cx="1098" cy="90" r="46" fill="${t.bg}"/>`;
      const hill = `<path d="M0 1340 Q 300 1270 600 1330 T 1200 1310 V 1500 H 0 Z" fill="${t.spine}"/>`;
      return stars + moon + sparkle(170, 420, 1.3) + sparkle(1040, 1000, 1) + sparkle(230, 1080, 0.7) + sparkle(960, 420, 0.6) + hill;
    },
    frame(t) {
      const { slot } = t;
      return (
        slotOutline(slot, t.ink, 10) +
        `<circle cx="${slot.x + slot.w / 2}" cy="${slot.y + slot.h / 2}" r="${slot.w / 2 + 28}" fill="none" stroke="${t.accent}" stroke-width="4" stroke-dasharray="2 16" stroke-linecap="round"/>`
      );
    },
  },

  'hello-world': {
    decorations(t) {
      const { slot } = t;
      const dots = scatter(3, 46)
        .map(({ x, y, r }, i) => `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${(5 + r * 9).toFixed(1)}" fill="${CONFETTI[i % 4]}" opacity="0.55"/>`)
        .join('');
      // Rainbow arcs hugging the top of the arch-shaped slot.
      const cx = slot.x + slot.w / 2;
      const cy = slot.y + slot.w / 2 + 60;
      const bands = CONFETTI.map((c, i) => {
        const r = slot.w / 2 + 90 - i * 22;
        return `<path d="M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}" fill="none" stroke="${c}" stroke-width="22" stroke-linecap="round"/>`;
      }).join('');
      return dots + bands;
    },
    frame: (t) => slotOutline(t.slot, '#fffaf6', 16),
  },

  'wild-one': {
    decorations(t) {
      const { slot } = t;
      const leaf = (x: number, y: number, rot: number, s: number, fill: string) =>
        `<path transform="translate(${x} ${y}) rotate(${rot}) scale(${s})" d="M0 0 C 40 -60 120 -60 160 0 C 120 60 40 60 0 0 Z M0 0 L160 0" fill="${fill}" stroke="${t.ink}" stroke-opacity="0.18" stroke-width="3"/>`;
      const leaves =
        leaf(-20, 120, 20, 1.6, t.accent) + leaf(40, 260, -10, 1.1, LEAF_LIGHT) +
        leaf(1220, 90, 150, 1.5, LEAF_LIGHT) + leaf(1200, 260, 200, 1.1, t.accent) +
        leaf(-30, 1380, -30, 1.7, t.accent) + leaf(1230, 1400, 210, 1.8, LEAF_LIGHT) + leaf(80, 1290, 10, 0.9, LEAF_LIGHT);
      // Polaroid card behind the photo, with room for a caption below it.
      const [w, h] = [slot.w + 68, slot.h + 150];
      const card = `<g transform="translate(${slot.x - 34} ${slot.y - 34})">
        <rect x="10" y="18" width="${w}" height="${h}" rx="14" fill="#000" opacity="0.12"/>
        <rect width="${w}" height="${h}" rx="14" fill="#fffdf8"/></g>`;
      return leaves + card;
    },
    frame(t, name, fonts) {
      const { slot } = t;
      return line(fonts, 'hand', name ? `${name}, day one` : 'day one', slot.x + slot.w / 2, slot.y + slot.h + 88, 58, { fill: t.ink });
    },
  },
};

// ---- layers ------------------------------------------------------------------------

const backgroundBody = (t: CoverTemplate) => `<rect width="100%" height="100%" fill="${t.bg}"/>${ART[t.id].decorations(t)}`;

function overlayBody(t: CoverTemplate, text: CoverText, fonts?: CoverFonts): string {
  const title = resolveTitle(t, text.title);
  const name = text.babyName.trim();
  const sub = name ? `The story of ${name}` : 'The story of you';
  return (
    ART[t.id].frame(t, name, fonts) +
    line(fonts, 'title', title, CX, 250, fitSize(fonts, 'title', title, 104, 1000), { fill: t.ink }) +
    line(fonts, 'subtitle', sub, CX, t.subtitleY, fitSize(fonts, 'subtitle', sub, 62, 900), { fill: t.ink }) +
    line(fonts, 'caps', 'A STORY MADE WITH LOVE', CX, t.footerY, 24, { fill: t.ink, opacity: 0.7, spacing: 0.3 })
  );
}

/** Server layer 1: everything below the photo. */
export const backgroundSvg = (t: CoverTemplate) => svg(COVER_W, COVER_H, backgroundBody(t));

/** Server layer 2: the slot shape in white, used to cut the photo out. */
export const maskSvg = (slot: PhotoSlot) => svg(slot.w, slot.h, `<path d="${slotPath(slot)}" fill="#fff"/>`);

/** Server layer 3: frame and text above the photo. */
export const overlaySvg = (t: CoverTemplate, text: CoverText, fonts: CoverFonts) => svg(COVER_W, COVER_H, overlayBody(t, text, fonts));

/** Friendly stand-in shown in the slot until a photo is uploaded. */
function placeholderBaby(t: CoverTemplate): string {
  const cx = t.slot.w / 2;
  const cy = t.slot.h / 2 + 20;
  const skin = '#f3d2bd';
  const ink = '#8a5a4a';
  const stroke = (w: number) => `fill="none" stroke="${ink}" stroke-width="${w}" stroke-linecap="round"`;
  return `<rect width="${t.slot.w}" height="${t.slot.h}" fill="${t.slotFill}"/>
    <ellipse cx="${cx}" cy="${cy + 250}" rx="230" ry="150" fill="${t.accent}" opacity="0.8"/>
    <circle cx="${cx - 150}" cy="${cy}" r="40" fill="${skin}"/><circle cx="${cx + 150}" cy="${cy}" r="40" fill="${skin}"/>
    <circle cx="${cx}" cy="${cy}" r="165" fill="${skin}"/>
    <path d="M ${cx - 20} ${cy - 160} q 30 -50 60 -20 q -30 -5 -25 25" ${stroke(10)}/>
    <path d="M ${cx - 75} ${cy - 5} q 22 18 44 0 M ${cx + 31} ${cy - 5} q 22 18 44 0" ${stroke(9)}/>
    <circle cx="${cx - 95}" cy="${cy + 45}" r="22" fill="#f0a99a" opacity="0.6"/><circle cx="${cx + 95}" cy="${cy + 45}" r="22" fill="#f0a99a" opacity="0.6"/>
    <path d="M ${cx - 32} ${cy + 60} q 32 30 64 0" ${stroke(9)}/>`;
}

/**
 * The whole cover as one SVG, for the browser preview. The photo (or the
 * placeholder) is clipped into the slot; the server instead does that step with
 * sharp to smart-crop and render at print size.
 */
export function previewSvg(t: CoverTemplate, text: CoverText, photoHref?: string, fonts?: CoverFonts): string {
  const { slot } = t;
  const inner = photoHref
    ? `<image href="${esc(photoHref)}" width="${slot.w}" height="${slot.h}" preserveAspectRatio="xMidYMid slice"/>`
    : placeholderBaby(t);
  return svg(
    COVER_W,
    COVER_H,
    `<defs><clipPath id="slot"><path d="${slotPath(slot)}"/></clipPath></defs>` +
      backgroundBody(t) +
      `<g transform="translate(${slot.x} ${slot.y})" clip-path="url(#slot)">${inner}</g>` +
      overlayBody(t, text, fonts)
  );
}

export const svgDataUrl = (s: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(s)}`;
