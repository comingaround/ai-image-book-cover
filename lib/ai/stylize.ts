import 'server-only';

import sharp from 'sharp';

import { getStyle, type StyleId } from '../catalog';
import { takeAiSlot } from '../rate-limit';
import { editImage } from './gemini';

/** AI_MODE=live calls Gemini; anything else uses free filter stand-ins for UI work. */
export const aiLive = () => process.env.AI_MODE === 'live';

/**
 * Style transfer, not re-imagining: the prompts never name the subject, because
 * naming one ("a baby") makes the model redraw the photo as that subject. The
 * style itself is phrased as a hard requirement, otherwise the model keeps the
 * photo nearly untouched.
 */
const KEEP =
  'Keep the same composition, layout, framing and crop, with every subject in the same place, pose and expression ' +
  'and instantly recognisable. Do not add or remove anything. No text, letters, borders or watermarks.';

const restyle = (style: string, look: string) =>
  `Transform this image into a ${style}. Repaint every part of it by hand: ${look}. ` +
  `It must not look like a photo anywhere. ${KEEP}`;

const PROMPTS: Partial<Record<StyleId, string>> = {
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

/** EXIF-rotated and no larger than `max` px on its longest side. */
const upright = (photo: Buffer, max: number) =>
  sharp(photo).rotate().resize(max, max, { fit: 'inside', withoutEnlargement: true });

export async function stylize(photo: Buffer, styleId: StyleId): Promise<{ image: Buffer; placeholder: boolean }> {
  const prompt = PROMPTS[styleId];
  if (!getStyle(styleId).usesAi || !prompt) {
    // Even unstyled, downscale: the cover slot needs at most ~1300 px at print size.
    return { image: await upright(photo, 1600).png().toBuffer(), placeholder: false };
  }
  if (!aiLive()) return { image: await placeholderStylize(photo, styleId), placeholder: true };

  await takeAiSlot();
  const input = await upright(photo, 1536).jpeg({ quality: 90 }).toBuffer();
  const out = await editImage(input, 'image/jpeg', prompt);
  return { image: await sharp(out).png().toBuffer(), placeholder: false };
}

/** Rough filter imitations of each style, good enough to judge the layout. */
async function placeholderStylize(photo: Buffer, styleId: StyleId): Promise<Buffer> {
  const base = upright(photo, 1024);
  await new Promise((r) => setTimeout(r, 1200)); // simulate the model's wait

  if (styleId === 'sketch') {
    const grey = await base.greyscale().toBuffer();
    return sharp(grey)
      .convolve({ width: 3, height: 3, kernel: [-1, -1, -1, -1, 8, -1, -1, -1, -1] }) // edge detection
      .negate()
      .normalise()
      .gamma(2.2)
      .png()
      .toBuffer();
  }
  if (styleId === 'watercolor') {
    return base.median(9).modulate({ saturation: 1.25, brightness: 1.08 }).blur(1.2).png().toBuffer();
  }
  return base.median(5).modulate({ saturation: 1.45, brightness: 1.03 }).linear(1.12, -10).png().toBuffer();
}
