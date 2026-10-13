import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { ArrowLeft, LayoutGrid } from "lucide-react";
import { getCurrentUser } from "../../../../infrastructure/auth/current-user";
import {
  projectService,
  adaptationService,
  visualCompositionService,
  imageRepository,
  writingGenerationService,
  writingRepository,
} from "../../../../infrastructure/services";
import { HttpError } from "../../../../lib/http";
import { AppShell } from "../../../../components/layout/AppShell";
import { listFormatContracts } from "../../../../modules/multiformat-engine/formats/registry";
import { adaptationBatchDetailView } from "../../../../lib/multiformat-http";
import { AdaptationWorkspace } from "./AdaptationWorkspace";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function MultiformatPage({ params }: PageProps) {
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

  const [documents, compositions, images, batchRecords] = await Promise.all([
    writingGenerationService.listDocuments({ projectId, userId: user.id }),
    visualCompositionService.listCompositions({ projectId, userId: user.id }),
    imageRepository.listAssets(projectId, { limit: 50 }),
    adaptationService.listBatches({ projectId, userId: user.id, limit: 20 }),
  ]);

  // The picker shows the batch with its jobs, so each one is read in full rather
  // than leaving the client to stitch a batch to jobs it has never seen.
  const batches = (
    await Promise.all(
      batchRecords.map((record) =>
        adaptationService.getBatch({
          projectId,
          batchId: record.id,
          userId: user.id,
        }),
      ),
    )
  ).map((detail) => adaptationBatchDetailView(detail));

  // Writing variants are listed per document, so the picker can offer one row per
  // ready variant rather than asking the user to know a variant id.
  const variantsByDocument = await Promise.all(
    documents.map(async (document) => ({
      documentId: document.id,
      variants: await writingRepository.listVariants(document.id),
    })),
  );

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
            <LayoutGrid size={14} />
            Multi-format
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white">
            Adapt one source into many
          </h1>
          <p className="mt-1 max-w-2xl text-xs text-[#777b84]">
            Copy is trimmed, images are re-cropped and compositions are re-framed.
            Nothing is rewritten and nothing is invented — every variant stays
            traceable to the source it came from.
          </p>
        </div>

        <div className="mt-6">
          <AdaptationWorkspace
            projectId={projectId}
            formats={listFormatContracts()}
            initialBatches={batches}
            sources={{
              writing: variantsByDocument.map((entry) => ({
                documentId: entry.documentId,
                variants: entry.variants.map((variant) => ({
                  id: variant.id,
                  label: variant.label,
                  preview: variant.text.slice(0, 160),
                })),
              })),
              images: images
                .filter((asset) => asset.deletedAt === null)
                .map((asset) => ({
                  id: asset.id,
                  label: `${asset.width}x${asset.height}`,
                  preview: asset.transparent ? "transparent" : asset.mimeType,
                })),
              compositions: compositions.map((composition) => ({
                id: composition.id,
                label: composition.name,
                preview: `${composition.width}x${composition.height} · ${composition.layers.length} layers`,
              })),
            }}
          />
        </div>
      </div>
    </AppShell>
  );
}

export const metadata = {
  title: "Multi-format adaptation",
};
