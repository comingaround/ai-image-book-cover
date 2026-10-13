import 'server-only';

import sharp from 'sharp';

import type { StyleId } from '../catalog';
import { editImage } from './gemini';

/**
 * Turning the uploaded photo into an illustration — the ONLY step that will cost
 * money. Everything else (cropping, masking, placing on the cover) is sharp.
 *
 * AI_MODE=live: `geminiStylize` sends the photo + STYLE_PROMPTS[style] to Nano
 * Banana (GEMINI_IMAGE_MODEL) and returns its image.
 * AI_MODE=placeholder: `placeholderStylize` fakes each style with plain filters
 * — free, for UI work.
 */

/**
 * A style transfer, NOT a re-imagining. Deliberately names no subject ("baby",
 * "person"…): naming one makes the model redraw the photo AS that subject — an
 * adult came back as an invented baby. Whatever is in the photo stays as it is;
 * the cover script smart-crops afterwards, so layout is never touched here.
 */
const KEEP_EVERYTHING =
  'Keep the same composition, layout, framing and crop, with every subject in the same place, pose and expression ' +
  'and instantly recognisable. Do not add or remove anything. No text, letters, borders or watermarks.';

/**
 * The style is the part that MUST change, so it leads and is spelled out. Asking
 * to keep the subject's "exact appearance" made the model treat repainting as a
 * change it wasn't allowed to make — watercolor/storybook came back as photos.
 */
const restyle = (style: string, look: string) =>
  `Transform this image into a ${style}. Repaint every part of it by hand: ${look}. ` +
  `It must not look like a photo anywhere. ${KEEP_EVERYTHING}`;

export const STYLE_PROMPTS: Record<Exclude<StyleId, 'original'>, string> = {
  watercolor: restyle(
    "hand-painted watercolor illustration from a children's book",
    'loose transparent watercolor washes, soft bleeding edges, pigment pooling, visible paper grain, simplified detail'
  ),
  storybook: restyle(
    'classic gouache picture-book illustration',
    'flat opaque gouache colour shapes, simplified rounded forms, visible brush strokes, warm storybook palette, like a printed picture book'
  ),
  sketch: restyle(
    'graphite pencil drawing on white paper',
    'confident graphite pencil lines, cross-hatched shading, white paper showing through'
  ),
};

export interface StylizeResult {
  image: Buffer;
  placeholder: boolean;
}

export async function stylize(photo: Buffer, style: StyleId, oidcToken?: string): Promise<StylizeResult> {
  if (style === 'original') {
    return { image: await sharp(photo).rotate().png().toBuffer(), placeholder: false };
  }
  if (process.env.AI_MODE === 'live') {
    return { image: await geminiStylize(photo, style, oidcToken), placeholder: false };
  }
  return { image: await placeholderStylize(photo, style), placeholder: true };
}

/** Filter-based stand-ins, deliberately close enough to judge the layout. */
async function placeholderStylize(photo: Buffer, style: Exclude<StyleId, 'original'>): Promise<Buffer> {
  const base = sharp(photo).rotate().resize(1024, 1024, { fit: 'inside', withoutEnlargement: true });
  await new Promise((r) => setTimeout(r, 1200)); // feel the wait the real model will have

  if (style === 'sketch') {
    const grey = await base.greyscale().toBuffer();
    return sharp(grey)
      .convolve({ width: 3, height: 3, kernel: [-1, -1, -1, -1, 8, -1, -1, -1, -1] })
      .negate()
      .normalise()
      .gamma(2.2)
      .png()
      .toBuffer();
  }
  if (style === 'watercolor') {
    return base.median(9).modulate({ saturation: 1.25, brightness: 1.08 }).blur(1.2).png().toBuffer();
  }
  return base.median(5).modulate({ saturation: 1.45, brightness: 1.03 }).linear(1.12, -10).png().toBuffer();
}

/** The real thing: Nano Banana repaints the photo, we normalise it to PNG. */
async function geminiStylize(photo: Buffer, style: Exclude<StyleId, 'original'>, oidcToken?: string): Promise<Buffer> {
  // Upright, ≤1536 px JPEG: phone photos are 4–12 MB and the model gains nothing from more pixels.
  const input = await sharp(photo)
    .rotate()
    .resize(1536, 1536, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 90 })
    .toBuffer();
  const out = await editImage(input, 'image/jpeg', STYLE_PROMPTS[style], oidcToken);
  return sharp(out).png().toBuffer();
}
