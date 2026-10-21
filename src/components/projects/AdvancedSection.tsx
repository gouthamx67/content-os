import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";

/**
 * A collapsed group for everything that is not the first thing a user should
 * do. The project page keeps every tool, but the default view is the one
 * action that produces content; this is where the controls live once someone
 * asks for them.
 */
export function AdvancedSection({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <details
      id={id}
      className="group scroll-mt-6 rounded-2xl border border-[#24272e] bg-[#101216]"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-5 [&::-webkit-details-marker]:hidden">
        <div>
          <h2 className="text-sm font-medium text-white">{title}</h2>
          <p className="mt-1 text-xs text-[#777b84]">{description}</p>
        </div>
        <ChevronDown
          size={18}
          className="shrink-0 text-[#62666f] transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="space-y-6 border-t border-[#202329] p-5">{children}</div>
    </details>
  );
}
