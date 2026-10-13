import 'server-only';

import { MAX_UPLOAD_BYTES } from './catalog';
import { HttpError } from './http-error';

/** Reads the multipart body and returns it with the `photo` field as a Buffer. */
export async function readUpload(req: Request): Promise<{ form: FormData; photo: Buffer }> {
  const form = await req.formData();
  const file = form.get('photo');
  if (!(file instanceof File) || file.size === 0) throw new HttpError(400, 'No photo uploaded');
  if (file.size > MAX_UPLOAD_BYTES) throw new HttpError(413, `Photo is larger than ${MAX_UPLOAD_BYTES >> 20} MB`);
  if (!file.type.startsWith('image/')) throw new HttpError(415, 'That file is not an image');
  return { form, photo: Buffer.from(await file.arrayBuffer()) };
}
