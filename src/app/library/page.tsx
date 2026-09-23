import { Layers3 } from "lucide-react";
import { AppShell } from "../../components/layout/AppShell";

export default function LibraryPage() {
  return (
    <AppShell>
      <div className="p-5 sm:p-8">
        <h1 className="text-3xl font-semibold tracking-tight text-white">
          Library
        </h1>

        <p className="mt-2 text-sm text-[#777b84]">
          Generated videos, images, writing, audio, assets, and campaign
          outputs.
        </p>

        <div className="mt-10 rounded-2xl border border-dashed border-[#30343c] p-12 text-center">
          <Layers3 className="mx-auto text-[#62666f]" size={28} />

          <p className="mt-4 text-sm text-[#777b84]">
            Your generated content will appear here.
          </p>
        </div>
      </div>
    </AppShell>
  );
}