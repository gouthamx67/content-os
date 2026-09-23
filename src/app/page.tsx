import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { ContentGrid } from "../components/content/ContentGrid";
import { IntentInput } from "../components/input/IntentInput";
import { UniversalInput } from "../components/input/UniversalInput";

export default function Home() {
  return (
    <div className="content-gradient min-h-screen">
      <header className="border-b border-[#202329]">
        <div className="mx-auto flex min-h-16 max-w-[1440px] items-center justify-between px-5 sm:px-8">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-white text-black">
              <Sparkles size={15} />
            </div>

            <span className="text-sm font-semibold tracking-tight">
              Content OS
            </span>
          </Link>

          <nav className="hidden items-center gap-1 md:flex">
            <Link
              href="/projects"
              className="rounded-lg px-3 py-2 text-sm text-[#8d919a] hover:bg-[#15171c] hover:text-white"
            >
              Projects
            </Link>

            <Link
              href="/library"
              className="rounded-lg px-3 py-2 text-sm text-[#8d919a] hover:bg-[#15171c] hover:text-white"
            >
              Library
            </Link>

            <Link
              href="/campaigns"
              className="rounded-lg px-3 py-2 text-sm text-[#8d919a] hover:bg-[#15171c] hover:text-white"
            >
              Campaigns
            </Link>
          </nav>

          <Link
            href="/projects"
            className="hidden items-center gap-2 text-sm text-[#b4b7bf] hover:text-white sm:flex"
          >
            Your projects
            <ArrowRight size={15} />
          </Link>
        </div>
      </header>

      <main className="relative overflow-hidden">
        <div className="grid-background pointer-events-none absolute inset-0" />

        <div className="relative mx-auto max-w-5xl px-5 pb-24 pt-20 sm:px-8 sm:pt-28">
          <section className="mx-auto max-w-3xl text-center">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-[#30343c] bg-[#101216] px-3 py-1.5 text-xs text-[#b4b7bf]">
              <span className="h-1.5 w-1.5 rounded-full bg-white" />
              AI Content Creation & Launch OS
            </div>

            <h1 className="text-balance text-5xl font-semibold tracking-[-0.04em] text-white sm:text-7xl">
              Give us anything.
              <br />
              Make anything.
            </h1>

            <p className="mx-auto mt-6 max-w-2xl text-pretty text-base leading-7 text-[#8d919a] sm:text-lg">
              Turn products, websites, code, files, ideas, and existing
              creative into professional content for every platform.
            </p>
          </section>

          <section className="mx-auto mt-12 max-w-3xl">
            <UniversalInput />
          </section>

          <section className="mx-auto mt-8 max-w-3xl">
            <IntentInput />
          </section>

          <section className="mt-24">
            <ContentGrid />
          </section>
        </div>
      </main>
    </div>
  );
}