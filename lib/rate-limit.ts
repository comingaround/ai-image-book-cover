import 'server-only';

import { headers } from 'next/headers';

import { HttpError } from './http-error';

/**
 * Guard for the public demo, where every AI call is billed. In-memory, so it is
 * per server instance and resets on cold start; use a shared store (e.g. Redis)
 * for a real quota.
 */
const PER_IP_PER_HOUR = Number(process.env.AI_LIMIT_PER_HOUR ?? 12);
const PER_INSTANCE_PER_DAY = Number(process.env.AI_LIMIT_PER_DAY ?? 300);
const HOUR = 3_600_000;

const g = globalThis as unknown as {
  aiHits?: Map<string, number[]>;
  aiDay?: { day: string; count: number };
};

async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || 'local';
}

/** Counts one AI call for the current visitor, or throws a 429 when over a limit. */
export async function takeAiSlot(): Promise<void> {
  const now = Date.now();
  const day = new Date(now).toISOString().slice(0, 10);
  if (g.aiDay?.day !== day) g.aiDay = { day, count: 0 };
  if (g.aiDay.count >= PER_INSTANCE_PER_DAY) {
    throw new HttpError(429, 'The demo has reached today’s illustration limit — please come back tomorrow.');
  }

  const ip = await clientIp();
  g.aiHits ??= new Map();
  const recent = (g.aiHits.get(ip) ?? []).filter((t) => now - t < HOUR);
  if (recent.length >= PER_IP_PER_HOUR) {
    const mins = Math.ceil((HOUR - (now - recent[0])) / 60_000);
    throw new HttpError(
      429,
      `You’ve made ${PER_IP_PER_HOUR} illustrations this hour — try again in ${mins} min, or pick “Original photo”.`
    );
  }
  g.aiHits.set(ip, [...recent, now]);
  g.aiDay.count++;
}
