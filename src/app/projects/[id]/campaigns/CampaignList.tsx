"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "../../../../components/ui/Button";
import type { CampaignRecord } from "../../../../modules/campaign-engine/domain/types";

type CampaignListProps = {
  projectId: string;
  initialCampaigns: CampaignRecord[];
};

const EMPTY_FORM = {
  name: "",
  objective: "",
  audienceSummary: "",
  keyMessage: "",
};

export function CampaignList({ projectId, initialCampaigns }: CampaignListProps) {
  const router = useRouter();
  const [campaigns] = useState(initialCampaigns);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");

    try {
      const response = await fetch(`/api/projects/${projectId}/campaigns`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim() || "Untitled campaign",
          objective: form.objective.trim() || "Reach the target audience",
          audienceSummary: form.audienceSummary.trim() || "The target audience",
          keyMessage: form.keyMessage.trim() || "The core promise",
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(payload.error ?? "Could not create campaign");
        return;
      }

      const payload = (await response.json()) as {
        campaign: { id: string };
      };
      router.push(`/projects/${projectId}/campaigns/${payload.campaign.id}`);
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <div>
        {campaigns.length === 0 ? (
          <p
            className="rounded-xl border border-dashed border-[#30343c] p-6 text-sm text-[#777b84]"
            data-testid="campaign-empty"
          >
            No campaigns yet. Create one to build a launch plan.
          </p>
        ) : (
          <ul className="space-y-2">
            {campaigns.map((campaign) => (
              <li key={campaign.id}>
                <Link
                  href={`/projects/${projectId}/campaigns/${campaign.id}`}
                  data-testid="campaign-row"
                  data-campaign-id={campaign.id}
                  className="flex items-center justify-between rounded-xl border border-[#202329] bg-[#101216] px-4 py-3 hover:border-[#30343c]"
                >
                  <span>
                    <span className="block text-sm text-white">
                      {campaign.name}
                    </span>
                    <span className="text-xs text-[#62666f]">
                      {campaign.status} · revision {campaign.revisionNumber}
                    </span>
                  </span>
                  <span className="text-xs text-[#62666f]">
                    {campaign.hasLaunchKit ? "Launch kit ready" : "No kit yet"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <form
        onSubmit={create}
        className="h-fit rounded-xl border border-[#202329] bg-[#101216] p-4"
      >
        <p className="text-xs uppercase tracking-wide text-[#62666f]">
          New campaign
        </p>

        <label className="mt-3 block text-[10px] text-[#777b84]">
          Name
          <input
            data-testid="campaign-name"
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            placeholder="Spring launch"
            className="mt-1 w-full rounded-md border border-[#30343c] bg-[#15171c] px-2 py-1.5 text-xs text-white"
          />
        </label>

        <label className="mt-3 block text-[10px] text-[#777b84]">
          Objective
          <input
            data-testid="campaign-objective"
            value={form.objective}
            onChange={(event) =>
              setForm({ ...form, objective: event.target.value })
            }
            placeholder="Drive 500 sign-ups"
            className="mt-1 w-full rounded-md border border-[#30343c] bg-[#15171c] px-2 py-1.5 text-xs text-white"
          />
        </label>

        <label className="mt-3 block text-[10px] text-[#777b84]">
          Audience
          <input
            data-testid="campaign-audience"
            value={form.audienceSummary}
            onChange={(event) =>
              setForm({ ...form, audienceSummary: event.target.value })
            }
            placeholder="Regulated product teams"
            className="mt-1 w-full rounded-md border border-[#30343c] bg-[#15171c] px-2 py-1.5 text-xs text-white"
          />
        </label>

        <label className="mt-3 block text-[10px] text-[#777b84]">
          Key message
          <input
            data-testid="campaign-key-message"
            value={form.keyMessage}
            onChange={(event) =>
              setForm({ ...form, keyMessage: event.target.value })
            }
            placeholder="Ship without a bottleneck"
            className="mt-1 w-full rounded-md border border-[#30343c] bg-[#15171c] px-2 py-1.5 text-xs text-white"
          />
        </label>

        {error && (
          <p className="mt-3 text-xs text-red-300" data-testid="campaign-create-error">
            {error}
          </p>
        )}

        <Button
          className="mt-4 w-full"
          disabled={busy}
          data-testid="create-campaign"
        >
          Create campaign
        </Button>
      </form>
    </div>
  );
}
