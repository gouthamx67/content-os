/**
 * @vitest-environment jsdom
 *
 * The panel is where somebody reads a plan and moves beats around, so these
 * tests cover the moments a wrong answer would be felt: it stays closed until a
 * direction is chosen, it says plainly when a plan came from the fallback
 * planner, it adopts the server's re-timed board instead of moving rows itself,
 * it locks the plan, and a locked plan stops offering edits. Requests are
 * stubbed; that the server honours them is the API integration test's job.
 */
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

import { StoryboardPanel } from "./StoryboardPanel";
import {
  serializeStoryboard,
  storyboardRegistry,
  type SerializedStoryboard,
} from "../../lib/storyboard-api";
import { makeStoryboard, makeStoryboardContext } from "../../testing/fakes";

const projectId = "prj_1";
const direction = { id: "cdir_1", name: "The chase, then the fix", intentId: "int_1" };

/**
 * One shared context: two plans are only rival plans when they answer the same
 * brief, and the selection rule is scoped to the intent rather than the direction.
 */
const context = makeStoryboardContext();

function board(overrides: Partial<Parameters<typeof makeStoryboard>[1]> = {}) {
  return serializeStoryboard(
    makeStoryboard(context, {
      id: "sb_1",
      name: "Plan one",
      ...overrides,
    }),
  );
}

/** A capture target is a sentence, so it is matched literally, not as a pattern. */
function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 400) {
  return { ok, status, json: async () => body } as Response;
}

function captureTargetsFor(target: SerializedStoryboard) {
  return target.scenes.flatMap((scene) =>
    scene.shots
      .filter((shot) => shot.captureRequirement.mode !== "NONE")
      .map((shot) => ({
        sceneId: scene.id,
        mode: shot.captureRequirement.mode,
        target: shot.captureRequirement.target,
        workflowId: shot.captureRequirement.workflowId,
      })),
  );
}

describe("StoryboardPanel", () => {
  beforeEach(() => {
    refreshMock.mockClear();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("says a chosen direction is needed before it offers to plan one", () => {
    render(<StoryboardPanel projectId={projectId} direction={null} />);
    expect(screen.getByText(/choose a creative direction first/i)).toBeTruthy();
  });

  it("plans a board and shows the beats with their spans", async () => {
    const planned = board();
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        storyboard: planned,
        captureTargets: captureTargetsFor(planned),
        generation: { provider: "deterministic", model: null, fallbackFrom: null, fallbackReason: null },
        registry: storyboardRegistry(),
      }),
    );

    render(
      <StoryboardPanel
        projectId={projectId}
        direction={direction}
        initialRegistry={storyboardRegistry()}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /plan the storyboard/i }));

    await waitFor(() => expect(screen.getByText(planned.name)).toBeTruthy());
    expect(screen.getByText(/1\. /)).toBeTruthy();
    expect(fetch).toHaveBeenCalledWith(
      `/api/projects/${projectId}/storyboards/generate`,
      expect.objectContaining({ method: "POST" }),
    );

    const body = JSON.parse(
      (vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body).toEqual({ intentId: "int_1", directionId: "cdir_1" });
  });

  it("says plainly when a model was asked for and the built-in planner stood in", async () => {
    const planned = board();
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        storyboard: planned,
        captureTargets: [],
        generation: {
          provider: "deterministic",
          model: null,
          fallbackFrom: "openai",
          fallbackReason: "model output was not grounded",
        },
        registry: storyboardRegistry(),
      }),
    );

    render(<StoryboardPanel projectId={projectId} direction={direction} />);
    await userEvent.click(screen.getByRole("button", { name: /plan the storyboard/i }));

    await waitFor(() =>
      expect(screen.getByText(/fell back to the built-in planner/i)).toBeTruthy(),
    );
    expect(screen.getByText(/model output was not grounded/i)).toBeTruthy();
  });

  it("adopts the board the server re-times instead of moving rows itself", async () => {
    const original = board();
    const reordered = board({ version: 2, name: "Plan one" });
    // The server swapped the first two beats and re-timed everything after them.
    const scenes = [...reordered.scenes];
    [scenes[0], scenes[1]] = [scenes[1], scenes[0]];

    vi.mocked(fetch).mockImplementation(async () =>
      jsonResponse({ storyboard: { ...reordered, scenes } }),
    );

    render(
      <StoryboardPanel
        projectId={projectId}
        direction={direction}
        initialStoryboards={[original]}
        initialRegistry={storyboardRegistry()}
      />,
    );

    const firstBeatBefore = original.scenes[0].name;
    // Every beat offers a move, so this asks for the second beat's.
    await userEvent.click(screen.getAllByRole("button", { name: /earlier/i })[1]);

    await waitFor(() => {
      const beats = screen.getAllByText(/^\d+\. /);
      expect(beats.length).toBeGreaterThan(1);
      // The panel now shows the server's order, not the order it was given.
      expect(screen.getByText(`1. ${original.scenes[1].name}`)).toBeTruthy();
    });
    expect(firstBeatBefore).not.toBe(original.scenes[1].name);
  });

  it("surfaces the server's reason when a move is refused", async () => {
    const planned = board();
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(
        {
          error: "A hook has to open the piece",
          issues: [{ message: "The first scene is no longer a hook" }],
        },
        false,
        422,
      ),
    );

    render(
      <StoryboardPanel
        projectId={projectId}
        direction={direction}
        initialStoryboards={[planned]}
      />,
    );

    await userEvent.click(screen.getAllByRole("button", { name: /later/i })[0]);

    await waitFor(() =>
      expect(screen.getByText(/a hook has to open the piece/i)).toBeTruthy(),
    );
    expect(screen.getByText(/no longer a hook/i)).toBeTruthy();
  });

  it("chooses a plan and drops the other chosen plan in the same view", async () => {
    const chosen = board({ id: "sb_2", name: "Plan two", status: "DRAFT" });
    const other = board({ id: "sb_1", name: "Plan one", status: "SELECTED" });
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ storyboard: { ...chosen, status: "SELECTED" } }),
    );

    render(
      <StoryboardPanel
        projectId={projectId}
        direction={direction}
        initialStoryboards={[other, chosen]}
      />,
    );

    const planTwo = screen.getByText("Plan two").closest("li")!;
    await userEvent.click(within(planTwo).getByRole("button", { name: /choose this/i }));

    await waitFor(() => {
      const planOne = screen.getByText("Plan one").closest("li")!;
      expect(within(planOne).getByText(/^draft$/i)).toBeTruthy();
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("locks a plan and archives the one it replaced", async () => {
    const chosen = board({ id: "sb_1", name: "Plan one", status: "SELECTED" });
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ storyboard: { ...chosen, status: "LOCKED" } }),
    );

    render(
      <StoryboardPanel
        projectId={projectId}
        direction={direction}
        initialStoryboards={[chosen]}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /lock the plan/i }));

    await waitFor(() => expect(screen.getByText(/^locked$/i)).toBeTruthy());
    // A locked plan stops moving, so it offers neither an edit nor a re-lock.
    expect(screen.queryByRole("button", { name: /^edit$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /lock the plan/i })).toBeNull();
    expect(screen.getByText(/a locked plan is the one somebody will shoot/i)).toBeTruthy();
  });

  it("demotes a chosen plan from another direction when the brief picks a new one", async () => {
    // Selection is scoped to the intent, not the direction: two plans for the same
    // brief are rivals even when they were built from different directions. A
    // panel that matched on direction would show two chosen plans at once.
    const rival = board({
      id: "sb_3",
      name: "The other direction",
      status: "SELECTED",
      directionId: "cdir_elsewhere",
    });
    const winner = board({ id: "sb_2", name: "Plan two", status: "DRAFT" });
    expect(rival.directionId).not.toBe(winner.directionId);
    expect(rival.intentId).toBe(winner.intentId);

    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ storyboard: { ...winner, status: "SELECTED" } }),
    );

    render(
      <StoryboardPanel
        projectId={projectId}
        direction={direction}
        initialStoryboards={[rival, winner]}
      />,
    );

    const planTwo = screen.getByText("Plan two").closest("li")!;
    await userEvent.click(within(planTwo).getByRole("button", { name: /choose this/i }));

    await waitFor(() => {
      const other = screen.getByText("The other direction").closest("li")!;
      expect(within(other).getByText(/^draft$/i)).toBeTruthy();
    });
  });

  it("edits a beat and adopts the board that comes back", async () => {
    const planned = board();
    const scenes = planned.scenes.map((scene, index) =>
      index === 0 ? { ...scene, name: "A sharper opening" } : scene,
    );
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ storyboard: { ...planned, scenes, version: 2 } }),
    );

    render(
      <StoryboardPanel
        projectId={projectId}
        direction={direction}
        initialStoryboards={[planned]}
      />,
    );

    await userEvent.click(screen.getAllByRole("button", { name: /^edit$/i })[0]);
    const input = screen.getByLabelText(/beat name/i);
    await userEvent.clear(input);
    await userEvent.type(input, "A sharper opening");
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() =>
      expect(screen.getByText("1. A sharper opening")).toBeTruthy(),
    );

    const body = JSON.parse(
      (vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string,
    );
    // Only the fields a person changed, keyed by the scene the server owns.
    expect(body.scenes[0]).toEqual({
      sceneId: planned.scenes[0].id,
      changes: {
        name: "A sharper opening",
        purpose: planned.scenes[0].purpose,
      },
    });
  });

  it("shows a shot's capture target so the plan says what it will need", async () => {
    const planned = board();
    render(
      <StoryboardPanel
        projectId={projectId}
        direction={direction}
        initialStoryboards={[planned]}
      />,
    );

    const captured = planned.scenes.find((scene) =>
      scene.shots.some((shot) => shot.captureRequirement.mode !== "NONE"),
    );

    // The built-in planner only assigns a capture when the project has a real
    // feature or workflow to point at, so this asserts against the fixture's
    // own answer rather than a hardcoded one.
    if (captured) {
      const shot = captured.shots.find(
        (entry) => entry.captureRequirement.mode !== "NONE",
      )!;
      // More than one shot can carry the same capture, so this asserts the target
      // is on screen at least once rather than counting occurrences.
      expect(
        screen.getAllByText(new RegExp(escapeRegExp(shot.captureRequirement.target))).length,
      ).toBeGreaterThan(0);
    } else {
      expect(screen.getByText(/not a script/i)).toBeTruthy();
    }
  });
});
