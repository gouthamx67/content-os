/**
 * @vitest-environment jsdom
 *
 * The intent panel is where a user finds out what the system understood, so the
 * render test covers the three moments that matter: an explicit request reads
 * back with its provenance, an implicit one asks instead of guessing, and an
 * edit re-reads. Requests are stubbed; that the server honours them is the API
 * integration test's job.
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

import { IntentPanel } from "./IntentPanel";
import {
  contentIntentRegistry,
  serializeContentIntent,
} from "../../lib/content-intent-api";
import type { ContentIntent } from "../../core/domain/content-intent";

const projectId = "prj_1";

function intent(overrides: Partial<ContentIntent> = {}): ContentIntent {
  return {
    id: "int_1",
    projectId,
    rawRequest: "Make a 30 second cinematic launch video for LinkedIn",
    channel: "VIDEO",
    contentTypeId: "video.launch",
    purpose: "launch",
    platforms: ["linkedin"],
    subjects: [],
    audience: undefined,
    language: "en",
    tone: "confident",
    style: "cinematic",
    durationSeconds: 30,
    quantity: 1,
    aspectRatio: "16:9",
    cta: undefined,
    constraints: [
      { key: "duration", value: "30", source: "USER" },
      { key: "aspectRatio", value: "16:9", source: "USER" },
      { key: "platform", value: "linkedin", source: "USER" },
      { key: "tone", value: "confident", source: "BRAND" },
      { key: "language", value: "en", source: "SYSTEM" },
    ],
    resolutionMode: "EXPLICIT",
    status: "RESOLVED",
    confidence: "HIGH",
    unresolvedFields: [],
    notes: ["CONSTRAINT_NOTE: language defaulted to en"],
    sourceIds: [],
    brandVersion: 3,
    intelligenceSnapshotVersion: undefined,
    createdAt: "2026-02-01T00:00:00.000Z",
    updatedAt: "2026-02-01T00:00:00.000Z",
    ...overrides,
  };
}

function view(overrides: Partial<ContentIntent> = {}, field?: string) {
  return {
    intent: serializeContentIntent(intent(overrides)),
    clarifications: field
      ? [{ field, question: "What would you like to create?", options: [{ value: "video.social", label: "Social video" }] }]
      : [],
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("IntentPanel", () => {
  it("resolves a request and shows what was understood and where it came from", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ...view(), registry: contentIntentRegistry() }),
    );

    render(
      <IntentPanel projectId={projectId} initialIntents={[]} initialRegistry={contentIntentRegistry()} />,
    );

    await userEvent.type(
      screen.getByLabelText("Content request"),
      "Make a 30 second cinematic launch video for LinkedIn",
    );
    await userEvent.click(screen.getByRole("button", { name: /resolve request/i }));

    await waitFor(() => {
      expect(screen.getByText("Product Launch Video")).toBeTruthy();
    });
    expect(screen.getByText(/30s/)).toBeTruthy();
    // Provenance is shown, so a brand tone is not mistaken for something the user said.
    // The tone came from the brand profile, the duration from the user: the two
    // are shown side by side so a default is never read as something they said.
    expect(screen.getByText("Tone: confident").textContent).toBe("Tone: confident");
    expect(screen.getByText("(Brand profile)")).toBeTruthy();
    expect(screen.getByText("Duration: 30")).toBeTruthy();
    expect(screen.getAllByText("(You)").length).toBeGreaterThan(0);
    expect(screen.getByText("CONSTRAINT_NOTE: language defaulted to en")).toBeTruthy();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`/api/projects/${projectId}/intent`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body).request).toContain("30 second cinematic launch video");
  });

  it("asks what is missing instead of showing an invented output", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ...view(
          {
            rawRequest: "Make something for this.",
            contentTypeId: "",
            channel: "VIDEO",
            resolutionMode: "NEEDS_CLARIFICATION",
            status: "NEEDS_CLARIFICATION",
            confidence: "LOW",
            unresolvedFields: ["contentType"],
            constraints: [],
            durationSeconds: undefined,
            aspectRatio: undefined,
            tone: undefined,
            style: undefined,
          },
          "contentType",
        ),
        registry: contentIntentRegistry(),
      }),
    );

    render(
      <IntentPanel projectId={projectId} initialIntents={[]} initialRegistry={contentIntentRegistry()} />,
    );

    await userEvent.type(screen.getByLabelText("Content request"), "Make something for this.");
    await userEvent.click(screen.getByRole("button", { name: /resolve request/i }));

    await waitFor(() => {
      expect(screen.getByText("One detail is missing")).toBeTruthy();
    });
    expect(screen.getByText("Content type not decided")).toBeTruthy();
    // The editor opens on the open question, so answering it is the next click.
    expect((screen.getByLabelText("Content type") as HTMLSelectElement).value).toBe("");
  });

  it("saves a corrected duration as a patch and shows the new reading", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ...view(),
        registry: contentIntentRegistry(),
      }),
    );

    render(
      <IntentPanel projectId={projectId} initialIntents={[]} initialRegistry={contentIntentRegistry()} />,
    );

    await userEvent.type(screen.getByLabelText("Content request"), "Make a 30 second launch video for LinkedIn");
    await userEvent.click(screen.getByRole("button", { name: /resolve request/i }));
    await waitFor(() => screen.getByText("Product Launch Video"));

    await userEvent.click(screen.getByRole("button", { name: /^edit /i }));

    const duration = screen.getByLabelText("Duration (seconds)") as HTMLInputElement;
    expect(duration.value).toBe("30");
    await userEvent.clear(duration);
    await userEvent.type(duration, "45");

    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ...view({ durationSeconds: 45 }),
        registry: contentIntentRegistry(),
      }),
    );
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(screen.getByText(/45s/)).toBeTruthy();
    });

    const patchCall = fetchMock.mock.calls[1];
    expect(patchCall[0]).toBe(`/api/projects/${projectId}/intent/int_1`);
    expect(patchCall[1].method).toBe("PATCH");
    // Only the field that changed is sent: the rest of the intent is untouched.
    expect(JSON.parse(patchCall[1].body)).toEqual({ durationSeconds: 45 });
  });

  it("shows the specific reason a request was refused", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          error: "This request cannot be turned into a content intent",
          code: "INTENT_VALIDATION_FAILED",
          issues: ["CONTENT_TYPE_DOES_NOT_SUPPORT_DURATION"],
        },
        422,
      ),
    );

    render(
      <IntentPanel projectId={projectId} initialIntents={[]} initialRegistry={contentIntentRegistry()} />,
    );

    await userEvent.type(screen.getByLabelText("Content request"), "Make a 30 second thumbnail");
    await userEvent.click(screen.getByRole("button", { name: /resolve request/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain(
        "CONTENT_TYPE_DOES_NOT_SUPPORT_DURATION",
      );
    });
  });

  it("sends a custom ratio as dimensions, not as the bare word CUSTOM", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ...view(), registry: contentIntentRegistry() }),
    );

    render(
      <IntentPanel projectId={projectId} initialIntents={[]} initialRegistry={contentIntentRegistry()} />,
    );

    await userEvent.type(screen.getByLabelText("Content request"), "Make a launch video");
    await userEvent.click(screen.getByRole("button", { name: /resolve request/i }));
    await waitFor(() => screen.getByText("Product Launch Video"));

    await userEvent.click(screen.getByRole("button", { name: /^edit /i }));
    // The dimension field only exists once a custom ratio is chosen, which is the
    // signal that "CUSTOM" is not a value a reader could act on.
    await userEvent.selectOptions(screen.getByLabelText("Aspect ratio"), "CUSTOM");
    const custom = screen.getByLabelText(/custom dimensions/i);
    await userEvent.type(custom, "1080x1920");

    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ...view(
          {
            aspectRatio: "CUSTOM",
            customAspectRatio: { width: 1080, height: 1920 },
            constraints: [
              { key: "aspectRatio", value: "1080x1920", source: "USER" },
              { key: "platform", value: "linkedin", source: "USER" },
            ],
          },
        ),
        registry: contentIntentRegistry(),
      }),
    );
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));

    // The reading shows the dimensions, not the word CUSTOM: a ratio is only
    // useful if the reader can see what it is.
    await waitFor(() => {
      expect(screen.getByText("Aspect ratio: 1080x1920")).toBeTruthy();
    });
    const body = JSON.parse(fetchMock.mock.calls[1][1].body);
    // Both halves of the change travel together: naming the ratio without its
    // dimensions is the case validation exists to catch.
    expect(body).toEqual({ aspectRatio: "CUSTOM", customAspectRatio: { width: 1080, height: 1920 } });
  });

  it("shows a note the server sent but did not persist, such as an AI fallback", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ...view(),
        resolution: { notes: ["AI unavailable: request.config is not a function"] },
        registry: contentIntentRegistry(),
      }),
    );

    render(
      <IntentPanel projectId={projectId} initialIntents={[]} initialRegistry={contentIntentRegistry()} />,
    );

    await userEvent.type(screen.getByLabelText("Content request"), "Make a launch video");
    await userEvent.click(screen.getByRole("button", { name: /resolve request/i }));

    await waitFor(() => {
      expect(screen.getByText(/AI unavailable/)).toBeTruthy();
    });
  });

  it("says nothing has been asked yet on an empty project", () => {
    render(
      <IntentPanel projectId={projectId} initialIntents={[]} initialRegistry={contentIntentRegistry()} />,
    );

    expect(screen.getByText(/No content request yet/)).toBeTruthy();
  });
});
