import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { ArrowLeft, FolderKanban } from "lucide-react";
import { getCurrentUser } from "../../../infrastructure/auth/current-user";
import {
  assetService,
  brandService,
  browserService,
  contentIntentService,
  inputService,
  intelligenceService,
  projectService,
  sourceService,
} from "../../../infrastructure/services";
import { HttpError } from "../../../lib/http";
import { serializeSession } from "../../../lib/browser-api";
import { serializeInput } from "../../../lib/input-api";
import { serializeGraph } from "../../../lib/intelligence-api";
import {
  serializeBrandProfile,
  serializeBrandSourceStates,
} from "../../../lib/brand-api";
import {
  contentIntentRegistry,
  serializeContentIntentView,
} from "../../../lib/content-intent-api";
import { AppShell } from "../../../components/layout/AppShell";
import { BrowserPanel } from "../../../components/browser/BrowserPanel";
import { IntelligencePanel } from "../../../components/intelligence/IntelligencePanel";
import {
  ProjectActions,
} from "../../../components/projects/ProjectActions";
import {
  SourceAssetForms,
} from "../../../components/projects/SourceAssetForms";
import { BrandPanel } from "../../../components/brand/BrandPanel";
import { IntentPanel } from "../../../components/intent/IntentPanel";

type ProjectDetailPageProps = {
  params: Promise<{ id: string }>;
};

export default async function ProjectDetailPage({
  params,
}: ProjectDetailPageProps) {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  const { id } = await params;

  let project;

  try {
    project = await projectService.getAuthorized(id, user.id);
  } catch (error) {
    if (error instanceof HttpError) {
      if (error.status === 404) {
        notFound();
      }

      if (error.status === 403) {
        redirect("/projects");
      }
    }

    throw error;
  }

  const [
    inputBundle,
    assets,
    summary,
    graph,
    runs,
    snapshots,
    sources,
    browserSessions,
    brand,
    intents,
  ] =
    await Promise.all([
    inputService.getBundle(id, user.id),
    assetService.list(id, user.id),
    intelligenceService.getSummary(id, user.id),
    intelligenceService.getGraph(id, user.id),
    intelligenceService.listRuns(id, user.id, 10),
    intelligenceService.listSnapshots(id, user.id, 10),
    sourceService.list(id, user.id),
    browserService.listSessions(id, user.id),
    brandService.getProfile(id, user.id),
    contentIntentService.list(id, user.id),
  ]);

  return (
    <AppShell>
      <div className="p-5 sm:p-8">
        <Link
          href="/projects"
          className="mb-5 inline-flex items-center gap-2 text-xs text-[#777b84] hover:text-white"
        >
          <ArrowLeft size={14} />
          Projects
        </Link>

        <div className="flex flex-col justify-between gap-5 border-b border-[#202329] pb-8 sm:flex-row sm:items-end">
          <div>
            <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-[#62666f]">
              <FolderKanban size={14} />
              Project
            </div>

            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">
              {project.name}
            </h1>

            <p className="mt-2 text-sm text-[#777b84]">
              {project.archived ? "Archived" : "Active"} · created{" "}
              {new Date(project.createdAt).toLocaleDateString()}
            </p>
          </div>
        </div>

        <div className="mt-6">
          <ProjectActions
            projectId={project.id}
            name={project.name}
            archived={project.archived ?? false}
          />
        </div>

        <div className="mt-8">
          <SourceAssetForms
            projectId={project.id}
            inputs={inputBundle.inputs.map(serializeInput)}
            versions={inputBundle.versions}
            assets={assets}
          />
        </div>

        <div className="mt-8">
          <IntentPanel
            projectId={project.id}
            initialIntents={intents.map(serializeContentIntentView)}
            initialRegistry={contentIntentRegistry()}
          />
        </div>

        <div className="mt-8">
          <BrandPanel
            projectId={project.id}
            brand={brand.profile ? serializeBrandProfile(brand.profile) : null}
            execution={brand.execution}
            sourceStates={serializeBrandSourceStates(brand.sourceStates)}
          />
        </div>

        <div className="mt-8">
          <BrowserPanel
            projectId={project.id}
            initialSessions={browserSessions.map(serializeSession)}
            sources={sources.map((source) => ({
              id: source.id,
              name: source.name,
              uri: source.uri,
            }))}
          />
        </div>

        <div className="mt-8">
          <IntelligencePanel
            projectId={project.id}
            summary={summary}
            graph={serializeGraph(graph)}
            runs={runs}
            snapshots={snapshots}
          />
        </div>
      </div>
    </AppShell>
  );
}