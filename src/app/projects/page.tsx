import Link from "next/link";
import { ArrowLeft, FolderKanban, Plus } from "lucide-react";
import { AppShell } from "../../components/layout/AppShell";

export default function ProjectsPage() {
  return (
    <AppShell>
      <div className="p-5 sm:p-8">
        <div className="flex flex-col justify-between gap-5 border-b border-[#202329] pb-8 sm:flex-row sm:items-end">
          <div>
            <Link
              href="/"
              className="mb-5 inline-flex items-center gap-2 text-xs text-[#777b84] hover:text-white"
            >
              <ArrowLeft size={14} />
              New project
            </Link>

            <h1 className="text-3xl font-semibold tracking-tight text-white">
              Projects
            </h1>

            <p className="mt-2 text-sm text-[#777b84]">
              Your products, creative systems, and generated content.
            </p>
          </div>

          <Link
            href="/"
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-white px-4 text-sm font-medium text-black hover:bg-neutral-200"
          >
            <Plus size={16} />
            New project
          </Link>
        </div>

        <div className="mt-8 rounded-2xl border border-dashed border-[#30343c] p-12 text-center">
          <FolderKanban className="mx-auto text-[#62666f]" size={28} />

          <h2 className="mt-4 text-sm font-medium text-white">
            No projects yet
          </h2>

          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#777b84]">
            Start with a website, repository, file, existing creative, or
            simply describe what you want to create.
          </p>

          <Link
            href="/"
            className="mt-6 inline-flex min-h-10 items-center justify-center rounded-lg border border-[#30343c] bg-[#15171c] px-4 text-sm font-medium text-white hover:bg-[#1b1e24]"
          >
            Create your first project
          </Link>
        </div>
      </div>
    </AppShell>
  );
}