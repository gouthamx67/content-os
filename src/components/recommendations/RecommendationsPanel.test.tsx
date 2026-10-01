/**
 * @vitest-environment jsdom
 *
 * The suggestions panel is where a user decides whether to trust a suggestion, so
 * the render test covers the moments that decide trust: that a reason and a gap
 * are both visible, that no score is ever on screen, and that the two decisions
 * (take it up, not for me) post what they claim to. Requests are stubbed here;
 * that the server honours them is the API integration test's job.
 */
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

import { RecommendationsPanel } from "./RecommendationsPanel";
import {
  recommendationRegistry,
  serializeOpportunity,
} from "../../lib/recommendation-api";
import {
  toOpportunityView,
  type ContentOpportunity,
  type ContentOpportunityView,
} from "../../core/domain/content-opportunity";

const projectId = "prj_1";

function opportunity(
  overrides: Partial<ContentOpportunity> = {},
): ContentOpportunity {
  return {
    id: "rec_1",
    key: "image.carousel|WORKFLOW|id:wf_1|linkedin",
    projectId,
    templateId: "workflow_carousel",
    contentTypeId: "image.carousel",
    channel: "IMAGE",
    platform: "linkedin",
    subjectType: "WORKFLOW",
    subjectId: "wf_1",
    subjectLabel: "Onboarding",
    title: "Carousel walking through Onboarding",
    rationale: "Your onboarding workflow has no visual yet.",
    reasons: ["No carousel covers Onboarding"],
    missingInputs: [],
    priorityScore: 0.82,
    evidence: { sourceIds: ["src_1"], evidenceIds: ["ev_1"], entityIds: ["wf_1"] },
    status: "ACTIVE",
    selectedIntentId: null,
    dismissedAt: null,
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
    ...overrides,
  };
}

/**
 * What the API actually serves: the stored opportunity projected into its view,
 * with `isProgress` supplied by the service's coverage check.
 */
function view(
  overrides: Partial<ContentOpportunity> = {},
  isProgress = false,
): ContentOpportunityView {
  return serializeOpportunity(toOpportunityView(opportunity(overrides), isProgress));
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  refreshMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("RecommendationsPanel", () => {
  it("shows a suggestion with the reason it was made", async () => {
    render(
      <RecommendationsPanel
        projectId={projectId}
        initialRecommendations={[view()]}
        initialRegistry={recommendationRegistry()}
      />,
    );

    expect(screen.getByText("Carousel walking through Onboarding")).toBeTruthy();
    expect(
      screen.getByText("Your onboarding workflow has no visual yet."),
    ).toBeTruthy();
    expect(screen.getByText("No carousel covers Onboarding")).toBeTruthy();
  });

  /**
   * The score is the engine's ranking, not a verdict on the user's product. A
   * number on the card would read as a quality judgement, and would also invite
   * the user to second-guess a ranking they cannot see the inputs for.
   */
  it("never renders the ranking score", async () => {
    render(
      <RecommendationsPanel
        projectId={projectId}
        initialRecommendations={[view({ priorityScore: 0.9371 })]}
        initialRegistry={recommendationRegistry()}
      />,
    );

    expect(screen.queryByText(/0\.93/)).toBeNull();
    expect(document.body.textContent).not.toContain("priorityScore");
  });

  /**
   * A suggestion grounded on the product graph and one built on a thin inference
   * look identical otherwise. Showing the gap next to the reason is what lets the
   * user tell them apart, so it is asserted rather than assumed.
   */
  it("shows what a suggestion is missing as visibly as why it was made", async () => {
    render(
      <RecommendationsPanel
        projectId={projectId}
        initialRecommendations={[
          view({ missingInputs: ["No recorded proof points", "No screenshots yet"] }),
        ]}
        initialRegistry={recommendationRegistry()}
      />,
    );

    expect(screen.getByText("What this is missing")).toBeTruthy();
    expect(screen.getByText("No recorded proof points")).toBeTruthy();
    expect(screen.getByText("No screenshots yet")).toBeTruthy();
  });

  it("says nothing is suggested rather than showing an empty shell", async () => {
    render(
      <RecommendationsPanel
        projectId={projectId}
        initialRecommendations={[]}
        initialRegistry={recommendationRegistry()}
      />,
    );

    expect(screen.getByText(/No suggestions yet/)).toBeTruthy();
    // An empty list is an honest answer for a project with nothing analysed, so
    // the copy points at the reason rather than blaming the user.
    expect(screen.getByText(/Analyse your sources first/)).toBeTruthy();
  });

  it("takes a suggestion up and marks it done", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        recommendation: view({ status: "SELECTED", selectedIntentId: "int_9" }),
      }),
    );

    render(
      <RecommendationsPanel
        projectId={projectId}
        initialRecommendations={[view()]}
        initialRegistry={recommendationRegistry()}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /take this up/i }));

    await waitFor(() => {
      const [, init] = fetchMock.mock.calls[0];
      expect((init as RequestInit).method).toBe("POST");
      expect(fetchMock.mock.calls[0][0]).toBe(
        `/api/projects/${projectId}/recommendations/rec_1/select`,
      );
    });

    await waitFor(() => {
      expect(screen.getByText("Taken up")).toBeTruthy();
    });
  });

  it("dismisses a suggestion and moves it out of the active list", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        recommendation: view({
          status: "DISMISSED",
          dismissedAt: "2026-03-02T00:00:00.000Z",
        }),
      }),
    );

    render(
      <RecommendationsPanel
        projectId={projectId}
        initialRecommendations={[view()]}
        initialRegistry={recommendationRegistry()}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /not for me/i }));

    await waitFor(() => {
      expect(screen.queryByText("Carousel walking through Onboarding")).toBeNull();
    });
    expect(screen.getByRole("button", { name: /show 1 dismissed/i })).toBeTruthy();
  });

  it("keeps a dismissed suggestion retrievable, and restores it on request", async () => {
    render(
      <RecommendationsPanel
        projectId={projectId}
        initialRecommendations={[view({ status: "DISMISSED", dismissedAt: "2026-03-02T00:00:00.000Z" })]}
        initialRegistry={recommendationRegistry()}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /show 1 dismissed/i }));

    const section = screen.getByRole("button", { name: /restore/i }).closest("li")!;
    expect(within(section).getByText("Carousel walking through Onboarding")).toBeTruthy();

    fetchMock.mockResolvedValueOnce(jsonResponse({ recommendation: view() }));
    await userEvent.click(screen.getByRole("button", { name: /restore/i }));

    await waitFor(() => {
      const [, init] = fetchMock.mock.calls[0];
      expect((init as RequestInit).method).toBe("PATCH");
      expect((init as RequestInit).body).toBe(JSON.stringify({ status: "ACTIVE" }));
    });
  });

  it("marks a second suggestion about the same thing rather than hiding it", async () => {
    render(
      <RecommendationsPanel
        projectId={projectId}
        initialRecommendations={[view({}, true)]}
        initialRegistry={recommendationRegistry()}
      />,
    );

    // Covering something twice is legitimate; it just should not read as an
    // oversight, and it must not be silently dropped either.
    expect(screen.getByText("You already have one of these")).toBeTruthy();
  });

  it("shows the server's error rather than silently doing nothing", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: "You do not have access to this workspace" }, 403),
    );

    render(
      <RecommendationsPanel
        projectId={projectId}
        initialRecommendations={[]}
        initialRegistry={recommendationRegistry()}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /suggest what to make/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain(
        "You do not have access to this workspace",
      );
    });
  });

  it("posts no body when asking for suggestions", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ recommendations: [view()], registry: recommendationRegistry() }),
    );

    render(
      <RecommendationsPanel
        projectId={projectId}
        initialRecommendations={[]}
        initialRegistry={recommendationRegistry()}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /suggest what to make/i }));

    await waitFor(() => {
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(`/api/projects/${projectId}/recommendations/generate`);
      expect((init as RequestInit).body).toBeUndefined();
    });
  });
});
