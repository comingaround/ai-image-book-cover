import 'server-only';

const MAX_BYTES = 15 * 1024 * 1024;

/** The `photo` field as a Buffer, or a 400 Response explaining why not. */
export async function readPhoto(form: FormData): Promise<Buffer | Response> {
  const file = form.get('photo');
  if (!(file instanceof File) || file.size === 0) {
    return Response.json({ error: 'No photo uploaded' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ error: 'Photo is larger than 15 MB' }, { status: 413 });
  }
  if (!file.type.startsWith('image/')) {
    return Response.json({ error: 'That file is not an image' }, { status: 415 });
  }
  return Buffer.from(await file.arrayBuffer());
}
