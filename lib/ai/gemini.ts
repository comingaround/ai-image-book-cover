import 'server-only';

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Minimal Gemini image client. Two ways in, first one configured wins:
 *
 *   1. GEMINI_API_KEY → Google AI Studio (generativelanguage.googleapis.com).
 *      Simplest for a deployed demo: one secret, no GCP setup.
 *   2. Vertex AI (VERTEX_PROJECT_ID) with, in order:
 *        - VERTEX_WORKLOAD_AUDIENCE + VERTEX_SERVICE_ACCOUNT_EMAIL → production on
 *          Vercel: keyless workload-identity federation (a Google workload
 *          identity pool trusting Vercel's OIDC tokens). Nothing secret in env.
 *        - VERTEX_ACCESS_TOKEN (a pasted `gcloud auth print-access-token`), or
 *        - VERTEX_USE_ADC=1 → the local `gcloud auth application-default login`.
 *
 * Both speak the same generateContent body, so only URL + auth header differ.
 */

const TOKEN_TIMEOUT_MS = 8_000;
const GENERATE_TIMEOUT_MS = 110_000;
/** Pauses before attempts 2–5. Pro-tier capacity is often busy for tens of seconds, so back off generously. */
const RETRY_DELAYS_MS = [3_000, 8_000, 15_000, 25_000];

export class GeminiError extends Error {
  constructor(
    message: string,
    /** Safe to show the customer (no internals). */
    readonly userMessage: string,
    readonly status = 502
  ) {
    super(message);
  }
}

const g = globalThis as unknown as { babyBookToken?: { token: string; expiresAt: number } };

function adcPath(): string {
  return process.env.APPDATA
    ? join(process.env.APPDATA, 'gcloud', 'application_default_credentials.json')
    : join(process.env.HOME ?? '', '.config', 'gcloud', 'application_default_credentials.json');
}

const RELOGIN = 'run `gcloud.cmd auth application-default login` and try again';

async function adcToken(): Promise<string> {
  if (g.babyBookToken && g.babyBookToken.expiresAt > Date.now()) return g.babyBookToken.token;

  const path = adcPath();
  if (!existsSync(path)) throw new GeminiError(`No gcloud login on this machine — ${RELOGIN}`, 'AI is not configured');
  const cred = JSON.parse(readFileSync(path, 'utf8')) as {
    type?: string;
    client_id?: string;
    client_secret?: string;
    refresh_token?: string;
  };
  if (cred.type !== 'authorized_user' || !cred.refresh_token) {
    throw new GeminiError(`Unsupported ADC credential type "${cred.type}"`, 'AI is not configured');
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: cred.client_id ?? '',
      client_secret: cred.client_secret ?? '',
      refresh_token: cred.refresh_token,
    }),
    signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
  });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !json.access_token) {
    throw new GeminiError(
      `gcloud login refresh failed (${json.error ?? res.status}) — ${RELOGIN}`,
      'AI is temporarily unavailable'
    );
  }
  g.babyBookToken = { token: json.access_token, expiresAt: Date.now() + ((json.expires_in ?? 3600) - 300) * 1000 };
  return json.access_token;
}

const CLOUD_PLATFORM = 'https://www.googleapis.com/auth/cloud-platform';

/**
 * Vercel OIDC token → Google STS federated token → short-lived token for the
 * service account. The pool only admits tokens whose subject is this Vercel
 * project's PRODUCTION environment, so preview deployments can't sign in.
 */
async function federatedToken(oidcToken: string | undefined): Promise<string> {
  if (g.babyBookToken && g.babyBookToken.expiresAt > Date.now()) return g.babyBookToken.token;

  const audience = process.env.VERTEX_WORKLOAD_AUDIENCE!;
  const serviceAccount = process.env.VERTEX_SERVICE_ACCOUNT_EMAIL!;
  const subjectToken = oidcToken || process.env.VERCEL_OIDC_TOKEN;
  if (!subjectToken) throw new GeminiError('No Vercel OIDC token on the request', 'AI is not configured');

  const signal = AbortSignal.timeout(TOKEN_TIMEOUT_MS);
  const sts = await fetch('https://sts.googleapis.com/v1/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      audience,
      grantType: 'urn:ietf:params:oauth:grant-type:token-exchange',
      requestedTokenType: 'urn:ietf:params:oauth:token-type:access_token',
      scope: CLOUD_PLATFORM,
      subjectTokenType: 'urn:ietf:params:oauth:token-type:jwt',
      subjectToken,
    }),
    signal,
  });
  const federated = (await sts.json().catch(() => ({}))) as { access_token?: string };
  if (!sts.ok || !federated.access_token) {
    throw new GeminiError(`Google STS refused the Vercel OIDC token (HTTP ${sts.status})`, 'AI is temporarily unavailable');
  }

  const imp = await fetch(
    `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(serviceAccount)}:generateAccessToken`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${federated.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: [CLOUD_PLATFORM] }),
      signal,
    }
  );
  const minted = (await imp.json().catch(() => ({}))) as { accessToken?: string; expireTime?: string };
  if (!imp.ok || !minted.accessToken) {
    throw new GeminiError(`Impersonating ${serviceAccount} failed (HTTP ${imp.status})`, 'AI is temporarily unavailable');
  }
  const exp = Date.parse(minted.expireTime ?? '');
  g.babyBookToken = { token: minted.accessToken, expiresAt: Number.isFinite(exp) ? exp - 300_000 : Date.now() + 3_300_000 };
  return minted.accessToken;
}

async function endpoint(model: string, oidcToken?: string): Promise<{ url: string; headers: Record<string, string> }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (apiKey) {
    return {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      headers: { 'x-goog-api-key': apiKey },
    };
  }

  const project = process.env.VERTEX_PROJECT_ID;
  if (!project) throw new GeminiError('Set GEMINI_API_KEY or VERTEX_PROJECT_ID', 'AI is not configured');
  // Gemini image models are served from the global endpoint.
  const location = process.env.VERTEX_LOCATION || 'global';
  const host = location === 'global' ? 'aiplatform.googleapis.com' : `${location}-aiplatform.googleapis.com`;
  const token =
    process.env.VERTEX_WORKLOAD_AUDIENCE && process.env.VERTEX_SERVICE_ACCOUNT_EMAIL
      ? await federatedToken(oidcToken)
      : process.env.VERTEX_ACCESS_TOKEN || (process.env.VERTEX_USE_ADC === '1' ? await adcToken() : null);
  if (!token) throw new GeminiError('No Vertex credential configured', 'AI is not configured');

  return {
    url: `https://${host}/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:generateContent`,
    headers: { Authorization: `Bearer ${token}` },
  };
}

interface Part {
  text?: string;
  inlineData?: { mimeType: string; data: string };
  inline_data?: { mime_type: string; data: string };
}

interface Envelope {
  candidates?: { content?: { parts?: Part[] }; finishReason?: string; finishMessage?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: unknown;
  error?: { message?: string; status?: string };
}

/**
 * Image + instruction in, one image out. Throws GeminiError with a
 * customer-safe message when the model refuses or returns no image.
 */
export async function editImage(
  image: Buffer,
  mimeType: string,
  prompt: string,
  /** Vercel's per-request `x-vercel-oidc-token` header, for workload identity. */
  oidcToken?: string
): Promise<Buffer> {
  const model = process.env.GEMINI_IMAGE_MODEL || 'gemini-3-pro-image';
  const { url, headers } = await endpoint(model, oidcToken);
  const started = Date.now();

  /*
   * 429 = Google's shared on-demand capacity is busy, 5xx = their side broke.
   * Neither says anything about OUR request, so asking again shortly after is
   * the documented remedy. Any other status is our request — retrying won't help.
   */
  const body = JSON.stringify({
    contents: [
      {
        role: 'user',
        parts: [{ inlineData: { mimeType, data: image.toString('base64') } }, { text: prompt }],
      },
    ],
    // No aspectRatio: for an edit the model keeps the input photo's shape, so nothing gets cropped or invented.
    generationConfig: { responseModalities: ['IMAGE'] },
  });
  const deadline = started + GENERATE_TIMEOUT_MS;

  let res: Response | undefined;
  for (let attempt = 1; ; attempt++) {
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body,
        signal: AbortSignal.timeout(Math.max(deadline - Date.now(), 1_000)),
      });
    } catch (err) {
      const timedOut = (err as { name?: string }).name === 'TimeoutError';
      throw new GeminiError(
        timedOut ? `${model} timed out after ${GENERATE_TIMEOUT_MS / 1000}s` : `${model} unreachable: ${err}`,
        timedOut ? 'The illustration took too long — please try again' : 'AI is temporarily unavailable',
        504
      );
    }
    const retryable = res.status === 429 || res.status >= 500;
    const wait = RETRY_DELAYS_MS[attempt - 1];
    // A retry only starts with enough deadline left for a typical ~8 s generation.
    if (!retryable || wait === undefined || deadline - Date.now() < wait + 15_000) break;
    console.warn(`[gemini] ${model} HTTP ${res.status} on attempt ${attempt}, retrying in ${wait}ms`);
    await new Promise((r) => setTimeout(r, wait));
  }

  const env = (await res.json().catch(() => ({}))) as Envelope;
  console.log(`[gemini] ${model} ${res.status} ${Date.now() - started}ms usage=${JSON.stringify(env.usageMetadata ?? null)}`);

  if (!res.ok) {
    const busy = res.status === 429 || res.status >= 500;
    throw new GeminiError(
      `${model} HTTP ${res.status}: ${env.error?.message ?? 'no body'}`,
      busy ? 'The AI is busy right now — please try again in a moment' : 'The AI could not process this photo',
      busy ? 503 : 502
    );
  }

  const cand = env.candidates?.[0];
  for (const part of cand?.content?.parts ?? []) {
    const data = part.inlineData?.data ?? part.inline_data?.data;
    if (data) return Buffer.from(data, 'base64');
  }

  const reason = env.promptFeedback?.blockReason ?? cand?.finishReason ?? 'NO_IMAGE';
  const said = cand?.content?.parts?.map((p) => p.text).filter(Boolean).join(' ');
  throw new GeminiError(
    `${model} returned no image (reason ${reason})${said ? `: ${said}` : ''}${cand?.finishMessage ? ` — ${cand.finishMessage}` : ''}`,
    /SAFETY|PROHIBITED|BLOCK|IMAGE_OTHER/.test(reason)
      ? "The AI couldn't illustrate this photo. Try a different photo, or choose \"Original photo\"."
      : 'The AI did not return an illustration — please try again',
    422
  );
}
