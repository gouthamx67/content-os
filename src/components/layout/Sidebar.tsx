"use client";

import {
  BarChart3,
  FolderKanban,
  Layers3,
  Plus,
  Settings,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const navigation = [
  {
    label: "Projects",
    href: "/projects",
    icon: FolderKanban,
  },
  {
    label: "Library",
    href: "/library",
    icon: Layers3,
  },
  {
    label: "Campaigns",
    href: "/campaigns",
    icon: BarChart3,
  },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden w-60 shrink-0 border-r border-[#202329] bg-[#0b0c0f] lg:flex lg:flex-col">
      <div className="flex h-16 items-center border-b border-[#202329] px-5">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-white text-black">
            <Sparkles size={15} />
          </div>

          <span className="text-sm font-semibold tracking-tight">
            Content OS
          </span>
        </Link>
      </div>

      <div className="p-3">
        <Link
          href="/"
          className="flex min-h-10 items-center gap-2 rounded-lg border border-[#30343c] bg-[#15171c] px-3 text-sm font-medium text-white transition-colors hover:bg-[#1b1e24]"
        >
          <Plus size={16} />
          New project
        </Link>
      </div>

      <nav className="flex-1 space-y-1 px-3">
        {navigation.map((item) => {
          const Icon = item.icon;
          const active = pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={[
                "flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm transition-colors",
                active
                  ? "bg-[#181b20] text-white"
                  : "text-[#8d919a] hover:bg-[#14161a] hover:text-white",
              ].join(" ")}
            >
              <Icon size={16} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-[#202329] p-3">
        <Link
          href="/settings"
          className="flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm text-[#8d919a] hover:bg-[#14161a] hover:text-white"
        >
          <Settings size={16} />
          Settings
        </Link>
      </div>
    </aside>
  );
}