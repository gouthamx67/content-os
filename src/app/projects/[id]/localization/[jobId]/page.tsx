import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { ArrowLeft, Languages } from "lucide-react";
import { getCurrentUser } from "../../../../../infrastructure/auth/current-user";
import {
  localizationProviders,
  localizationService,
  projectService,
} from "../../../../../infrastructure/services";
import { HttpError } from "../../../../../lib/http";
import { isLocalizationError } from "../../../../../modules/localization-engine/errors";
import { AppShell } from "../../../../../components/layout/AppShell";
import { LocalizationWorkspace } from "./LocalizationWorkspace";

type LocalizationDetailPageProps = {
  params: Promise<{ id: string; jobId: string }>;
};

export default async function LocalizationDetailPage({
  params,
}: LocalizationDetailPageProps) {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  const { id: projectId, jobId } = await params;

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

  let detail;

  try {
    detail = await localizationService.getDetail(user.id, projectId, jobId);
  } catch (error) {
    if (
      isLocalizationError(error) &&
      error.code === "LOCALIZATION_NOT_FOUND"
    ) {
      notFound();
    }
    throw error;
  }

  const [glossary, history] = await Promise.all([
    localizationService.listGlossary(
      user.id,
      projectId,
      detail.job.sourceLocale,
      detail.job.targetLocale,
    ),
    localizationService.listHistory(user.id, projectId, jobId, {
      limit: 20,
      offset: 0,
    }),
  ]);

  return (
    <AppShell>
      <div className="p-5 sm:p-8">
        <Link
          href={`/projects/${projectId}/localization`}
          className="mb-5 inline-flex items-center gap-2 text-xs text-[#777b84] hover:text-white"
        >
          <ArrowLeft size={14} />
          Localization
        </Link>

        <div className="border-b border-[#202329] pb-6">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-[#62666f]">
            <Languages size={14} />
            {project.name}
          </div>
          <h1
            className="mt-2 text-2xl font-semibold tracking-tight text-white"
            data-testid="localization-title"
          >
            {detail.job.sourceType} → {detail.job.targetLocale}
          </h1>
          <p className="mt-1 max-w-2xl text-xs text-[#777b84]">
            {detail.snapshot.segments.length} segment
            {detail.snapshot.segments.length === 1 ? "" : "s"} · strategy{" "}
            {detail.job.strategy}
          </p>
        </div>

        <div className="mt-6">
          <LocalizationWorkspace
            projectId={projectId}
            detail={detail}
            initialGlossary={glossary}
            initialHistory={history}
            providers={localizationProviders.names()}
          />
        </div>
      </div>
    </AppShell>
  );
}

export const metadata = {
  title: "Localization job",
};
