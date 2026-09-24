"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "../ui/Button";

export function CreateProjectForm({
  workspaceId,
}: {
  workspaceId: string;
}) {
  const router = useRouter();

  const [name, setName] = useState("");

  const [error, setError] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    setError(null);

    setLoading(true);

    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/projects`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        },
      );

      const data = await response.json();

      if (!response.ok) {
        setError(data.error ?? "Unable to create project");

        return;
      }

      setName("");

      router.refresh();
    } catch {
      setError("Unable to create project");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-end gap-3">
      <div className="flex-1">
        <label
          htmlFor={`project-name-${workspaceId}`}
          className="mb-1.5 block text-sm text-[#b4b7bf]"
        >
          Project name
        </label>

        <input
          id={`project-name-${workspaceId}`}
          type="text"
          required
          maxLength={120}
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="w-full rounded-lg border border-[#30343c] bg-[#15171c] px-3 py-2.5 text-sm text-white outline-none transition-colors placeholder:text-[#62666f] focus:border-white/40"
          placeholder="Website refresh"
        />
      </div>

      <Button type="submit" disabled={loading}>
        <Plus size={15} />
        {loading ? "Creating…" : "Create"}
      </Button>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}
    </form>
  );
}