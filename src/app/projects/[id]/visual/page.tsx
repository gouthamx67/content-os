import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { ArrowLeft, Layers } from "lucide-react";
import { getCurrentUser } from "../../../../infrastructure/auth/current-user";
import {
  projectService,
  visualCompositionService,
} from "../../../../infrastructure/services";
import { HttpError } from "../../../../lib/http";
import { AppShell } from "../../../../components/layout/AppShell";
import { buildSceneGraph } from "../../../../modules/visual-motion-engine/serialization/scene-graph";
import { VisualList } from "./VisualList";

type VisualListPageProps = {
  params: Promise<{ id: string }>;
};

export default async function VisualListPage({ params }: VisualListPageProps) {
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

  const compositions = await visualCompositionService.listCompositions({
    projectId,
    userId: user.id,
  });

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
            <Layers size={14} />
            Visual / motion
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white">
            Compositions
          </h1>
          <p className="mt-1 text-xs text-[#777b84]">
            Build a canvas of layers, motion and effects. Preview only — export
            is a later checkpoint.
          </p>
        </div>

        <div className="mt-6">
          <VisualList
            projectId={projectId}
            initialCompositions={compositions.map(buildSceneGraph)}
          />
        </div>
      </div>
    </AppShell>
  );
}

export const metadata = {
  title: "Visual compositions",
};
