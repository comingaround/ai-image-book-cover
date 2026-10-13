import { getTemplate } from '@/lib/catalog';
import { composeCover } from '@/lib/compose';
import { pngResponse, respond } from '@/lib/http-error';
import { readUpload } from '@/lib/upload';

/** POST multipart { photo, templateId, title, babyName, scale? } → cover PNG (scale 2 = print size). */
export function POST(req: Request) {
  return respond('compose', { status: 422, message: 'Could not read that image' }, async () => {
    const { form, photo } = await readUpload(req);
    const field = (name: string) => String(form.get(name) ?? '');
    const png = await composeCover(
      photo,
      getTemplate(field('templateId')),
      { title: field('title'), babyName: field('babyName') },
      field('scale') === '2' ? 2 : 1
    );
    return pngResponse(png);
  });
}
