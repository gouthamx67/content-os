import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { ArrowLeft, Languages } from "lucide-react";
import { getCurrentUser } from "../../../../infrastructure/auth/current-user";
import {
  localizationService,
  projectService,
  writingRepository,
} from "../../../../infrastructure/services";
import { HttpError } from "../../../../lib/http";
import { AppShell } from "../../../../components/layout/AppShell";
import { LocaleSelector } from "./LocaleSelector";
import { LocalizationJobList } from "./LocalizationJobList";

type LocalizationListPageProps = {
  params: Promise<{ id: string }>;
};

export default async function LocalizationListPage({
  params,
}: LocalizationListPageProps) {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  const { id: projectId } = await params;

  let project;

  try {
    project = await projectService.getAuthorized(projectId, user.id);
  } catch (error) {
    if (error instanceof HttpError) {
      if (error.status === 404) notFound();
      if (error.status === 403) redirect("/projects");
    }
    throw error;
  }

  const [locales, jobs, documents] = await Promise.all([
    localizationService.listLocales(user.id, projectId),
    localizationService.listJobs(user.id, projectId),
    writingRepository.listDocuments(projectId),
  ]);

  const writingOptions = documents.map((document) => ({
    id: document.id,
    title: document.title,
  }));

  return (
    <AppShell>
      <div className="p-5 sm:p-8">
        <Link
          href={`/projects/${projectId}`}
          className="mb-5 inline-flex items-center gap-2 text-xs text-[#777b84] hover:text-white"
        >
          <ArrowLeft size={14} />
          {project.name}
        </Link>

        <div className="border-b border-[#202329] pb-6">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-[#62666f]">
            <Languages size={14} />
            Localization
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white">
            Localization engine
          </h1>
          <p className="mt-1 max-w-2xl text-xs text-[#777b84]">
            Configure the project locales, localize a source into a new traceable
            revision, review it, and export the applied artifact — without ever
            rewriting the source.
          </p>
        </div>

        <div className="mt-6 space-y-6">
          <LocaleSelector projectId={projectId} initialLocales={locales} />
          <LocalizationJobList
            projectId={projectId}
            initialJobs={jobs}
            writingOptions={writingOptions}
            locales={locales}
          />
        </div>
      </div>
    </AppShell>
  );
}

export const metadata = {
  title: "Localization",
};
