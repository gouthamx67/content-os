import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { ArrowLeft, Layers } from "lucide-react";
import { getCurrentUser } from "../../../../../infrastructure/auth/current-user";
import {
  projectService,
  visualCompositionService,
} from "../../../../../infrastructure/services";
import { HttpError } from "../../../../../lib/http";
import { AppShell } from "../../../../../components/layout/AppShell";
import { buildSceneGraph } from "../../../../../modules/visual-motion-engine/serialization/scene-graph";
import { VisualWorkspace } from "./VisualWorkspace";

type VisualCompositionPageProps = {
  params: Promise<{ id: string; compositionId: string }>;
};

export default async function VisualCompositionPage({
  params,
}: VisualCompositionPageProps) {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  const { id: projectId, compositionId } = await params;

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

  let composition;

  try {
    composition = await visualCompositionService.getComposition({
      projectId,
      compositionId,
      userId: user.id,
    });
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) {
      notFound();
    }
    throw error;
  }

  const defaults = await visualCompositionService.visualDefaults({
    projectId,
    userId: user.id,
  });

  const scene = buildSceneGraph(composition);

  return (
    <AppShell>
      <div className="p-5 sm:p-8">
        <Link
          href={`/projects/${projectId}/visual`}
          className="mb-5 inline-flex items-center gap-2 text-xs text-[#777b84] hover:text-white"
        >
          <ArrowLeft size={14} />
          Visual compositions
        </Link>

        <div className="flex flex-col justify-between gap-4 border-b border-[#202329] pb-6 sm:flex-row sm:items-end">
          <div>
            <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-[#62666f]">
              <Layers size={14} />
              Visual / motion
            </div>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white">
              {scene.name}
            </h1>
            <p className="mt-1 text-xs text-[#777b84]">
              {project.name} · {scene.width}×{scene.height} · {scene.frameRate}{" "}
              fps · {scene.durationMs} ms · {scene.status}
            </p>
          </div>
        </div>

        <div className="mt-6">
          <VisualWorkspace
            projectId={projectId}
            initialComposition={scene}
            brandDefaultColor={defaults.backgroundColor}
          />
        </div>
      </div>
    </AppShell>
  );
}

export const metadata = {
  title: "Visual composition",
};
