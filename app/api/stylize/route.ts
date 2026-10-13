import { stylize } from '@/lib/ai/stylize';
import { getStyle } from '@/lib/catalog';
import { pngResponse, respond } from '@/lib/http-error';
import { readUpload } from '@/lib/upload';

/** A generation takes ~20 s, plus retries while Google's capacity is busy. */
export const maxDuration = 120;

/** POST multipart { photo, style } → PNG illustration (`x-placeholder: 1` when AI is faked). */
export function POST(req: Request) {
  return respond('stylize', { status: 500, message: 'Something went wrong creating the illustration' }, async () => {
    const { form, photo } = await readUpload(req);
    const { image, placeholder } = await stylize(photo, getStyle(String(form.get('style'))).id);
    return pngResponse(image, { 'x-placeholder': placeholder ? '1' : '0' });
  });
}
