"use client";

import type { GraphicTemplateType } from "../domain/types";

export const TEMPLATE_CHOICES: ReadonlyArray<{
  value: GraphicTemplateType;
  label: string;
  description: string;
}> = [
  {
    value: "PRODUCT_HERO",
    label: "Product hero",
    description: "Product name and value proposition",
  },
  {
    value: "FEATURE_CALLOUT",
    label: "Feature callout",
    description: "One feature with supporting copy",
  },
  {
    value: "QUOTE_CARD",
    label: "Quote card",
    description: "A claim or testimonial",
  },
  {
    value: "SOCIAL_POST",
    label: "Social post",
    description: "Feed-sized announcement",
  },
  {
    value: "PROMO_CARD",
    label: "Promo card",
    description: "Offer with a call to action",
  },
];

/**
 * Picks the layout a generation draws into.
 *
 * The template is chosen before the prompt because it decides the canvas and the
 * fields the copy comes from; changing it after the fact would silently discard
 * whatever did not fit.
 */
export function TemplatePicker({
  value,
  onChange,
  disabled = false,
}: {
  value: GraphicTemplateType;
  onChange: (value: GraphicTemplateType) => void;
  disabled?: boolean;
}) {
  return (
    <div
      data-testid="template-picker"
      className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5"
    >
      {TEMPLATE_CHOICES.map((choice) => {
        const selected = choice.value === value;

        return (
          <button
            key={choice.value}
            type="button"
            data-testid={`template-${choice.value}`}
            aria-pressed={selected}
            disabled={disabled}
            onClick={() => onChange(choice.value)}
            className={[
              "rounded-lg border px-3 py-2 text-left text-xs transition-colors disabled:opacity-50",
              selected
                ? "border-sky-400 bg-[#15171c] text-white"
                : "border-[#202329] bg-[#0b0c0f] text-[#b4b7bf] hover:text-white",
            ].join(" ")}
          >
            <span className="block font-medium">{choice.label}</span>
            <span className="mt-1 block text-[10px] text-[#62666f]">
              {choice.description}
            </span>
          </button>
        );
      })}
    </div>
  );
}
