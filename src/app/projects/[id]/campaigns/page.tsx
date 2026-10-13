import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { ArrowLeft, Megaphone } from "lucide-react";
import { getCurrentUser } from "../../../../infrastructure/auth/current-user";
import {
  campaignService,
  projectService,
} from "../../../../infrastructure/services";
import { HttpError } from "../../../../lib/http";
import { AppShell } from "../../../../components/layout/AppShell";
import { CampaignList } from "./CampaignList";

type CampaignListPageProps = {
  params: Promise<{ id: string }>;
};

export default async function CampaignListPage({ params }: CampaignListPageProps) {
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

  const campaigns = await campaignService.listCampaigns(user.id, projectId);

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
            <Megaphone size={14} />
            Campaigns
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white">
            Launch campaigns
          </h1>
          <p className="mt-1 max-w-2xl text-xs text-[#777b84]">
            Turn a brief into a grounded launch strategy, a plan of deliverables,
            a readiness check, and a signed launch kit.
          </p>
        </div>

        <div className="mt-6">
          <CampaignList projectId={projectId} initialCampaigns={campaigns} />
        </div>
      </div>
    </AppShell>
  );
}

export const metadata = {
  title: "Campaigns",
};
