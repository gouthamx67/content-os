import type { ButtonHTMLAttributes } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
};

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonProps) {
  const variants = {
    primary:
      "bg-white text-black hover:bg-neutral-200 border border-white",
    secondary:
      "bg-[#15171c] text-white hover:bg-[#1b1e24] border border-[#30343c]",
    ghost:
      "bg-transparent text-[#b4b7bf] hover:text-white hover:bg-[#15171c] border border-transparent",
  };

  return (
    <button
      className={[
        "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-50",
        variants[variant],
        className,
      ].join(" ")}
      {...props}
    />
  );
}