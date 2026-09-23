import { contentRegistry } from "../../lib/content-registry";
import { ContentTypeCard } from "./ContentTypeCard";

export function ContentGrid() {
  return (
    <section className="space-y-5">
      <div>
        <div className="text-sm font-medium text-white">
          Or start from a content type
        </div>
        <div className="mt-1 text-sm text-[#777b84]">
          Everything here is powered by the same Content OS creative engine.
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {contentRegistry.map((content) => (
          <ContentTypeCard key={content.id} content={content} />
        ))}
      </div>
    </section>
  );
}