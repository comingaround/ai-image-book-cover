import { getTemplate } from '@/lib/catalog';
import { composeCover } from '@/lib/compose';
import { readPhoto } from '@/lib/upload';

/**
 * POST multipart { photo, templateId, title, babyName, scale? } → cover PNG.
 * scale 1 = 1200×1500 screen preview, scale 2 = 2400×3000 (8×10 in @ 300 dpi).
 */
export async function POST(req: Request) {
  const form = await req.formData();
  const photo = await readPhoto(form);
  if (photo instanceof Response) return photo;

  const scale = Number(form.get('scale')) === 2 ? 2 : 1;
  try {
    const png = await composeCover(
      photo,
      getTemplate(String(form.get('templateId'))),
      { title: String(form.get('title') ?? ''), babyName: String(form.get('babyName') ?? '') },
      scale
    );
    return new Response(new Uint8Array(png), { headers: { 'content-type': 'image/png' } });
  } catch (err) {
    console.error('[compose]', err);
    return Response.json({ error: 'Could not read that image' }, { status: 422 });
  }
}
