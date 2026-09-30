/**
 * @vitest-environment jsdom
 *
 * The panel is where someone reads three to five concepts and picks one, so the
 * render tests cover the moments a wrong answer would be felt: it says plainly
 * when a set came from the fallback director rather than a model, choosing one
 * drops the others in the same view, an edit is marked as the user's, and the
 * panel never claims a concept is the best one. Requests are stubbed; that the
 * server honours them is the API integration test's job.
 */
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

import { CreativePanel } from "./CreativePanel";
import {
  creativeRegistry,
  serializeCreativeDirection,
} from "../../lib/creative-direction-api";
import { makeCreativeDirection } from "../../testing/fakes";

const projectId = "prj_1";
const intent = {
  id: "int_1",
  contentTypeName: "video.launch",
  status: "RESOLVED",
};

function direction(overrides: Partial<Parameters<typeof makeCreativeDirection>[0]> = {}) {
  return serializeCreativeDirection(
    makeCreativeDirection({
      id: "cdir_1",
      name: "The chase, then the fix",
      hook: {
        statement: "Chasing status eats a morning",
        mechanism: "Open on a real moment",
        emotionalTrigger: "Recognition",
      },
      thesis: "The chase eats a morning and scheduling removes it",
      ...overrides,
    }),
  );
}

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 400) {
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

describe("CreativePanel", () => {
  beforeEach(() => {
    refreshMock.mockClear();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("says a decided brief is needed before it offers to direct one", () => {
    render(<CreativePanel projectId={projectId} intent={null} />);
    expect(
      screen.getByText(/resolve a content request first/i),
    ).toBeTruthy();
  });

  it("does not offer to direct a request that is not resolved yet", () => {
    render(
      <CreativePanel
        projectId={projectId}
        intent={{ ...intent, status: "NEEDS_CLARIFICATION" }}
      />,
    );
    expect(screen.queryByText(/propose directions/i)).toBeNull();
    expect(screen.getByText(/still needs a detail/i)).toBeTruthy();
  });

  it("offers to propose a set for a resolved request", () => {
    render(
      <CreativePanel
        projectId={projectId}
        intent={intent}
        initialRegistry={creativeRegistry()}
      />,
    );
    expect(screen.getByText(/propose directions/i)).toBeTruthy();
    expect(screen.getByText(/no directions yet/i)).toBeTruthy();
  });

  it("sends only the fields a person chose", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      jsonResponse({
        directions: [direction()],
        run: {
          creativeRunId: "crun_1",
          mode: "BALANCED",
          provider: "ai-creative-director",
          model: "test-model",
          fallbackFrom: null,
          fallbackReason: null,
        },
        registry: creativeRegistry(),
      }),
    );

    render(
      <CreativePanel
        projectId={projectId}
        intent={intent}
        initialRegistry={creativeRegistry()}
      />,
    );

    await user.click(screen.getByText(/propose directions/i));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`/api/projects/${projectId}/creative-directions/generate`);
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      intentId: "int_1",
      mode: "BALANCED",
    });
    expect(await screen.findByText("The chase, then the fix")).toBeTruthy();
  });

  it("says plainly when a set came from the fallback director", async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        directions: [direction()],
        run: {
          creativeRunId: "crun_1",
          mode: "BALANCED",
          provider: "deterministic-creative-director",
          model: null,
          fallbackFrom: "ai-creative-director",
          fallbackReason: "provider is down",
        },
        registry: creativeRegistry(),
      }),
    );

    render(
      <CreativePanel
        projectId={projectId}
        intent={intent}
        initialRegistry={creativeRegistry()}
      />,
    );

    await user.click(screen.getByText(/propose directions/i));

    expect(await screen.findByText(/fell back to the built-in director/i)).toBeTruthy();
    expect(screen.getByText(/provider is down/)).toBeTruthy();
  });

  it("choosing one drops the others in the same view", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.mocked(fetch);
    const second = direction({ id: "cdir_2", name: "The schedule screen" });
    fetchMock.mockResolvedValue(
      jsonResponse({
        direction: { ...second, status: "SELECTED" },
        demoted: [{ ...direction(), status: "DRAFT" }],
      }),
    );

    render(
      <CreativePanel
        projectId={projectId}
        intent={intent}
        initialDirections={[direction(), second]}
        initialRegistry={creativeRegistry()}
      />,
    );

    const items = screen.getAllByRole("listitem");
    await user.click(within(items[1]).getByText(/choose this/i));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe(
      `/api/projects/${projectId}/creative-directions/cdir_2/select`,
    );
    // One concept reads as chosen; the other has lost that mark in place.
    expect(await screen.findAllByText("Chosen")).toHaveLength(1);
    expect(screen.queryAllByText("Chosen")).toHaveLength(1);
  });

  it("marks an edited direction as edited", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      jsonResponse({
        direction: direction({ editedByUser: true, thesis: "A calmer opening" }),
        registry: creativeRegistry(),
      }),
    );

    render(
      <CreativePanel
        projectId={projectId}
        intent={intent}
        initialDirections={[direction()]}
        initialRegistry={creativeRegistry()}
      />,
    );

    await user.click(screen.getByText(/^edit$/i));
    const thesis = screen.getByLabelText(/thesis/i);
    await user.clear(thesis);
    await user.type(thesis, "A calmer opening");
    await user.click(screen.getByText(/^save$/i));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(await screen.findByText(/edited/i)).toBeTruthy();
    expect(await screen.findByText("A calmer opening")).toBeTruthy();
  });

  it("tells the reader an edit is held to the same grounding rules", async () => {
    const user = userEvent.setup();
    render(
      <CreativePanel
        projectId={projectId}
        intent={intent}
        initialDirections={[direction()]}
        initialRegistry={creativeRegistry()}
      />,
    );

    await user.click(screen.getByText(/^edit$/i));
    expect(screen.getByText(/same grounding rules/i)).toBeTruthy();
  });

  it("shows why an edit was refused rather than dropping it", async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(
        {
          error: "Creative direction rejected",
          code: "CREATIVE_UNSUPPORTED_QUANTIFIED_CLAIM",
          issues: [
            {
              code: "CREATIVE_UNSUPPORTED_QUANTIFIED_CLAIM",
              message: 'thesis states 10x, which no supported claim in this project backs',
            },
          ],
        },
        false,
      ),
    );

    render(
      <CreativePanel
        projectId={projectId}
        intent={intent}
        initialDirections={[direction()]}
        initialRegistry={creativeRegistry()}
      />,
    );

    await user.click(screen.getByText(/^edit$/i));
    await user.click(screen.getByText(/^save$/i));

    expect(await screen.findByText(/no supported claim in this project backs/i)).toBeTruthy();
    // The edit is still open, so the text the person typed is not lost.
    expect(screen.getByLabelText(/thesis/i)).toBeTruthy();
  });

  it("explains a project that has too little material, instead of a blank panel", async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(
        {
          error:
            "This project does not have enough recorded product material to build a direction from.",
          code: "CREATIVE_INSUFFICIENT_CONTEXT",
        },
        false,
        409,
      ),
    );

    render(
      <CreativePanel
        projectId={projectId}
        intent={intent}
        initialDirections={[]}
        initialRegistry={creativeRegistry()}
      />,
    );

    await user.click(screen.getByText(/propose directions/i));

    expect(
      await screen.findByText(/not have enough recorded product material/i),
    ).toBeTruthy();
  });

  it("does not rank the concepts against each other", () => {
    render(
      <CreativePanel
        projectId={projectId}
        intent={intent}
        initialDirections={[
          direction({ strengthScore: 12 }),
          direction({ id: "cdir_2", name: "Second", strengthScore: 98 }),
        ]}
        initialRegistry={creativeRegistry()}
      />,
    );

    expect(screen.queryByText(/score/i)).toBeNull();
    expect(screen.queryByText(/best/i)).toBeNull();
    expect(screen.queryByText(/\b1[0-9]\b/)).toBeNull();
  });

  it("names the mode requirement before the request is made", () => {
    render(
      <CreativePanel
        projectId={projectId}
        intent={intent}
        initialRegistry={creativeRegistry()}
      />,
    );

    const guided = screen.getByRole("option", {
      name: /guided - needs product UI/i,
    });
    expect(guided).toBeTruthy();
  });

  it("passes a direction over when asked", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      jsonResponse({ direction: direction({ status: "ARCHIVED" }) }),
    );

    render(
      <CreativePanel
        projectId={projectId}
        intent={intent}
        initialDirections={[direction()]}
        initialRegistry={creativeRegistry()}
      />,
    );

    await user.click(screen.getByText(/pass over/i));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      `/api/projects/${projectId}/creative-directions/cdir_1`,
    );
    expect((init as RequestInit).method).toBe("PATCH");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      status: "ARCHIVED",
    });
    expect(await screen.findByText(/archived/i)).toBeTruthy();
  });
});
