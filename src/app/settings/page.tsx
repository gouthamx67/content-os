import { Settings } from "lucide-react";
import { AppShell } from "../../components/layout/AppShell";

export default function SettingsPage() {
  return (
    <AppShell>
      <div className="p-5 sm:p-8">
        <h1 className="text-3xl font-semibold tracking-tight text-white">
          Settings
        </h1>

        <p className="mt-2 text-sm text-[#777b84]">
          Manage workspace preferences and team access.
        </p>

        <div className="mt-10 rounded-2xl border border-dashed border-[#30343c] p-12 text-center">
          <Settings className="mx-auto text-[#62666f]" size={28} />

          <p className="mt-4 text-sm text-[#777b84]">
            Settings will appear here.
          </p>
        </div>
      </div>
    </AppShell>
  );
}