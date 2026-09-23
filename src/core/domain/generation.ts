export type GenerationJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed";

export type GenerationJob = {
  id: string;

  projectId: string;

  type: string;

  status: GenerationJobStatus;

  progress: number;

  input?: Record<string, unknown>;
  output?: Record<string, unknown>;

  error?: string;

  createdAt: string;
  startedAt?: string;
  completedAt?: string;
};