import { describe, expect, it } from "vitest";
import {
  CANCELLABLE_STATUSES,
  PUBLICATION_TRANSITIONS,
  VALIDATABLE_STATUSES,
  canTransition,
  isFutureInstant,
  isValidTimeZone,
} from "../domain/lifecycle";
import { PUBLICATION_STATUSES } from "../domain/types";

describe("publication lifecycle", () => {
  it("never allows leaving a terminal status", () => {
    expect(PUBLICATION_TRANSITIONS.PUBLISHED).toEqual([]);
    expect(PUBLICATION_TRANSITIONS.CANCELLED).toEqual([]);
    for (const status of PUBLICATION_STATUSES) {
      expect(canTransition(status, "PUBLISHED")).toBe(
        status === "PUBLISHING" || status === "AMBIGUOUS",
      );
    }
  });

  it("keeps PUBLISHING cancellable only through the worker's own transitions", () => {
    expect(CANCELLABLE_STATUSES).not.toContain("PUBLISHING");
    expect(canTransition("PUBLISHING", "CANCELLED")).toBe(false);
    expect(canTransition("SCHEDULED", "PUBLISHING")).toBe(true);
    expect(canTransition("SCHEDULED", "CANCELLED")).toBe(true);
  });

  it("validates only from statuses where a re-read makes sense", () => {
    expect(VALIDATABLE_STATUSES).toEqual([
      "DRAFT",
      "READY",
      "STALE",
      "FAILED",
      "AUTH_REQUIRED",
    ]);
    expect(VALIDATABLE_STATUSES).not.toContain("SCHEDULED");
    expect(VALIDATABLE_STATUSES).not.toContain("QUEUED");
  });

  it("accepts IANA time zones and rejects unknown ones", () => {
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("America/New_York")).toBe(true);
    expect(isValidTimeZone("Not/AZone")).toBe(false);
  });

  it("requires a future instant with a 30 second lead", () => {
    const now = "2026-10-17T12:00:00.000Z";
    expect(isFutureInstant("2026-10-17T12:01:00.000Z", now)).toBe(true);
    expect(isFutureInstant("2026-10-17T12:00:10.000Z", now)).toBe(false);
    expect(isFutureInstant("2026-10-17T11:59:00.000Z", now)).toBe(false);
    expect(isFutureInstant("not-a-date", now)).toBe(false);
  });
});
