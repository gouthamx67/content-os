import type {
  CampaignBrief,
  CampaignDeliverableRecord,
  CampaignReadinessCheck,
} from "./types";
import { throwFormatError } from "./channels";

export function parseScheduleInstant(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * A schedule is only meaningful relative to the launch window. When the campaign
 * declares one, a deliverable outside it is refused rather than warned about:
 * publishing before the window opens or after it closes is not a judgement call.
 */
export function assertSchedulable(
  scheduledFor: string,
  brief: CampaignBrief,
): string {
  const instant = parseScheduleInstant(scheduledFor);
  if (instant === null) {
    throwFormatError(
      "CAMPAIGN_SCHEDULE_INVALID",
      "Scheduled time must be an ISO timestamp",
    );
  }

  const window = brief.launchWindow;
  if (!window) return new Date(instant).toISOString();

  const start = parseScheduleInstant(window.start);
  const end = parseScheduleInstant(window.end);
  if (start !== null && instant < start) {
    throwFormatError(
      "CAMPAIGN_SCHEDULE_INVALID",
      "Scheduled time is before the launch window opens",
    );
  }
  if (end !== null && instant > end) {
    throwFormatError(
      "CAMPAIGN_SCHEDULE_INVALID",
      "Scheduled time is after the launch window closes",
    );
  }

  return new Date(instant).toISOString();
}

/**
 * Finds deliverables that would go out on the same platform, on the same
 * channel, at the same instant. This is a readiness warning, not a refusal —
 * simultaneous posts may be intentional — but it is the collision a person most
 * often means when they ask "did I already schedule this?".
 */
export function findScheduleConflicts(
  deliverables: readonly CampaignDeliverableRecord[],
): CampaignReadinessCheck[] {
  const seen = new Map<string, CampaignDeliverableRecord>();
  const checks: CampaignReadinessCheck[] = [];

  for (const deliverable of deliverables) {
    if (!deliverable.scheduledFor) continue;
    const key = `${deliverable.platformId}::${deliverable.channel}::${deliverable.scheduledFor}`;
    const existing = seen.get(key);
    if (existing) {
      checks.push({
        code: "SCHEDULE_CONFLICT",
        severity: "WARNING",
        entity: { type: "DELIVERABLE", id: deliverable.id },
        message: `"${deliverable.title}" is scheduled at the same time as "${existing.title}" on the same platform`,
        remediation:
          "Stagger one of the scheduled times, or confirm the double-post is intended.",
      });
      continue;
    }
    seen.set(key, deliverable);
  }

  return checks;
}

/**
 * A stable ordering for a plan: explicit `scheduledFor` first ordered by time,
 * then unscheduled deliverables by their position. Readiness and export both use
 * it so the Launch Kit and the plan cannot disagree about sequence.
 */
export function orderDeliverables(
  deliverables: readonly CampaignDeliverableRecord[],
): CampaignDeliverableRecord[] {
  return [...deliverables].sort((a, b) => {
    const aTime = a.scheduledFor ? parseScheduleInstant(a.scheduledFor) : null;
    const bTime = b.scheduledFor ? parseScheduleInstant(b.scheduledFor) : null;

    if (aTime !== null && bTime !== null && aTime !== bTime) return aTime - bTime;
    if (aTime !== null && bTime === null) return -1;
    if (aTime === null && bTime !== null) return 1;

    if (a.position !== b.position) return a.position - b.position;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
