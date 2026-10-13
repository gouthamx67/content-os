import type {
  CampaignDeliverableRecord,
  CampaignReadiness,
  CampaignReadinessCheck,
  CampaignRecord,
} from "./types";
import { findScheduleConflicts } from "./schedule";

/**
 * What the service learned about a deliverable's links before asking readiness
 * to judge them. Readiness itself performs no IO; it turns facts into checks so
 * the same validator can run inside a transaction, in a test, or in an export
 * without reaching for a database.
 */
export type LinkResolution = {
  deliverableId: string;
  missing: { kind: string; id: string }[];
  crossProject: { kind: string; id: string }[];
  requiredAssets: number;
  readyAssets: number;
};

export type ReadinessInput = {
  campaign: CampaignRecord;
  deliverables: readonly CampaignDeliverableRecord[];
  grounding: {
    missingSourceIds: string[];
  };
  links: readonly LinkResolution[];
};

export function evaluateReadiness(input: ReadinessInput): CampaignReadiness {
  const checks: CampaignReadinessCheck[] = [];

  const { campaign, deliverables } = input;

  if (!campaign.strategy) {
    checks.push({
      code: "STRATEGY_MISSING",
      severity: "BLOCKING",
      entity: { type: "CAMPAIGN", id: campaign.id },
      message: "The campaign has no launch strategy",
      remediation: "Generate and accept a launch strategy before review.",
    });
  }

  if (!campaign.plan || deliverables.length === 0) {
    checks.push({
      code: "PLAN_MISSING",
      severity: "BLOCKING",
      entity: { type: "CAMPAIGN", id: campaign.id },
      message: "The campaign has no planned deliverables",
      remediation: "Build a campaign plan with at least one deliverable.",
    });
  }

  if (input.grounding.missingSourceIds.length > 0) {
    checks.push({
      code: "GROUNDING_SOURCE_MISSING",
      severity: "BLOCKING",
      entity: { type: "CAMPAIGN", id: campaign.id },
      message: `${input.grounding.missingSourceIds.length} grounding source(s) are no longer available`,
      remediation:
        "Remove the missing sources or re-select sources that still exist in the project.",
    });
  }

  const linkById = new Map(input.links.map((l) => [l.deliverableId, l]));

  for (const deliverable of deliverables) {
    const link = linkById.get(deliverable.id);

    if (link && link.crossProject.length > 0) {
      checks.push({
        code: "LINKED_ARTIFACT_CROSS_PROJECT",
        severity: "BLOCKING",
        entity: { type: "DELIVERABLE", id: deliverable.id },
        message: `"${deliverable.title}" links an artifact from another project`,
        remediation: "Unlink the foreign artifact and link one from this project.",
      });
    }

    if (link && link.missing.length > 0) {
      checks.push({
        code: "LINKED_ARTIFACT_MISSING",
        severity: "BLOCKING",
        entity: { type: "DELIVERABLE", id: deliverable.id },
        message: `"${deliverable.title}" references ${link.missing.length} artifact(s) that no longer exist`,
        remediation: "Re-link the deliverable to existing work, or clear the stale link.",
      });
    }

    if (!deliverable.scheduledFor) {
      checks.push({
        code: "DELIVERABLE_UNSCHEDULED",
        severity: "WARNING",
        entity: { type: "DELIVERABLE", id: deliverable.id },
        message: `"${deliverable.title}" has no scheduled time`,
        remediation:
          "Set a scheduled time so the launch has a sequence, or accept it as unscheduled.",
      });
    }

    if (deliverable.status === "BLOCKED") {
      checks.push({
        code: "DELIVERABLE_BLOCKED",
        severity: "BLOCKING",
        entity: { type: "DELIVERABLE", id: deliverable.id },
        message: `"${deliverable.title}" is marked blocked`,
        remediation: "Resolve the blocker or remove the deliverable from the plan.",
      });
    }

    if (
      link &&
      link.requiredAssets > 0 &&
      link.readyAssets < link.requiredAssets
    ) {
      checks.push({
        code: "ASSET_MISSING",
        severity: "WARNING",
        entity: { type: "DELIVERABLE", id: deliverable.id },
        message: `"${deliverable.title}" is missing ${link.requiredAssets - link.readyAssets} linked asset(s)`,
        remediation: "Produce or attach the missing creative assets.",
      });
    }
  }

  for (const conflict of findScheduleConflicts(deliverables)) {
    checks.push(conflict);
  }

  checks.push({
    code: "SUMMARY",
    severity: "INFO",
    entity: { type: "CAMPAIGN", id: campaign.id },
    message: `${deliverables.length} deliverable(s) across ${countPlatforms(deliverables)} platform(s)`,
    remediation: "",
  });

  return {
    ready: !checks.some((check) => check.severity === "BLOCKING"),
    checkedAt: new Date().toISOString(),
    checks,
    summary: summarize(checks),
  };
}

function countPlatforms(
  deliverables: readonly CampaignDeliverableRecord[],
): number {
  return new Set(deliverables.map((d) => d.platformId)).size;
}

function summarize(checks: readonly CampaignReadinessCheck[]): {
  blocking: number;
  warning: number;
  info: number;
} {
  const summary = { blocking: 0, warning: 0, info: 0 };
  for (const check of checks) {
    if (check.severity === "BLOCKING") summary.blocking += 1;
    else if (check.severity === "WARNING") summary.warning += 1;
    else summary.info += 1;
  }
  return summary;
}
