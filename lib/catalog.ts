/**
 * Everything a customer can pick, as plain data — shared by the UI and the
 * server compose route so the two can never disagree about a slot's position.
 *
 * Cover art is authored at COVER_W × COVER_H (8×10 in at 150 px/in). The compose
 * route renders at `scale` × that for print (scale 2 = 300 dpi).
 */

export const COVER_W = 1200;
export const COVER_H = 1500;

export type FormatId = 'hardcover' | 'softcover';

export interface BookFormat {
  id: FormatId;
  name: string;
  tagline: string;
  price: number;
  pages: number;
  trim: string;
  perks: string[];
  /** Mockup geometry in px at the mockup's base width (see BookMockup). */
  thickness: number;
  /** Hardcover boards overhang the page block; softcover is cut flush. */
  overhang: number;
}

export const FORMATS: BookFormat[] = [
  {
    id: 'hardcover',
    name: 'Hardcover',
    tagline: 'The keepsake edition',
    price: 39,
    pages: 40,
    trim: '8 × 10 in',
    perks: ['Rigid laminated boards', 'Lay-flat premium paper', 'Built for 18 years of bedtime'],
    thickness: 40,
    overhang: 6,
  },
  {
    id: 'softcover',
    name: 'Softcover',
    tagline: 'Light, bright & giftable',
    price: 24,
    pages: 40,
    trim: '8 × 10 in',
    perks: ['Flexible matte cover', 'Perfect-bound spine', 'Ships in 3–5 days'],
    thickness: 16,
    overhang: 0,
  },
];

export type SlotShape = 'circle' | 'arch' | 'rounded';

export interface PhotoSlot {
  x: number;
  y: number;
  w: number;
  h: number;
  shape: SlotShape;
}

export interface CoverTemplate {
  id: string;
  name: string;
  defaultTitle: string;
  bg: string;
  ink: string;
  accent: string;
  spine: string;
  slot: PhotoSlot;
}

export const TEMPLATES: CoverTemplate[] = [
  {
    id: 'little-star',
    name: 'Little Star',
    defaultTitle: 'Twinkle, Little Star',
    bg: '#1f2a4a',
    ink: '#fbf3e4',
    accent: '#f4c96b',
    spine: '#18213b',
    slot: { x: 300, y: 380, w: 600, h: 600, shape: 'circle' },
  },
  {
    id: 'hello-world',
    name: 'Hello, World',
    defaultTitle: 'Hello, World!',
    bg: '#f7dcd2',
    ink: '#5b3a3a',
    accent: '#e88f7a',
    spine: '#e9b9aa',
    slot: { x: 330, y: 420, w: 540, h: 660, shape: 'arch' },
  },
  {
    id: 'wild-one',
    name: 'Wild One',
    defaultTitle: 'Our Wild One',
    bg: '#cfdcc4',
    ink: '#2f4a33',
    accent: '#7fa36f',
    spine: '#9fb892',
    slot: { x: 290, y: 400, w: 620, h: 620, shape: 'rounded' },
  },
];

export type StyleId = 'original' | 'watercolor' | 'storybook' | 'sketch';

export interface ArtStyle {
  id: StyleId;
  name: string;
  blurb: string;
  usesAi: boolean;
}

export const STYLES: ArtStyle[] = [
  { id: 'watercolor', name: 'Watercolor', blurb: 'Soft washes, dreamy edges', usesAi: true },
  { id: 'storybook', name: 'Storybook', blurb: 'Warm, painterly picture-book look', usesAi: true },
  { id: 'sketch', name: 'Pencil sketch', blurb: 'Hand-drawn graphite lines', usesAi: true },
  { id: 'original', name: 'Original photo', blurb: 'No AI — your photo as is', usesAi: false },
];

export const getFormat = (id: string) => FORMATS.find((f) => f.id === id) ?? FORMATS[0];
export const getTemplate = (id: string) => TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0];
export const getStyle = (id: string) => STYLES.find((s) => s.id === id) ?? STYLES[0];
