import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { ArrowLeft, Send } from "lucide-react";
import { getCurrentUser } from "../../../../infrastructure/auth/current-user";
import {
  campaignRepository,
  publishingService,
  projectService,
  writingRepository,
} from "../../../../infrastructure/services";
import { HttpError } from "../../../../lib/http";
import { AppShell } from "../../../../components/layout/AppShell";
import { PublishingWorkspace } from "./PublishingWorkspace";

type PublishingPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function PublishingPage({
  params,
  searchParams,
}: PublishingPageProps) {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  const { id: projectId } = await params;
  const query = await searchParams;

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

  const [connections, publications, catalog, documents, campaigns] =
    await Promise.all([
      publishingService.listConnections(user.id, projectId),
      publishingService.listPublications(user.id, projectId),
      publishingService.listProviders(user.id, projectId),
      writingRepository.listDocuments(projectId),
      campaignRepository.listCampaigns(projectId),
    ]);

  const deliverableOptions: { id: string; title: string }[] = [];
  for (const campaign of campaigns) {
    const deliverables = await campaignRepository.listDeliverables(campaign.id);
    for (const deliverable of deliverables) {
      if (deliverable.status === "READY") {
        deliverableOptions.push({
          id: deliverable.id,
          title: `${campaign.name} — ${deliverable.title}`,
        });
      }
    }
  }

  const notice =
    typeof query["connected"] === "string"
      ? "The destination account is connected."
      : typeof query["publishError"] === "string"
        ? query["publishError"]
        : null;

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
            <Send size={14} />
            Publishing
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white">
            Publishing engine
          </h1>
          <p className="mt-1 max-w-2xl text-xs text-[#777b84]">
            Connect a real destination, validate what a project actually
            approved, then publish or schedule it. A publication is confirmed
            only by the provider&apos;s own response — queuing is not publishing.
          </p>
        </div>

        <div className="mt-6">
          <PublishingWorkspace
            projectId={projectId}
            initialConnections={connections}
            initialPublications={publications}
            providers={catalog.providers}
            cryptoProblem={catalog.cryptoProblem}
            writingOptions={documents.map((document) => ({
              id: document.id,
              title: document.title,
            }))}
            deliverableOptions={deliverableOptions}
            notice={notice}
          />
        </div>
      </div>
    </AppShell>
  );
}

export const metadata = {
  title: "Publishing",
};
