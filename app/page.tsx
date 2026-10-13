import Builder from "@/components/Builder";
import { aiLive } from "@/lib/ai/stylize";

export default function Home() {
  return (
    <main className="flex-1">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-5">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand text-lg text-white">📖</span>
          <span className="font-serif text-xl font-semibold">Little Chapters</span>
        </div>
        <span className="hidden rounded-full border border-line bg-white px-3 py-1 text-xs font-semibold text-muted sm:inline">
          {aiLive() ? "Prototype" : "Prototype · AI in placeholder mode"}
        </span>
      </header>

      <section className="mx-auto w-full max-w-6xl px-4 pt-6 pb-10 text-center sm:pt-10">
        <h1 className="mx-auto max-w-3xl font-serif text-4xl leading-tight font-semibold sm:text-5xl">
          Your baby, on the cover of their very own storybook
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-muted">
          Pick a book, upload a photo, and we&apos;ll turn it into a hand-painted style illustration — right on the cover.
        </p>
      </section>

      <Builder />
    </main>
  );
}
