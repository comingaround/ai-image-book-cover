'use client';

import { Fragment, useRef, useState, type CSSProperties } from 'react';

import type { BookFormat } from '@/lib/catalog';

interface Props {
  coverSrc: string;
  format: BookFormat;
  spineColor: string;
  spineText?: string;
  /** Rendered width of the front cover in px; everything else scales from it. */
  width?: number;
  /** Starting rotation; drag to turn when `interactive`. */
  angle?: number;
  interactive?: boolean;
}

const BASE_WIDTH = 300;

/**
 * Pure-CSS 3D book. Hardcover: thick boards that overhang the page block, a
 * hinge groove and gloss. Softcover: thin, flush-cut, a scored crease, matte.
 */
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

  const k = width / BASE_WIDTH;
  const W = width;
  const H = width * 1.25;
  const T = format.thickness * k;
  const hard = format.id === 'hardcover';
  const inset = format.overhang * k; // how far the boards overhang the pages
  const b = (hard ? 3 : 1) * k; // board thickness
  const pd = T - 2 * b; // page-block depth
  const [hw, hh, ht] = [W / 2, H / 2, T / 2];

  /**
   * One flat face of the book, centred on the book's centre, then rotated and
   * moved into place: `at` is its centre in book space (x right, y down,
   * z toward the viewer), `turn` the rotation that points it outward.
   */
  const plane = (w: number, h: number, at: [number, number, number], turn: string, style: CSSProperties = {}) => ({
    position: 'absolute' as const,
    left: (W - w) / 2,
    top: (H - h) / 2,
    width: w,
    height: h,
    backfaceVisibility: 'hidden' as const,
    transform: `translate3d(${at[0]}px, ${at[1]}px, ${at[2]}px) ${turn}`,
    ...style,
  });

  // Paper: fine lines along the page edges, shaded where the boards overhang.
  const pagesV = `linear-gradient(90deg, rgba(0,0,0,.18), transparent 18%, transparent 82%, rgba(0,0,0,.18)), repeating-linear-gradient(90deg, #efe6d6 0 1.2px, #cfc3ad 1.2px 2px)`;
  const pagesH = `linear-gradient(0deg, rgba(0,0,0,.18), transparent 18%, transparent 82%, rgba(0,0,0,.18)), repeating-linear-gradient(0deg, #efe6d6 0 1.2px, #cfc3ad 1.2px 2px)`;
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
        const next = drag.current.start + (e.clientX - drag.current.x) * 0.4;
        setRot(Math.max(-45, Math.min(75, next)));
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
          {/* hinge groove (hard) / score line (soft) */}
          <div
            className="pointer-events-none absolute inset-y-0"
            style={{
              left: hard ? 10 * k : 7 * k,
              width: hard ? 7 * k : 3 * k,
              background: hard
                ? 'linear-gradient(90deg, rgba(0,0,0,.28), rgba(255,255,255,.25) 55%, rgba(0,0,0,.12))'
                : 'linear-gradient(90deg, rgba(0,0,0,.14), rgba(255,255,255,.18))',
            }}
          />
          {/* spine-side shading + gloss */}
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background: hard
                ? 'linear-gradient(90deg, rgba(0,0,0,.25) 0%, rgba(0,0,0,0) 6%), linear-gradient(115deg, rgba(255,255,255,.28) 0%, rgba(255,255,255,0) 35%, rgba(255,255,255,0) 70%, rgba(255,255,255,.12) 100%)'
                : 'linear-gradient(90deg, rgba(0,0,0,.18) 0%, rgba(0,0,0,0) 4%), linear-gradient(115deg, rgba(255,255,255,.1), rgba(255,255,255,0) 40%)',
            }}
          />
        </div>

        {/* back cover */}
        <div style={plane(W, H, [0, 0, -ht], 'rotateY(180deg)', { background: spineColor })} />

        {/* spine — straight, its roundness is only shading */}
        <div
          className="flex items-center justify-center overflow-hidden"
          style={plane(T, H, [-hw, 0, 0], 'rotateY(-90deg)', {
            background: hard
              ? `linear-gradient(90deg, rgba(0,0,0,.35), rgba(255,255,255,.14) 30%, rgba(255,255,255,.06) 60%, rgba(0,0,0,.3)), ${spineColor}`
              : `linear-gradient(90deg, rgba(0,0,0,.2), rgba(255,255,255,.1) 50%, rgba(0,0,0,.2)), ${spineColor}`,
          })}
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

        {/* page block, set back from the board edges by `inset` */}
        <div style={plane(pd, H - 2 * inset, [hw - inset, 0, 0], 'rotateY(90deg)', { background: pagesV })} />
        <div style={plane(W - inset, pd, [-inset / 2, -hh + inset, 0], 'rotateX(90deg)', { background: pagesH })} />
        <div style={plane(W - inset, pd, [-inset / 2, hh - inset, 0], 'rotateX(-90deg)', { background: pagesH })} />

        {/* board edges: front and back board, on the fore-edge, top and bottom */}
        {[ht - b / 2, -ht + b / 2].map((z) => (
          <Fragment key={z}>
            <div style={plane(b, H, [hw, 0, z], 'rotateY(90deg)', edge)} />
            <div style={plane(W, b, [0, -hh, z], 'rotateX(90deg)', edge)} />
            <div style={plane(W, b, [0, hh, z], 'rotateX(-90deg)', edge)} />
          </Fragment>
        ))}

        {/* inside of the back board, seen through the overhang gap */}
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
