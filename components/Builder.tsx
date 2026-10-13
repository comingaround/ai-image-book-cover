'use client';

import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import BookMockup from '@/components/BookMockup';
import { artKey, fingerprint, loadArt, saveArt } from '@/lib/art-cache';
import {
  COVER_H,
  COVER_W,
  FORMATS,
  MAX_UPLOAD_BYTES,
  PRINT_SCALE,
  STYLES,
  TEMPLATES,
  getFormat,
  getStyle,
  getTemplate,
  type FormatId,
  type StyleId,
  type TemplateId,
} from '@/lib/catalog';
import { previewSvg, resolveTitle, svgDataUrl } from '@/lib/cover-svg';
import { useCoverFonts } from '@/lib/use-cover-fonts';

interface Photo {
  file: File;
  /** Downscaled data URL for previews; missing if the browser can't decode the file (e.g. HEIC). */
  preview?: string;
  /** Fingerprint used as the saved-illustration key. */
  hash?: string | null;
}

interface Art {
  blob: Blob;
  url: string;
  placeholder: boolean;
  /** Restored from the browser's saved illustrations rather than generated. */
  saved?: boolean;
}

/** A downscaled data URL; SVG drawn through <img> can't load blob: URLs, so previews embed the photo. */
async function toPreviewDataUrl(file: File, max = 1000): Promise<string | undefined> {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * k);
    canvas.height = Math.round(bmp.height * k);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.9);
  } catch {
    return undefined;
  }
}

async function postImage(url: string, fields: Record<string, string | Blob>, signal?: AbortSignal) {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.append(k, v);
  const res = await fetch(url, { method: 'POST', body, signal });
  if (!res.ok) {
    const msg = await res.json().then((j) => j.error).catch(() => res.statusText);
    throw new Error(msg || `Request failed (${res.status})`);
  }
  return { blob: await res.blob(), placeholder: res.headers.get('x-placeholder') === '1' };
}

const choiceClass = (selected: boolean) =>
  selected ? 'border-brand bg-white shadow-md' : 'border-line bg-paper hover:border-brand/50';

export default function Builder() {
  const [formatId, setFormatId] = useState<FormatId>('hardcover');
  const [templateId, setTemplateId] = useState<TemplateId>(TEMPLATES[0].id);
  const [title, setTitle] = useState('');
  const [babyName, setBabyName] = useState('');
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [styleId, setStyleId] = useState<StyleId>('watercolor');
  const [art, setArt] = useState<Art | null>(null);
  const [coverUrl, setCoverUrl] = useState<string>();
  const [phase, setPhase] = useState<'stylizing' | 'composing' | null>(null);
  const [error, setError] = useState<string>();
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const fonts = useCoverFonts();

  const format = getFormat(formatId);
  const tpl = getTemplate(templateId);
  const style = getStyle(styleId);
  const text = useMemo(() => ({ title, babyName }), [title, babyName]);
  const busy = phase !== null;

  // Typing shouldn't wait on re-rendering three full-size SVG thumbnails.
  const thumbText = useDeferredValue(text);
  const thumbnails = useMemo(
    () => TEMPLATES.map((t) => svgDataUrl(previewSvg(t, thumbText, photo?.preview, fonts))),
    [thumbText, photo?.preview, fonts]
  );

  // Before the server cover exists, preview the raw photo (or placeholder) in the slot.
  const livePreview = useMemo(
    () => (coverUrl ? '' : svgDataUrl(previewSvg(tpl, text, photo?.preview, fonts))),
    [coverUrl, tpl, text, photo?.preview, fonts]
  );
  const shownCover = coverUrl ?? livePreview;

  function resetArt() {
    setArt(null);
    setCoverUrl(undefined);
    setPhase(null);
  }

  const showArt = (blob: Blob, extra: Omit<Art, 'blob' | 'url'>) => setArt({ blob, url: URL.createObjectURL(blob), ...extra });

  // Free each illustration's object URL once it's replaced.
  useEffect(() => () => {
    if (art) URL.revokeObjectURL(art.url);
  }, [art]);

  async function pickPhoto(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith('image/')) return setError('Please choose an image file (JPG, PNG, HEIC…).');
    setError(undefined);
    setPhoto({ file });
    resetArt();
    const [preview, hash] = await Promise.all([toPreviewDataUrl(file), fingerprint(file)]);
    setPhoto({ file, preview, hash });
  }

  const savedKey = photo?.hash && style.usesAi ? artKey(photo.hash, styleId) : null;

  // A photo + style generated before, even on an earlier visit, comes back from browser storage.
  useEffect(() => {
    if (!savedKey) return;
    let cancelled = false;
    loadArt(savedKey).then((blob) => {
      if (blob && !cancelled) setArt((cur) => cur ?? { blob, url: URL.createObjectURL(blob), placeholder: false, saved: true });
    });
    return () => {
      cancelled = true;
    };
  }, [savedKey]);

  /** The paid step; `fresh` skips the saved copy to get a new version. */
  async function generate(fresh: boolean) {
    if (!photo) return;
    setError(undefined);
    if (savedKey && !fresh) {
      const blob = await loadArt(savedKey);
      if (blob) return showArt(blob, { placeholder: false, saved: true });
    }
    setPhase('stylizing');
    try {
      const { blob, placeholder } = await postImage('/api/stylize', { photo: photo.file, style: styleId });
      showArt(blob, { placeholder });
      if (savedKey && !placeholder) void saveArt(savedKey, blob); // fakes must never shadow real art
    } catch (e) {
      setError((e as Error).message);
      setPhase(null);
    }
  }

  const compose = (blob: Blob, scale: number, signal?: AbortSignal) =>
    postImage('/api/compose', { photo: blob, templateId, ...text, scale: String(scale) }, signal);

  // The free step: re-place the illustration whenever the design or text changes.
  useEffect(() => {
    if (!art) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setPhase('composing');
      try {
        const { blob } = await compose(art.blob, 1, ctrl.signal);
        setCoverUrl((old) => {
          if (old) URL.revokeObjectURL(old);
          return URL.createObjectURL(blob);
        });
        setPhase(null);
      } catch (e) {
        if (ctrl.signal.aborted) return;
        setError((e as Error).message);
        setPhase(null);
      }
    }, 350);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `compose` only closes over templateId + text
  }, [art, templateId, text]);

  async function downloadPrint() {
    if (!art) return;
    const { blob } = await compose(art.blob, PRINT_SCALE);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(babyName || 'baby').toLowerCase().replace(/\W+/g, '-')}-${templateId}-cover.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  function buttonLabel() {
    if (!photo) return 'Upload a photo to continue';
    if (phase === 'stylizing') return style.usesAi ? `Illustrating in ${style.name.toLowerCase()}…` : 'Preparing your photo…';
    if (phase === 'composing') return 'Placing it on your cover…';
    if (art) return 'Generate again';
    return style.usesAi ? '✨ Create my cover' : 'Create my cover';
  }

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 pb-24 lg:grid-cols-[minmax(0,1fr)_420px] lg:gap-12">
      <div className="space-y-6">
        <Step n={1} title="Pick your book" hint="Same 40 pages inside — choose the cover that suits you.">
          <div className="grid gap-4 sm:grid-cols-2">
            {FORMATS.map((f) => (
              <button
                key={f.id}
                onClick={() => setFormatId(f.id)}
                className={`flex items-center gap-4 rounded-2xl border-2 p-4 text-left transition ${choiceClass(f.id === formatId)}`}
              >
                <div className="shrink-0">
                  <BookMockup coverSrc={shownCover} format={f} spineColor={tpl.spine} width={88} angle={-32} />
                </div>
                <div className="min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="font-serif text-lg font-semibold">{f.name}</span>
                    <span className="text-sm font-bold text-brand">${f.price}</span>
                  </div>
                  <p className="text-sm text-muted">{f.tagline}</p>
                  <ul className="mt-2 space-y-0.5 text-xs text-muted">
                    {f.perks.map((p) => (
                      <li key={p}>· {p}</li>
                    ))}
                  </ul>
                </div>
              </button>
            ))}
          </div>
        </Step>

        <Step n={2} title="Choose a cover design">
          <div className="grid grid-cols-3 gap-3">
            {TEMPLATES.map((t, i) => (
              <button
                key={t.id}
                onClick={() => setTemplateId(t.id)}
                className={`overflow-hidden rounded-xl border-2 text-left transition ${choiceClass(t.id === templateId)}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={thumbnails[i]}
                  alt={t.name}
                  className="aspect-[4/5] w-full object-cover"
                />
                <div className="px-3 py-2 text-sm font-semibold">{t.name}</div>
              </button>
            ))}
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Field label="Baby's name">
              <input
                value={babyName}
                onChange={(e) => setBabyName(e.target.value.slice(0, 24))}
                placeholder="e.g. Mia"
                className="input"
              />
            </Field>
            <Field label="Book title">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value.slice(0, 32))}
                placeholder={tpl.defaultTitle}
                className="input"
              />
            </Field>
          </div>
        </Step>

        <Step n={3} title="Upload a photo of your baby" hint="A clear, front-facing photo works best. We crop to the face automatically.">
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => pickPhoto(e.target.files?.[0])}
          />
          <div
            role="button"
            tabIndex={0}
            onClick={() => fileInput.current?.click()}
            onKeyDown={(e) => e.key === 'Enter' && fileInput.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              pickPhoto(e.dataTransfer.files?.[0]);
            }}
            className={`flex cursor-pointer items-center gap-4 rounded-2xl border-2 border-dashed p-5 transition ${
              dragOver ? 'border-brand bg-brand/5' : 'border-line bg-paper hover:border-brand/50'
            }`}
          >
            {photo?.preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photo.preview} alt="Your photo" className="h-20 w-20 rounded-xl object-cover" />
            ) : (
              <div className="flex h-20 w-20 items-center justify-center rounded-xl bg-cream text-3xl">📷</div>
            )}
            <div>
              <p className="font-semibold">{photo ? photo.file.name : 'Drop a photo here, or click to browse'}</p>
              <p className="text-sm text-muted">
                {photo ? 'Click to choose a different photo' : `JPG, PNG or HEIC · up to ${MAX_UPLOAD_BYTES >> 20} MB`}
              </p>
            </div>
          </div>
        </Step>

        <Step n={4} title="Pick an illustration style">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {STYLES.map((s) => (
              <button
                key={s.id}
                onClick={() => {
                  if (s.id !== styleId) resetArt();
                  setStyleId(s.id);
                }}
                className={`rounded-xl border-2 p-3 text-left transition ${choiceClass(s.id === styleId)}`}
              >
                <StyleSwatch id={s.id} />
                <div className="mt-2 text-sm font-semibold">{s.name}</div>
                <div className="text-xs text-muted">{s.blurb}</div>
              </button>
            ))}
          </div>

          <button
            onClick={() => generate(!!art)}
            disabled={!photo || busy}
            className="relative mt-5 w-full overflow-hidden rounded-full bg-brand px-6 py-4 font-bold text-white shadow-lg shadow-brand/30 transition enabled:hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy && <span className="shimmer absolute inset-0" />}
            <span className="relative">{buttonLabel()}</span>
          </button>
          {phase === 'stylizing' && style.usesAi && (
            <p className="mt-2 text-center text-xs text-muted">This usually takes 20–30 seconds.</p>
          )}
          {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

          {art && (
            <div className="mt-5 flex items-center gap-4 rounded-2xl border border-line bg-paper p-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={art.url} alt="Illustration" className="h-24 w-24 rounded-xl object-cover" />
              <div className="text-sm">
                <p className="font-semibold">Illustration ready</p>
                <p className="text-muted">
                  Change the design, name or title freely — the cover updates instantly without re-running the AI.
                </p>
                {art.saved && (
                  <span className="mt-2 mr-1 inline-block rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                    Restored from your saved illustrations — no AI used
                  </span>
                )}
                {art.placeholder && (
                  <span className="mt-2 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                    AI placeholder — filter preview, Nano Banana comes next
                  </span>
                )}
              </div>
            </div>
          )}
        </Step>
      </div>

      <aside className="lg:sticky lg:top-6 lg:self-start">
        <div className="rounded-3xl border border-line bg-gradient-to-b from-white to-paper p-6 shadow-sm">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-bold tracking-widest text-muted uppercase">Live preview</span>
            <span className="text-xs text-muted">drag to turn</span>
          </div>
          <div className="relative flex justify-center py-4">
            <BookMockup
              key={format.id}
              coverSrc={shownCover}
              format={format}
              spineColor={tpl.spine}
              spineText={`${resolveTitle(tpl, title)}${babyName ? ` · ${babyName}` : ''}`}
              width={260}
              interactive
            />
            {phase === 'composing' && (
              <div className="absolute top-2 right-2 rounded-full bg-white/90 px-3 py-1 text-xs font-semibold shadow">
                Updating…
              </div>
            )}
          </div>
          <p className="mb-4 text-center text-xs text-muted">
            {coverUrl
              ? 'Final cover — composed on our server at print quality.'
              : photo?.preview
                ? 'Quick preview of your photo. Create your cover to see the illustrated version.'
                : 'Upload a photo to put your baby on the cover.'}
          </p>
          <div className="space-y-2 border-t border-line pt-4 text-sm">
            <Row label={`${format.name} · ${format.trim}`} value={`$${format.price}`} />
            <Row label={`${format.pages} pages · ${tpl.name}`} value="incl." />
            <Row label="Shipping" value="calculated at checkout" muted />
          </div>
          <button
            disabled={!coverUrl}
            onClick={() => alert('Checkout is not part of this prototype yet.')}
            className="mt-4 w-full rounded-full bg-ink px-6 py-3 font-bold text-white transition enabled:hover:opacity-90 disabled:opacity-40"
          >
            Add to cart — ${format.price}
          </button>
          {coverUrl && (
            <button onClick={downloadPrint} className="mt-2 w-full text-sm font-semibold text-brand hover:underline">
              Download print-ready cover ({COVER_W * PRINT_SCALE} × {COVER_H * PRINT_SCALE})
            </button>
          )}
        </div>
      </aside>
    </div>
  );
}

function Step({ n, title, hint, children }: { n: number; title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="rounded-3xl border border-line bg-white/60 p-5 sm:p-6">
      <div className="mb-4 flex items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-bold text-white">
          {n}
        </span>
        <div>
          <h2 className="font-serif text-xl font-semibold">{title}</h2>
          {hint && <p className="text-sm text-muted">{hint}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-bold tracking-wide text-muted uppercase">{label}</span>
      {children}
    </label>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted">{label}</span>
      <span className={muted ? 'text-muted' : 'font-semibold'}>{value}</span>
    </div>
  );
}

/** Small swatch hinting at each style. */
function StyleSwatch({ id }: { id: StyleId }) {
  const bg: Record<StyleId, string> = {
    watercolor: 'radial-gradient(circle at 30% 35%, #f7b9a8 0 22%, transparent 40%), radial-gradient(circle at 70% 60%, #a8c8e8 0 25%, transparent 45%), radial-gradient(circle at 45% 80%, #f6dc9c 0 18%, transparent 38%), #fdf7f1',
    storybook: 'radial-gradient(circle at 50% 45%, #f3c9a8 0 28%, transparent 29%), linear-gradient(160deg, #ffd59e, #f19c79)',
    sketch: 'repeating-linear-gradient(45deg, #d9d6d2 0 1px, transparent 1px 6px), repeating-linear-gradient(-45deg, #e6e3df 0 1px, transparent 1px 9px), #fbfaf8',
    original: 'linear-gradient(135deg, #cfd8dc, #90a4ae)',
  };
  return <div className="aspect-square w-full rounded-lg" style={{ background: bg[id] }} />;
}
