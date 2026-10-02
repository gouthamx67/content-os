import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { ArrowLeft, Clapperboard } from "lucide-react";
import { getCurrentUser } from "../../../../../infrastructure/auth/current-user";
import {
  captureService,
  projectService,
} from "../../../../../infrastructure/services";
import { HttpError } from "../../../../../lib/http";
import { AppShell } from "../../../../../components/layout/AppShell";
import {
  serializeCaptureTake,
  type SerializedCapturePlanItem,
  type SerializedCaptureSession,
} from "../../../../../lib/capture-api";
import { modesForPlanItem } from "../../../../../modules/capture-engine/capture-plan";
import { CaptureWorkspace } from "./CaptureWorkspace";

type CapturePageProps = {
  params: Promise<{ id: string; sessionId: string }>;
};

export default async function CaptureSessionPage({ params }: CapturePageProps) {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  const { id: projectId, sessionId } = await params;

  let project;

  try {
    project = await projectService.getAuthorized(projectId, user.id);
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

  let session;

  try {
    session = await captureService.getSession({
      projectId,
      sessionId,
      userId: user.id,
    });
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) {
      notFound();
    }
    throw error;
  }

  const [takes, plan] = await Promise.all([
    captureService.listTakes({ projectId, sessionId, userId: user.id }),
    captureService.capturePlan(projectId, session),
  ]);

  // The client receives only what the workspace renders. `modesForPlanItem`
  // widens the shot's required modes to the full set the UI actually offers,
  // which is resolved here so the same rule is not restated in the browser.
  const serializedPlan: SerializedCapturePlanItem[] = plan.map((item) => ({
    ...item,
    availableModes: modesForPlanItem(item),
  }));

  const serializedSession: SerializedCaptureSession = {
    id: session.id,
    projectId: session.projectId,
    storyboardId: session.storyboardId,
    status: session.status,
    startedAt: session.startedAt,
    completedAt: session.completedAt,
  };

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

        <div className="flex flex-col justify-between gap-4 border-b border-[#202329] pb-6 sm:flex-row sm:items-end">
          <div>
            <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-[#62666f]">
              <Clapperboard size={14} />
              Capture
            </div>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white">
              Capture session
            </h1>
            <p className="mt-1 text-xs text-[#777b84]">
              Session {session.id.slice(0, 8)} · {session.status}
            </p>
          </div>
          <div className="text-xs text-[#62666f]">
            Shot requirements{" "}
            {session.storyboardId ? "loaded from the storyboard" : "not available"}
            {plan.length > 0
              ? ` · ${plan.length} shot${plan.length === 1 ? "" : "s"}`
              : ""}
          </div>
        </div>

        <div className="mt-6">
          <CaptureWorkspace
            projectId={projectId}
            session={serializedSession}
            initialTakes={takes.map(serializeCaptureTake)}
            capturePlan={serializedPlan}
          />
        </div>
      </div>
    </AppShell>
  );
}

export const metadata = {
  title: "Capture",
};
