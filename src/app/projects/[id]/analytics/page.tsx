import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { ArrowLeft, BarChart3 } from "lucide-react";
import { getCurrentUser } from "../../../../infrastructure/auth/current-user";
import {
  analyticsService,
  optimizationService,
  projectService,
} from "../../../../infrastructure/services";
import { HttpError } from "../../../../lib/http";
import { AppShell } from "../../../../components/layout/AppShell";
import { AnalyticsDashboard } from "./AnalyticsDashboard";

type AnalyticsPageProps = {
  params: Promise<{ id: string }>;
};

export default async function AnalyticsPage({ params }: AnalyticsPageProps) {
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

  const [overview, recommendations] = await Promise.all([
    analyticsService.getOverview(user.id, projectId),
    optimizationService.listRecommendations(user.id, projectId),
  ]);

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
            <BarChart3 size={14} />
            Analytics
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white">
            Analytics &amp; optimization
          </h1>
          <p className="mt-1 max-w-2xl text-xs text-[#777b84]">
            Provider-reported counts with their provenance and collection time.
            Nothing is back-filled: a metric that was not collected is shown as
            unavailable, never as zero.
          </p>
        </div>

        <div className="mt-6">
          <AnalyticsDashboard
            projectId={projectId}
            initialOverview={overview}
            initialRecommendations={recommendations}
          />
        </div>
      </div>
    </AppShell>
  );
}

export const metadata = {
  title: "Analytics",
};
