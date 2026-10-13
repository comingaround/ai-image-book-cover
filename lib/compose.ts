import 'server-only';

import sharp from 'sharp';

import { COVER_H, COVER_W, type CoverTemplate } from './catalog';
import { backgroundSvg, maskSvg, overlaySvg, type CoverText } from './cover-svg';
import { serverFonts } from './fonts-server';

/**
 * Places the illustration on the cover — plain image processing, no AI:
 * background, then the photo cropped and cut to the slot shape, then frame + text.
 */

const renderSvg = (s: string, w: number, h: number, scale: number) =>
  sharp(Buffer.from(s), { density: 72 * scale }).resize(w, h).png().toBuffer();

/** Background and mask depend only on template + scale, so render each once. */
const staticLayers = new Map<string, Promise<[Buffer, Buffer]>>();

function templateLayers(t: CoverTemplate, scale: number): Promise<[Buffer, Buffer]> {
  const key = `${t.id}@${scale}`;
  let layers = staticLayers.get(key);
  if (!layers) {
    const s = (n: number) => Math.round(n * scale);
    layers = Promise.all([
      renderSvg(backgroundSvg(t), s(COVER_W), s(COVER_H), scale),
      renderSvg(maskSvg(t.slot), s(t.slot.w), s(t.slot.h), scale),
    ]);
    layers.catch(() => staticLayers.delete(key));
    staticLayers.set(key, layers);
  }
  return layers;
}

export async function composeCover(photo: Buffer, t: CoverTemplate, text: CoverText, scale = 1): Promise<Buffer> {
  const s = (n: number) => Math.round(n * scale);
  const [[background, mask], overlay] = await Promise.all([
    templateLayers(t, scale),
    serverFonts().then((fonts) => renderSvg(overlaySvg(t, text, fonts), s(COVER_W), s(COVER_H), scale)),
  ]);

  // `attention` crops toward the most eye-catching region (usually the face).
  const cutout = await sharp(photo)
    .rotate()
    .resize(s(t.slot.w), s(t.slot.h), { fit: 'cover', position: sharp.strategy.attention })
    .ensureAlpha()
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer();

  return sharp(background)
    .composite([
      { input: cutout, left: s(t.slot.x), top: s(t.slot.y) },
      { input: overlay, left: 0, top: 0 },
    ])
    .png()
    .toBuffer();
}
