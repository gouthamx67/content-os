import Link from "next/link";
import { redirect } from "next/navigation";
import { FolderKanban, Layers3, Users } from "lucide-react";
import { getCurrentUser } from "../../infrastructure/auth/current-user";
import {
  projectService,
  workspaceService,
} from "../../infrastructure/services";
import { AppShell } from "../../components/layout/AppShell";
import { LogoutButton } from "../../components/auth/LogoutButton";
import { CreateWorkspaceForm } from "../../components/projects/CreateWorkspaceForm";
import { CreateProjectForm } from "../../components/projects/CreateProjectForm";

export default async function ProjectsPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  const memberships = await workspaceService.listForUser(
    user.id,
  );

  const workspaces = await Promise.all(
    memberships.map(async (membership) => ({
      workspace: membership.workspace,
      role: membership.member.role,
      projects: await projectService.listForWorkspace(
        membership.workspace.id,
        user.id,
      ),
    })),
  );

  const totalProjects = workspaces.reduce(
    (sum, entry) => sum + entry.projects.length,
    0,
  );

  return (
    <AppShell>
      <div className="p-5 sm:p-8">
        <div className="flex flex-col justify-between gap-5 border-b border-[#202329] pb-8 sm:flex-row sm:items-end">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-white">
              Projects
            </h1>

            <p className="mt-2 text-sm text-[#777b84]">
              Signed in as{" "}
              <span className="text-white">{user.email}</span>.{" "}
              {workspaces.length}{" "}
              {workspaces.length === 1 ? "workspace" : "workspaces"},{" "}
              {totalProjects}{" "}
              {totalProjects === 1 ? "project" : "projects"}.
            </p>
          </div>

          <LogoutButton />
        </div>

        <div className="mt-8">
          <div className="flex items-center gap-2 text-sm text-[#8d919a]">
            <Users size={15} />
            Workspaces
          </div>

          {workspaces.length === 0 ? (
            <div className="mt-4 flex flex-col items-start gap-4 rounded-2xl border border-dashed border-[#30343c] p-8">
              <div className="flex items-center gap-2 text-sm text-white">
                <Layers3 size={16} />
                You are not part of any workspace yet
              </div>

              <p className="text-sm text-[#777b84]">
                Create a workspace to start organizing your projects.
              </p>

              <div className="w-full max-w-md">
                <CreateWorkspaceForm />
              </div>
            </div>
          ) : (
            <div className="mt-4 space-y-8">
              {workspaces.map(({ workspace, role, projects }) => (
                <section
                  key={workspace.id}
                  className="rounded-2xl border border-[#24272e] bg-[#101216] p-5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-medium text-white">
                        {workspace.name}
                      </h2>

                      <p className="mt-0.5 text-xs uppercase tracking-wide text-[#62666f]">
                        {role} · {projects.length}{" "}
                        {projects.length === 1 ? "project" : "projects"}
                      </p>
                    </div>
                  </div>

                  {projects.length === 0 ? (
                    <div className="mt-4 rounded-xl border border-dashed border-[#30343c] p-6 text-sm text-[#777b84]">
                      No projects in this workspace yet.
                    </div>
                  ) : (
                    <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {projects.map((project) => (
                        <Link
                          key={project.id}
                          href={`/projects/${project.id}`}
                          className="group rounded-xl border border-[#24272e] bg-[#15171c] p-4 transition-colors hover:border-[#30343c] hover:bg-[#1b1e24]"
                        >
                          <div className="flex items-center gap-2 text-[#8d919a]">
                            <FolderKanban size={15} />
                            {project.archived ? (
                              <span className="rounded bg-[#30343c] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[#8d919a]">
                                Archived
                              </span>
                            ) : null}
                          </div>

                          <h3 className="mt-3 truncate text-sm font-medium text-white">
                            {project.name}
                          </h3>

                          <p className="mt-1 text-xs text-[#62666f]">
                            {new Date(
                              project.createdAt,
                            ).toLocaleDateString()}
                          </p>
                        </Link>
                      ))}
                    </div>
                  )}

                  <div className="mt-5 border-t border-[#24272e] pt-5">
                    <CreateProjectForm workspaceId={workspace.id} />
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}