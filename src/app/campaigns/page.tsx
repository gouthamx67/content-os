import { BarChart3 } from "lucide-react";
import { AppShell } from "../../components/layout/AppShell";

export default function CampaignsPage() {
  return (
    <AppShell>
      <div className="p-5 sm:p-8">
        <h1 className="text-3xl font-semibold tracking-tight text-white">
          Campaigns
        </h1>

        <p className="mt-2 text-sm text-[#777b84]">
          Coordinate launch content across platforms from one creative system.
        </p>

        <div className="mt-10 rounded-2xl border border-dashed border-[#30343c] p-12 text-center">
          <BarChart3 className="mx-auto text-[#62666f]" size={28} />

          <p className="mt-4 text-sm text-[#777b84]">
            Campaigns will appear here.
          </p>
        </div>
      </div>
    </AppShell>
  );
}