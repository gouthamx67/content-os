export type ContentCategory =
  | "video"
  | "image"
  | "writing"
  | "audio"
  | "campaign";

export type ContentRequest = {
  projectId: string;

  type: string;
  category: ContentCategory;

  instruction?: string;

  platform?: string;
  durationSeconds?: number;
  aspectRatio?: string;

  tone?: string;
  creativeMode?: "guided" | "balanced" | "wild";

  language?: string;

  options?: Record<string, unknown>;
};

export type ContentPlan = {
  id: string;

  projectId: string;
  contentRequestId: string;

  title: string;
  concept: string;
  hook: string;

  audience: string;
  objective: string;
  callToAction?: string;

  scenes: ContentScene[];

  voiceover?: VoiceoverPlan;
  music?: MusicPlan;
};

export type ContentScene = {
  id: string;

  order: number;

  purpose: string;

  visual: string;
  narration?: string;
  onScreenText?: string;

  durationSeconds: number;

  sourceAssetIds?: string[];
  sourceIds?: string[];
};

export type VoiceoverPlan = {
  style: string;
  script: string;
  language: string;
};

export type MusicPlan = {
  mood: string;
  intensity: string;
  timingNotes?: string;
};

export type ContentArtifact = {
  id: string;

  projectId: string;

  type: string;
  category: ContentCategory;

  status: "planned" | "generating" | "ready" | "failed";

  uri?: string;

  metadata?: Record<string, unknown>;

  createdAt: string;
  updatedAt: string;
};