export type ContentCategory =
  | "video"
  | "image"
  | "writing"
  | "audio"
  | "campaign";

export type ContentType = {
  id: string;
  category: ContentCategory;
  name: string;
  description: string;
  examples: string[];
};

export const contentRegistry: ContentType[] = [
  {
    id: "video.product_demo",
    category: "video",
    name: "Product Demo",
    description: "Show the product solving a real problem.",
    examples: ["Dashboard walkthrough", "Feature demonstration"],
  },
  {
    id: "video.launch",
    category: "video",
    name: "Launch Video",
    description: "Turn a product into a polished launch story.",
    examples: ["Product launch", "Feature launch"],
  },
  {
    id: "video.ad",
    category: "video",
    name: "Advertisement",
    description: "Create a conversion-focused product advertisement.",
    examples: ["Performance ad", "Cinematic ad"],
  },
  {
    id: "video.explainer",
    category: "video",
    name: "Explainer",
    description: "Explain what the product does and why it matters.",
    examples: ["Educational", "Problem → solution"],
  },
  {
    id: "video.social",
    category: "video",
    name: "Social Video",
    description: "Create short-form content for social platforms.",
    examples: ["TikTok", "Reels", "Shorts"],
  },
  {
    id: "image.thumbnail",
    category: "image",
    name: "Thumbnail",
    description: "Create attention-grabbing thumbnails.",
    examples: ["YouTube", "Launch"],
  },
  {
    id: "image.ad",
    category: "image",
    name: "Ad Creative",
    description: "Create static advertising creative.",
    examples: ["Paid social", "Display"],
  },
  {
    id: "image.hero",
    category: "image",
    name: "Website Hero",
    description: "Create a visual hero for a landing page.",
    examples: ["Product hero", "Feature hero"],
  },
  {
    id: "image.carousel",
    category: "image",
    name: "Carousel",
    description: "Turn product information into a visual story.",
    examples: ["LinkedIn carousel", "Instagram carousel"],
  },
  {
    id: "writing.linkedin",
    category: "writing",
    name: "LinkedIn Post",
    description: "Create a professional social post.",
    examples: ["Founder announcement", "Product launch"],
  },
  {
    id: "writing.x",
    category: "writing",
    name: "X Post / Thread",
    description: "Create concise social content.",
    examples: ["Launch post", "Thread"],
  },
  {
    id: "writing.product_hunt",
    category: "writing",
    name: "Product Hunt",
    description: "Create a complete Product Hunt listing.",
    examples: ["Tagline", "Description", "Maker comment"],
  },
  {
    id: "writing.blog",
    category: "writing",
    name: "Blog Post",
    description: "Turn product knowledge into long-form content.",
    examples: ["Educational article", "Launch article"],
  },
  {
    id: "audio.voiceover",
    category: "audio",
    name: "Voiceover",
    description: "Generate narration matched to the content.",
    examples: ["Founder", "Narrator", "Documentary"],
  },
  {
    id: "audio.ad",
    category: "audio",
    name: "Audio Advertisement",
    description: "Create an audio-first promotional experience.",
    examples: ["Podcast ad", "Radio-style ad"],
  },
  {
    id: "campaign.launch",
    category: "campaign",
    name: "Launch Campaign",
    description: "Generate a coordinated multi-platform launch.",
    examples: ["Product launch", "Feature launch"],
  },
];