'use client';

import { Fragment, useRef, useState, type CSSProperties } from 'react';

import type { BookFormat, FormatId } from '@/lib/catalog';

interface Props {
  coverSrc: string;
  format: BookFormat;
  spineColor: string;
  spineText?: string;
  /** Width of the front cover in px; everything else scales from it. */
  width?: number;
  /** Starting rotation in degrees; drag to turn when `interactive`. */
  angle?: number;
  interactive?: boolean;
}

/** Sizes below are in px for a 300 px wide cover. */
const BASE_WIDTH = 300;

interface Finish {
  thickness: number;
  /** How far the boards stick out past the pages. */
  overhang: number;
  board: number;
  /** Groove (hardcover) or score line (softcover) next to the spine. */
  hinge: { left: number; width: number; shade: string };
  coverShade: string;
  spineShade: string;
}

const FINISHES: Record<FormatId, Finish> = {
  hardcover: {
    thickness: 40,
    overhang: 6,
    board: 3,
    hinge: { left: 10, width: 7, shade: 'linear-gradient(90deg, rgba(0,0,0,.28), rgba(255,255,255,.25) 55%, rgba(0,0,0,.12))' },
    coverShade:
      'linear-gradient(90deg, rgba(0,0,0,.25) 0%, rgba(0,0,0,0) 6%), linear-gradient(115deg, rgba(255,255,255,.28) 0%, rgba(255,255,255,0) 35%, rgba(255,255,255,0) 70%, rgba(255,255,255,.12) 100%)',
    spineShade: 'linear-gradient(90deg, rgba(0,0,0,.35), rgba(255,255,255,.14) 30%, rgba(255,255,255,.06) 60%, rgba(0,0,0,.3))',
  },
  softcover: {
    thickness: 16,
    overhang: 0,
    board: 1,
    hinge: { left: 7, width: 3, shade: 'linear-gradient(90deg, rgba(0,0,0,.14), rgba(255,255,255,.18))' },
    coverShade: 'linear-gradient(90deg, rgba(0,0,0,.18) 0%, rgba(0,0,0,0) 4%), linear-gradient(115deg, rgba(255,255,255,.1), rgba(255,255,255,0) 40%)',
    spineShade: 'linear-gradient(90deg, rgba(0,0,0,.2), rgba(255,255,255,.1) 50%, rgba(0,0,0,.2))',
  },
};

/** Paper edge: fine page lines, darker toward the boards. */
const pages = (deg: number) =>
  `linear-gradient(${deg}deg, rgba(0,0,0,.18), transparent 18%, transparent 82%, rgba(0,0,0,.18)), repeating-linear-gradient(${deg}deg, #efe6d6 0 1.2px, #cfc3ad 1.2px 2px)`;

/** A pure-CSS 3D book assembled from flat faces: two boards, a spine and a page block. */
export default function BookMockup({
  coverSrc,
  format,
  spineColor,
  spineText,
  width = BASE_WIDTH,
  angle = 30,
  interactive = false,
}: Props) {
  const [rot, setRot] = useState(angle);
  const drag = useRef<{ x: number; start: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const endDrag = () => {
    drag.current = null;
    setDragging(false);
  };

  const f = FINISHES[format.id];
  const k = width / BASE_WIDTH;
  const [W, H, T] = [width, width * 1.25, f.thickness * k];
  const inset = f.overhang * k;
  const b = f.board * k;
  const pd = T - 2 * b; // page-block depth
  const [hw, hh, ht] = [W / 2, H / 2, T / 2];

  /**
   * One face of the book: a w×h rectangle whose centre is moved to `at`
   * (x right, y down, z toward the viewer) and turned by `turn` to face outward.
   */
  const plane = (w: number, h: number, at: [number, number, number], turn: string, style: CSSProperties = {}): CSSProperties => ({
    position: 'absolute',
    left: (W - w) / 2,
    top: (H - h) / 2,
    width: w,
    height: h,
    backfaceVisibility: 'hidden',
    transform: `translate3d(${at[0]}px, ${at[1]}px, ${at[2]}px) ${turn}`,
    ...style,
  });

  const edge: CSSProperties = { background: spineColor, filter: 'brightness(.75)' };
  const recess: CSSProperties = { background: spineColor, filter: 'brightness(.5)' };

  return (
    <div
      className={`relative select-none ${interactive ? 'cursor-grab active:cursor-grabbing touch-none' : ''}`}
      style={{ width: W + T, height: H + 40 * k, perspective: 2000 * k }}
      onPointerDown={(e) => {
        if (!interactive) return;
        (e.target as Element).setPointerCapture?.(e.pointerId);
        drag.current = { x: e.clientX, start: rot };
        setDragging(true);
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        setRot(Math.max(-45, Math.min(75, drag.current.start + (e.clientX - drag.current.x) * 0.4)));
      }}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {/* floor shadow */}
      <div
        className="absolute left-1/2 -translate-x-1/2 rounded-[50%] bg-black/25 blur-xl"
        style={{ bottom: 0, width: W * 0.95, height: 26 * k }}
      />
      <div
        className="absolute transition-transform duration-500 ease-out"
        style={{
          left: T / 2,
          top: 0,
          width: W,
          height: H,
          transformStyle: 'preserve-3d',
          transform: `rotateX(-8deg) rotateY(${rot}deg)`,
          transitionDuration: dragging ? '0ms' : undefined,
        }}
      >
        {/* front cover */}
        <div style={plane(W, H, [0, 0, ht], '', { overflow: 'hidden' })}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={coverSrc} alt="Book cover" draggable={false} className="h-full w-full object-cover" />
          <div
            className="pointer-events-none absolute inset-y-0"
            style={{ left: f.hinge.left * k, width: f.hinge.width * k, background: f.hinge.shade }}
          />
          <div className="pointer-events-none absolute inset-0" style={{ background: f.coverShade }} />
        </div>

        {/* back cover */}
        <div style={plane(W, H, [0, 0, -ht], 'rotateY(180deg)', { background: spineColor })} />

        {/* spine */}
        <div
          className="flex items-center justify-center overflow-hidden"
          style={plane(T, H, [-hw, 0, 0], 'rotateY(-90deg)', { background: `${f.spineShade}, ${spineColor}` })}
        >
          {spineText && T > 18 && (
            <span
              className="whitespace-nowrap font-serif text-white/85"
              style={{ writingMode: 'vertical-rl', fontSize: Math.min(T * 0.42, 13 * k) }}
            >
              {spineText}
            </span>
          )}
        </div>

        {/* page block: fore-edge, top, bottom */}
        <div style={plane(pd, H - 2 * inset, [hw - inset, 0, 0], 'rotateY(90deg)', { background: pages(90) })} />
        <div style={plane(W - inset, pd, [-inset / 2, -hh + inset, 0], 'rotateX(90deg)', { background: pages(0) })} />
        <div style={plane(W - inset, pd, [-inset / 2, hh - inset, 0], 'rotateX(-90deg)', { background: pages(0) })} />

        {/* edges of the front and back boards */}
        {[ht - b / 2, -ht + b / 2].map((z) => (
          <Fragment key={z}>
            <div style={plane(b, H, [hw, 0, z], 'rotateY(90deg)', edge)} />
            <div style={plane(W, b, [0, -hh, z], 'rotateX(90deg)', edge)} />
            <div style={plane(W, b, [0, hh, z], 'rotateX(-90deg)', edge)} />
          </Fragment>
        ))}

        {/* inside of the back board, visible where the boards overhang the pages */}
        {inset > 0 && (
          <>
            <div style={plane(inset, H, [hw - inset / 2, 0, -ht + b], '', recess)} />
            <div style={plane(W, inset, [0, -hh + inset / 2, -ht + b], '', recess)} />
            <div style={plane(W, inset, [0, hh - inset / 2, -ht + b], '', recess)} />
          </>
        )}
      </div>
    </div>
  );
}
