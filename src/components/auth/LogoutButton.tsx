"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";

export function LogoutButton() {
  const router = useRouter();

  const [loading, setLoading] = useState(false);

  async function handleLogout() {
    setLoading(true);

    try {
      await fetch("/api/auth/logout", {
        method: "POST",
      });

      router.push("/login");

      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      disabled={loading}
      className="inline-flex items-center gap-2 rounded-lg border border-[#30343c] px-3 py-2 text-sm text-[#b4b7bf] transition-colors hover:bg-[#15171c] hover:text-white disabled:opacity-50"
    >
      <LogOut size={14} />
      {loading ? "Signing out…" : "Sign out"}
    </button>
  );
}