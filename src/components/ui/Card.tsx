import type { HTMLAttributes } from "react";

export function Card({
  className = "",
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={[
        "rounded-2xl border border-[#24272e] bg-[#101216]",
        className,
      ].join(" ")}
      {...props}
    />
  );
}