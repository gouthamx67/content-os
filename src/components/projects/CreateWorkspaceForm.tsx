"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "../ui/Button";

export function CreateWorkspaceForm() {
  const router = useRouter();

  const [name, setName] = useState("");

  const [error, setError] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    setError(null);

    setLoading(true);

    try {
      const response = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error ?? "Unable to create workspace");

        return;
      }

      setName("");

      router.refresh();
    } catch {
      setError("Unable to create workspace");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-end gap-3">
      <div className="flex-1">
        <label
          htmlFor="workspace-name"
          className="mb-1.5 block text-sm text-[#b4b7bf]"
        >
          New workspace
        </label>

        <input
          id="workspace-name"
          type="text"
          required
          maxLength={80}
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="w-full rounded-lg border border-[#30343c] bg-[#15171c] px-3 py-2.5 text-sm text-white outline-none transition-colors placeholder:text-[#62666f] focus:border-white/40"
          placeholder="Marketing team"
        />
      </div>

      <Button type="submit" disabled={loading}>
        {loading ? "Creating…" : "Create workspace"}
      </Button>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}
    </form>
  );
}