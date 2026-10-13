import 'server-only';

import sharp from 'sharp';

import { COVER_H, COVER_W, type CoverTemplate } from './catalog';
import { backgroundSvg, maskSvg, overlaySvg, type CoverText } from './cover-svg';
import { serverFonts } from './fonts-server';

/**
 * The "drop the baby on the book" step — pure image processing, zero AI cost.
 *
 *   background SVG ──┐
 *   photo → smart-crop to slot → mask to slot shape ──┼──► flattened PNG
 *   overlay SVG (frame + title) ──┘
 *
 * `position: attention` makes sharp crop toward the most salient region
 * (usually the face) instead of the dead centre.
 */
export async function composeCover(
  photo: Buffer,
  tpl: CoverTemplate,
  text: CoverText,
  scale = 1
): Promise<Buffer> {
  const W = Math.round(COVER_W * scale);
  const H = Math.round(COVER_H * scale);
  const { slot } = tpl;
  const sw = Math.round(slot.w * scale);
  const sh = Math.round(slot.h * scale);

  const renderSvg = (s: string, w: number, h: number) =>
    sharp(Buffer.from(s), { density: 72 * scale }).resize(w, h).png().toBuffer();

  const [bg, mask, top] = await Promise.all([
    renderSvg(backgroundSvg(tpl), W, H),
    renderSvg(maskSvg(slot), sw, sh),
    renderSvg(overlaySvg(tpl, text, serverFonts()), W, H),
  ]);

  const cutout = await sharp(photo)
    .rotate() // honour phone EXIF orientation
    .resize(sw, sh, { fit: 'cover', position: sharp.strategy.attention })
    .ensureAlpha()
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer();

  return sharp(bg)
    .composite([
      { input: cutout, left: Math.round(slot.x * scale), top: Math.round(slot.y * scale) },
      { input: top, left: 0, top: 0 },
    ])
    .png()
    .toBuffer();
}
