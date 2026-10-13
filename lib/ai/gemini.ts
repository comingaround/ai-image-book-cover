import 'server-only';

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { headers } from 'next/headers';

import { HttpError } from '../http-error';

/**
 * Minimal Gemini image client. Auth, first configured wins:
 *   1. GEMINI_API_KEY — Google AI Studio.
 *   2. Vertex AI (VERTEX_PROJECT_ID), with one of:
 *      - VERTEX_WORKLOAD_AUDIENCE + VERTEX_SERVICE_ACCOUNT_EMAIL: keyless sign-in on
 *        Vercel (workload identity federation using Vercel's OIDC token)
 *      - VERTEX_ACCESS_TOKEN: a pasted `gcloud auth print-access-token`
 *      - VERTEX_USE_ADC=1: the local `gcloud auth application-default login`
 */

const TOKEN_TIMEOUT_MS = 8_000;
const GENERATE_TIMEOUT_MS = 110_000;
/** Back-off before attempts 2–5; image-model capacity is often busy for tens of seconds. */
const RETRY_DELAYS_MS = [3_000, 8_000, 15_000, 25_000];
const CLOUD_PLATFORM = 'https://www.googleapis.com/auth/cloud-platform';
const NOT_CONFIGURED = 'AI is not configured';
const UNAVAILABLE = 'AI is temporarily unavailable';

class GeminiError extends HttpError {
  constructor(logMessage: string, userMessage: string, status = 502) {
    super(status, userMessage, logMessage);
  }
}

/** Google's capacity is busy (429) or failing (5xx): worth asking again. */
const isTransient = (status: number) => status === 429 || status >= 500;

// ---- access tokens ---------------------------------------------------------

interface Token {
  token: string;
  expiresAt: number;
}

const g = globalThis as unknown as { geminiToken?: Token };

/** Reuses the current token until 5 minutes before it expires. */
async function cachedToken(mint: () => Promise<Token>): Promise<string> {
  if (!g.geminiToken || g.geminiToken.expiresAt <= Date.now()) g.geminiToken = await mint();
  return g.geminiToken.token;
}

const expiresIn = (seconds = 3600): number => Date.now() + (seconds - 300) * 1000;

/** POST to a Google token endpoint and return the JSON, or throw with `what` in the log. */
async function postForToken<T>(url: string, init: RequestInit, what: string): Promise<T> {
  const res = await fetch(url, { method: 'POST', ...init, signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS) });
  const json = (await res.json().catch(() => ({}))) as T & { error?: unknown };
  if (!res.ok) throw new GeminiError(`${what} failed (HTTP ${res.status}): ${JSON.stringify(json.error ?? '')}`, UNAVAILABLE);
  return json;
}

function adcPath(): string {
  return process.env.APPDATA
    ? join(process.env.APPDATA, 'gcloud', 'application_default_credentials.json')
    : join(process.env.HOME ?? '', '.config', 'gcloud', 'application_default_credentials.json');
}

/** Local development: refresh the gcloud application-default login. */
async function adcToken(): Promise<Token> {
  const path = adcPath();
  if (!existsSync(path)) throw new GeminiError('No gcloud login — run `gcloud auth application-default login`', NOT_CONFIGURED);
  const cred = JSON.parse(readFileSync(path, 'utf8')) as Record<string, string | undefined>;
  if (cred.type !== 'authorized_user' || !cred.refresh_token) {
    throw new GeminiError(`Unsupported ADC credential type "${cred.type}"`, NOT_CONFIGURED);
  }
  const json = await postForToken<{ access_token: string; expires_in?: number }>(
    'https://oauth2.googleapis.com/token',
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: cred.client_id ?? '',
        client_secret: cred.client_secret ?? '',
        refresh_token: cred.refresh_token,
      }),
    },
    'gcloud login refresh'
  );
  return { token: json.access_token, expiresAt: expiresIn(json.expires_in) };
}

/**
 * Production on Vercel: exchange the request's Vercel OIDC token for a Google
 * federated token, then for a short-lived token of the service account.
 */
async function federatedToken(): Promise<Token> {
  const subjectToken = (await headers()).get('x-vercel-oidc-token') ?? process.env.VERCEL_OIDC_TOKEN;
  if (!subjectToken) throw new GeminiError('No Vercel OIDC token on the request', NOT_CONFIGURED);

  const federated = await postForToken<{ access_token: string }>(
    'https://sts.googleapis.com/v1/token',
    {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audience: process.env.VERTEX_WORKLOAD_AUDIENCE,
        grantType: 'urn:ietf:params:oauth:grant-type:token-exchange',
        requestedTokenType: 'urn:ietf:params:oauth:token-type:access_token',
        scope: CLOUD_PLATFORM,
        subjectTokenType: 'urn:ietf:params:oauth:token-type:jwt',
        subjectToken,
      }),
    },
    'Google STS token exchange'
  );

  const account = encodeURIComponent(process.env.VERTEX_SERVICE_ACCOUNT_EMAIL!);
  const minted = await postForToken<{ accessToken: string; expireTime?: string }>(
    `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${account}:generateAccessToken`,
    {
      headers: { Authorization: `Bearer ${federated.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: [CLOUD_PLATFORM] }),
    },
    'Service account impersonation'
  );
  const exp = Date.parse(minted.expireTime ?? '');
  return { token: minted.accessToken, expiresAt: Number.isFinite(exp) ? exp - 300_000 : expiresIn() };
}

async function endpoint(model: string): Promise<{ url: string; headers: Record<string, string> }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (apiKey) {
    return {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      headers: { 'x-goog-api-key': apiKey },
    };
  }

  const project = process.env.VERTEX_PROJECT_ID;
  if (!project) throw new GeminiError('Set GEMINI_API_KEY or VERTEX_PROJECT_ID', NOT_CONFIGURED);
  const location = process.env.VERTEX_LOCATION || 'global';
  const host = location === 'global' ? 'aiplatform.googleapis.com' : `${location}-aiplatform.googleapis.com`;

  let token: string | undefined;
  if (process.env.VERTEX_WORKLOAD_AUDIENCE && process.env.VERTEX_SERVICE_ACCOUNT_EMAIL) token = await cachedToken(federatedToken);
  else if (process.env.VERTEX_ACCESS_TOKEN) token = process.env.VERTEX_ACCESS_TOKEN;
  else if (process.env.VERTEX_USE_ADC === '1') token = await cachedToken(adcToken);
  if (!token) throw new GeminiError('No Vertex credential configured', NOT_CONFIGURED);

  return {
    url: `https://${host}/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:generateContent`,
    headers: { Authorization: `Bearer ${token}` },
  };
}

// ---- image edit --------------------------------------------------------------

interface Part {
  text?: string;
  inlineData?: { mimeType: string; data: string };
  inline_data?: { mime_type: string; data: string };
}

interface Envelope {
  candidates?: { content?: { parts?: Part[] }; finishReason?: string; finishMessage?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: unknown;
  error?: { message?: string };
}

/** Image + instruction in, one image out. */
export async function editImage(image: Buffer, mimeType: string, prompt: string): Promise<Buffer> {
  const model = process.env.GEMINI_IMAGE_MODEL || 'gemini-3-pro-image';
  const { url, headers: auth } = await endpoint(model);
  const started = Date.now();
  const deadline = started + GENERATE_TIMEOUT_MS;
  const body = JSON.stringify({
    contents: [{ role: 'user', parts: [{ inlineData: { mimeType, data: image.toString('base64') } }, { text: prompt }] }],
    // No aspectRatio: for an edit the model keeps the input's shape.
    generationConfig: { responseModalities: ['IMAGE'] },
  });

  let res: Response;
  for (let attempt = 1; ; attempt++) {
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth },
        body,
        signal: AbortSignal.timeout(Math.max(deadline - Date.now(), 1_000)),
      });
    } catch (err) {
      const timedOut = (err as { name?: string }).name === 'TimeoutError';
      throw new GeminiError(
        timedOut ? `${model} timed out` : `${model} unreachable: ${err}`,
        timedOut ? 'The illustration took too long — please try again' : UNAVAILABLE,
        504
      );
    }
    const wait = RETRY_DELAYS_MS[attempt - 1];
    // Retry only while there's time left for a full generation afterwards.
    if (!isTransient(res.status) || wait === undefined || deadline - Date.now() < wait + 15_000) break;
    console.warn(`[gemini] ${model} HTTP ${res.status} on attempt ${attempt}, retrying in ${wait}ms`);
    await new Promise((r) => setTimeout(r, wait));
  }

  const env = (await res.json().catch(() => ({}))) as Envelope;
  console.log(`[gemini] ${model} ${res.status} ${Date.now() - started}ms usage=${JSON.stringify(env.usageMetadata ?? null)}`);

  if (!res.ok) {
    const busy = isTransient(res.status);
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
  throw new GeminiError(
    `${model} returned no image (reason ${reason})${cand?.finishMessage ? `: ${cand.finishMessage}` : ''}`,
    /SAFETY|PROHIBITED|BLOCK|IMAGE_OTHER/.test(reason)
      ? 'The AI couldn\'t illustrate this photo. Try a different photo, or choose "Original photo".'
      : 'The AI did not return an illustration — please try again',
    422
  );
}
