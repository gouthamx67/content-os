/**
 * @vitest-environment jsdom
 *
 * The create panel is the whole product for a first-time user: one request,
 * one click, real content. This test keeps the order of the real API calls
 * honest and checks that the chosen concept and its scenes are what the user
 * sees, rather than another panel of options.
 */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

import { CreateContentPanel } from "./CreateContentPanel";

const direction = {
  id: "dir_1",
  name: "Quiet Confidence",
  thesis: "End the day in control instead of chasing status.",
  narrativeSummary: "A hectic desk becomes a calm one.",
  visualStrategy: { approach: "Split screen, then one clean interface." },
  proofStrategy: { proofPoints: ["Show the task completing in one click."] },
  voiceDirection: "Warm and measured.",
};

const storyboard = {
  id: "sb_1",
  name: "Quiet Confidence storyboard",
  targetDurationMs: 30_000,
  actualDurationMs: 30_000,
  scenes: [
    {
      id: "scene_1",
      order: 0,
      name: "The clutter",
      startMs: 0,
      endMs: 5_000,
      textOverlays: [{ id: "txt_1", text: "Too many tabs." }],
      voiceoverPlan: { text: "You know the feeling." },
      shots: [{ id: "shot_1", description: "A desk covered in notes." }],
    },
  ],
};

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as Response;
}

describe("CreateContentPanel", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    refreshMock.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("runs the pipeline and shows the chosen concept and scene plan", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          intent: {
            id: "int_1",
            status: "RESOLVED",
            contentTypeId: "video.launch",
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ directions: [direction] }))
      .mockResolvedValueOnce(
        jsonResponse({ direction: { ...direction, status: "SELECTED" } }),
      )
      .mockResolvedValueOnce(jsonResponse({ storyboard }));

    const user = userEvent.setup();
    render(
      <CreateContentPanel
        projectId="prj_1"
        hasSources
        hasIntelligence
        hasProductUi={false}
      />,
    );

    await user.type(
      screen.getByPlaceholderText(
        "Make a 30 second launch video for LinkedIn",
      ),
      "Make a 30 second launch video for LinkedIn",
    );
    await user.click(screen.getByRole("button", { name: "Generate content" }));

    await screen.findByText("Quiet Confidence");
    expect(screen.getByText(/End the day in control/)).toBeTruthy();
    expect(screen.getByText("1. The clutter")).toBeTruthy();
    expect(screen.getByText(/Too many tabs/)).toBeTruthy();
    expect(screen.getByText(/You know the feeling/)).toBeTruthy();

    const calls = fetchMock.mock.calls.map(
      ([url, init]) => [url, init as RequestInit | undefined] as const,
    );
    expect(calls.map(([url]) => url)).toEqual([
      "/api/projects/prj_1/intent",
      "/api/projects/prj_1/creative-directions/generate",
      "/api/projects/prj_1/creative-directions/dir_1/select",
      "/api/projects/prj_1/storyboards/generate",
    ]);
    expect(JSON.parse(String(calls[0]?.[1]?.body))).toEqual({
      request: "Make a 30 second launch video for LinkedIn",
    });
    expect(JSON.parse(String(calls[1]?.[1]?.body))).toEqual({
      intentId: "int_1",
      mode: "BALANCED",
      count: 3,
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("asks for a product link before it will generate", async () => {
    const user = userEvent.setup();
    render(
      <CreateContentPanel
        projectId="prj_1"
        hasSources={false}
        hasIntelligence={false}
        hasProductUi={false}
      />,
    );

    await user.type(
      screen.getByPlaceholderText(
        "Make a 30 second launch video for LinkedIn",
      ),
      "Launch video",
    );
    await user.click(screen.getByRole("button", { name: "Generate content" }));

    expect(
      screen.getByText(/Add a link to your product first/),
    ).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("starts a guided run only when a product screenshot exists", async () => {
    const user = userEvent.setup();
    render(
      <CreateContentPanel
        projectId="prj_1"
        hasSources
        hasIntelligence
        hasProductUi={false}
      />,
    );

    await user.selectOptions(screen.getByLabelText("Style"), "GUIDED");

    expect(
      screen.getByText(/Guided mode works from a real screenshot/),
    ).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Generate content" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("shows the latest content instead of the form on load", () => {
    render(
      <CreateContentPanel
        projectId="prj_1"
        hasSources
        hasIntelligence
        hasProductUi
        initial={{ direction, storyboard }}
      />,
    );

    expect(screen.getByText("Quiet Confidence")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Make another" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Generate content" })).toBeNull();
  });
});
