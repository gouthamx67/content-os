import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { ArrowLeft, Clapperboard } from "lucide-react";
import { getCurrentUser } from "../../../../infrastructure/auth/current-user";
import {
  editorService,
  projectService,
} from "../../../../infrastructure/services";
import { HttpError } from "../../../../lib/http";
import { AppShell } from "../../../../components/layout/AppShell";
import { EditorList } from "./EditorList";

type EditorListPageProps = {
  params: Promise<{ id: string }>;
};

export default async function EditorListPage({ params }: EditorListPageProps) {
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

  const documents = await editorService.listDocuments({
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
            <Clapperboard size={14} />
            Content editor
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white">
            Edits
          </h1>
          <p className="mt-1 text-xs text-[#777b84]">
            Reassemble any imported composition into a timeline you can edit
            frame by frame, then finalise when it is ready.
          </p>
        </div>

        <div className="mt-6">
          <EditorList projectId={projectId} initialDocuments={documents} />
        </div>
      </div>
    </AppShell>
  );
}

export const metadata = {
  title: "Content editor",
};