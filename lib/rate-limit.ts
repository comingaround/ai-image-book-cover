import 'server-only';

/**
 * Cheap guard for the public demo: each AI call is billed, and the URL is
 * shareable. In-memory, so it's per server instance and resets on cold start —
 * good enough to stop a bored visitor or a stuck retry loop, NOT a real quota.
 * Swap for Upstash/Vercel KV before real traffic.
 */
const PER_IP_PER_HOUR = Number(process.env.AI_LIMIT_PER_HOUR ?? 12);
const PER_INSTANCE_PER_DAY = Number(process.env.AI_LIMIT_PER_DAY ?? 300);

const g = globalThis as unknown as {
  babyBookHits?: Map<string, number[]>;
  babyBookDay?: { day: string; count: number };
};

export function clientIp(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'local';
}

/** Records the call and returns null, or returns a 429 Response when over a limit. */
export function takeAiSlot(ip: string): Response | null {
  const now = Date.now();
  const day = new Date(now).toISOString().slice(0, 10);
  g.babyBookDay = g.babyBookDay?.day === day ? g.babyBookDay : { day, count: 0 };
  if (g.babyBookDay.count >= PER_INSTANCE_PER_DAY) {
    return Response.json({ error: 'The demo has reached today’s illustration limit — please come back tomorrow.' }, { status: 429 });
  }

  g.babyBookHits ??= new Map();
  const recent = (g.babyBookHits.get(ip) ?? []).filter((t) => now - t < 3_600_000);
  if (recent.length >= PER_IP_PER_HOUR) {
    const mins = Math.ceil((3_600_000 - (now - recent[0])) / 60_000);
    return Response.json(
      { error: `You’ve made ${PER_IP_PER_HOUR} illustrations this hour — try again in ${mins} min, or pick “Original photo”.` },
      { status: 429 }
    );
  }
  recent.push(now);
  g.babyBookHits.set(ip, recent);
  g.babyBookDay.count++;
  return null;
}
