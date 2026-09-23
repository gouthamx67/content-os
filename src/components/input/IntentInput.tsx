"use client";

import { Sparkles } from "lucide-react";
import { useState } from "react";

const intents = [
  "Make everything",
  "Product video",
  "Social launch kit",
  "Advertisement",
  "Surprise me",
];

export function IntentInput() {
  const [intent, setIntent] = useState("");

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium text-white">
        <Sparkles size={15} />
        What do you want to make?
      </div>

      <textarea
        value={intent}
        onChange={(event) => setIntent(event.target.value)}
        placeholder="Tell Content OS what you want. You can be specific—or just say what you're trying to achieve."
        className="min-h-24 w-full resize-none rounded-xl border border-[#24272e] bg-[#101216] px-4 py-3 text-sm text-white outline-none transition-colors placeholder:text-[#62666f] focus:border-[#444851]"
      />

      <div className="flex flex-wrap gap-2">
        {intents.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setIntent(item)}
            className={[
              "min-h-9 rounded-full border px-3 text-xs transition-colors",
              intent === item
                ? "border-white bg-white text-black"
                : "border-[#30343c] bg-[#101216] text-[#8d919a] hover:border-[#4a4e56] hover:text-white",
            ].join(" ")}
          >
            {item}
          </button>
        ))}
      </div>
    </div>
  );
}