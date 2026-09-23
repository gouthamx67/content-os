import type {
  ContentRequest,
  ContentPlan,
  Project,
} from "../../core/domain";

export type OrchestrationContext = {
  project: Project;

  request: ContentRequest;
};

export interface ContentOrchestrator {
  plan(
    context: OrchestrationContext,
  ): Promise<ContentPlan>;

  generate(
    context: OrchestrationContext,
    plan: ContentPlan,
  ): Promise<void>;

  finalize(
    context: OrchestrationContext,
    plan: ContentPlan,
  ): Promise<void>;
}