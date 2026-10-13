import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { ArrowLeft, Megaphone } from "lucide-react";
import { getCurrentUser } from "../../../../../infrastructure/auth/current-user";
import {
  campaignService,
  projectService,
} from "../../../../../infrastructure/services";
import { HttpError } from "../../../../../lib/http";
import { isCampaignError } from "../../../../../modules/campaign-engine/errors";
import { AppShell } from "../../../../../components/layout/AppShell";
import { CampaignWorkspace } from "./CampaignWorkspace";

type CampaignDetailPageProps = {
  params: Promise<{ id: string; campaignId: string }>;
};

export default async function CampaignDetailPage({
  params,
}: CampaignDetailPageProps) {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  const { id: projectId, campaignId } = await params;

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
    detail = await campaignService.getCampaign(user.id, projectId, campaignId);
  } catch (error) {
    if (isCampaignError(error) && error.code === "CAMPAIGN_NOT_FOUND") notFound();
    throw error;
  }

  const readiness = await campaignService.readiness(user.id, projectId, campaignId);

  return (
    <AppShell>
      <div className="p-5 sm:p-8">
        <Link
          href={`/projects/${projectId}/campaigns`}
          className="mb-5 inline-flex items-center gap-2 text-xs text-[#777b84] hover:text-white"
        >
          <ArrowLeft size={14} />
          Campaigns
        </Link>

        <div className="border-b border-[#202329] pb-6">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-[#62666f]">
            <Megaphone size={14} />
            {project.name}
          </div>
          <h1
            className="mt-2 text-2xl font-semibold tracking-tight text-white"
            data-testid="campaign-name"
          >
            {detail.campaign.name}
          </h1>
          <p className="mt-1 max-w-2xl text-xs text-[#777b84]">
            {detail.campaign.objective}
          </p>
        </div>

        <div className="mt-6">
          <CampaignWorkspace
            projectId={projectId}
            initialCampaign={detail.campaign}
            initialDeliverables={detail.deliverables}
            initialReadiness={readiness}
          />
        </div>
      </div>
    </AppShell>
  );
}

export const metadata = {
  title: "Campaign",
};
