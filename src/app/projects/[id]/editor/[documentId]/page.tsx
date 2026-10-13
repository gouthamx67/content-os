import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getCurrentUser } from "../../../../../infrastructure/auth/current-user";
import {
  editorService,
  projectService,
} from "../../../../../infrastructure/services";
import { HttpError } from "../../../../../lib/http";
import { EditorWorkspace } from "./EditorWorkspace";

type EditorPageProps = {
  params: Promise<{ id: string; documentId: string }>;
};

export default async function EditorPage({ params }: EditorPageProps) {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  const { id: projectId, documentId } = await params;

  try {
    await projectService.getAuthorized(projectId, user.id);
  } catch (error) {
    if (error instanceof HttpError) {
      if (error.status === 404) notFound();
      if (error.status === 403) redirect("/projects");
    }
    throw error;
  }

  let detail;

  try {
    detail = await editorService.getDocument({
      projectId,
      userId: user.id,
      documentId,
    });
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) {
      notFound();
    }
    throw error;
  }

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 border-b border-[#202329] px-4 py-2">
        <Link
          href={`/projects/${projectId}/editor`}
          className="inline-flex items-center gap-1.5 text-xs text-[#777b84] hover:text-white"
        >
          <ArrowLeft size={14} />
          Edits
        </Link>
      </div>
      <EditorWorkspace
        projectId={projectId}
        document={detail.document}
        headRevision={{
          id: detail.revision.id,
          number: detail.revision.revisionNumber,
        }}
        snapshot={detail.snapshot}
      />
    </div>
  );
}

export const metadata = {
  title: "Content editor",
};