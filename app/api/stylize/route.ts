import { GeminiError } from '@/lib/ai/gemini';
import { stylize } from '@/lib/ai/stylize';
import { getStyle } from '@/lib/catalog';
import { clientIp, takeAiSlot } from '@/lib/rate-limit';
import { readPhoto } from '@/lib/upload';

/** Generation ~8 s, plus up to two retries on Google's 429/5xx (see lib/ai/gemini.ts). */
export const maxDuration = 120;

/** POST multipart { photo, style } → PNG. `x-placeholder: 1` while AI is faked. */
export async function POST(req: Request) {
  const form = await req.formData();
  const photo = await readPhoto(form);
  if (photo instanceof Response) return photo;

  const style = getStyle(String(form.get('style')));
  if (style.usesAi && process.env.AI_MODE === 'live') {
    const limited = takeAiSlot(clientIp(req));
    if (limited) return limited;
  }

  try {
    const { image, placeholder } = await stylize(photo, style.id, req.headers.get('x-vercel-oidc-token') ?? undefined);
    return new Response(new Uint8Array(image), {
      headers: { 'content-type': 'image/png', 'x-placeholder': placeholder ? '1' : '0' },
    });
  } catch (err) {
    console.error('[stylize]', (err as Error).message);
    if (err instanceof GeminiError) return Response.json({ error: err.userMessage }, { status: err.status });
    return Response.json({ error: 'Something went wrong creating the illustration' }, { status: 500 });
  }
}
