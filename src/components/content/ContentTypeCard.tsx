import {
  AudioLines,
  Clapperboard,
  ImageIcon,
  Megaphone,
  PenLine,
} from "lucide-react";
import type { ContentType } from "../../lib/content-registry";

const icons = {
  video: Clapperboard,
  image: ImageIcon,
  writing: PenLine,
  audio: AudioLines,
  campaign: Megaphone,
};

export function ContentTypeCard({
  content,
}: {
  content: ContentType;
}) {
  const Icon = icons[content.category];

  return (
    <button
      type="button"
      className="group flex min-h-40 flex-col rounded-2xl border border-[#24272e] bg-[#101216] p-5 text-left transition-all hover:-translate-y-0.5 hover:border-[#3a3e47] hover:bg-[#14161b]"
    >
      <div className="mb-6 flex h-9 w-9 items-center justify-center rounded-lg border border-[#30343c] bg-[#15171c] text-[#b4b7bf] transition-colors group-hover:text-white">
        <Icon size={17} />
      </div>

      <div className="mt-auto">
        <div className="text-sm font-medium text-white">{content.name}</div>
        <div className="mt-1 text-xs leading-5 text-[#777b84]">
          {content.description}
        </div>
      </div>
    </button>
  );
}