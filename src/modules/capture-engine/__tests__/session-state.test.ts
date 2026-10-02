import { describe, expect, it } from "vitest";
import {
  allowedTransitions,
  assertTransition,
  canTransition,
  CaptureTransitionError,
} from "../session-state";
import { CAPTURE_SESSION_STATUSES } from "../capture-types";

describe("capture session lifecycle", () => {
  it("allows the documented forward path", () => {
    expect(canTransition("DRAFT", "ACTIVE")).toBe(true);
    expect(canTransition("ACTIVE", "REVIEW")).toBe(true);
    expect(canTransition("REVIEW", "COMPLETED")).toBe(true);
    expect(canTransition("ACTIVE", "COMPLETED")).toBe(true);
  });

  it("lets a review go back for another take", () => {
    expect(canTransition("REVIEW", "ACTIVE")).toBe(true);
  });

  it("treats COMPLETED and CANCELLED as terminal", () => {
    expect(allowedTransitions("COMPLETED")).toEqual([]);
    expect(allowedTransitions("CANCELLED")).toEqual([]);
    expect(canTransition("COMPLETED", "ACTIVE")).toBe(false);
    expect(canTransition("CANCELLED", "REVIEW")).toBe(false);
  });

  it("can cancel from every unfinished state", () => {
    expect(canTransition("DRAFT", "CANCELLED")).toBe(true);
    expect(canTransition("ACTIVE", "CANCELLED")).toBe(true);
    expect(canTransition("REVIEW", "CANCELLED")).toBe(true);
  });

  it("cannot skip from DRAFT straight to COMPLETED", () => {
    expect(canTransition("DRAFT", "COMPLETED")).toBe(false);
  });

  it("assertTransition throws a typed error that names both states", () => {
    try {
      assertTransition("DRAFT", "COMPLETED");
      throw new Error("expected assertTransition to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(CaptureTransitionError);
      expect((error as CaptureTransitionError).from).toBe("DRAFT");
      expect((error as CaptureTransitionError).to).toBe("COMPLETED");
    }
  });

  it("every status has an entry, so an unknown status cannot slip through", () => {
    for (const status of CAPTURE_SESSION_STATUSES) {
      expect(Array.isArray(allowedTransitions(status))).toBe(true);
    }
  });
});
