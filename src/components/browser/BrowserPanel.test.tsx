/**
 * @vitest-environment jsdom
 *
 * The panel is the only way a user drives the browser agent from Content OS, so
 * it gets a real render test: server-seeded sessions, source selection, goal
 * gating, and the run/cancel request contract — all against a stubbed fetch.
 * It asserts the panel *asks* for the right things; that the request is honoured
 * is covered by the API integration tests.
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserPanel, type BrowserSessionSummary } from "./BrowserPanel";

const projectId = "proj_1";

const sources = [
  { id: "src_1", name: "Docs site", uri: "https://docs.example.com" },
  { id: "src_2", name: "Marketing", uri: "https://marketing.example.com" },
];

const runningSession: BrowserSessionSummary = {
  id: "brs_running",
  projectId,
  targetSourceId: "src_1",
  targetClass: "PUBLIC",
  initialUrl: "https://docs.example.com",
  goal: "Find the pricing page",
  successCriteria: 'text contains "Pricing"',
  status: "RUNNING",
  currentUrl: "https://docs.example.com",
  pageCount: 1,
  actionCount: 2,
  startedAt: new Date().toISOString(),
  endedAt: null,
  errorCode: null,
  errorMessage: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

let requests: { url: string; init?: RequestInit }[] = [];

function stubFetch(handler: (url: string, init?: RequestInit) => Response) {
  requests = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, init });
      return handler(url, init);
    }),
  );
}

beforeEach(() => {
  cleanup();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("BrowserPanel", () => {
  it("renders server-seeded sessions and sources without client fetches on mount", () => {
    stubFetch(() => jsonResponse({ sessions: [] }));
    render(<BrowserPanel projectId={projectId} sources={sources} initialSessions={[runningSession]} />);

    expect(screen.getByText("Find the pricing page")).toBeTruthy();
    expect(screen.getByText("RUNNING")).toBeTruthy();
    // The first paint is server-rendered; the panel must not refetch to show it.
    expect(requests).toEqual([]);
  });

  it("cannot start a task until a goal is entered", async () => {
    stubFetch(() => jsonResponse({ sessions: [] }));
    const user = userEvent.setup();
    render(<BrowserPanel projectId={projectId} sources={sources} initialSessions={[]} />);

    const runButton = screen.getByRole("button", { name: /run task/i });
    expect((runButton as HTMLButtonElement).disabled).toBe(true);

    await user.type(screen.getByLabelText(/goal/i), "Find the pricing page");
    expect((runButton as HTMLButtonElement).disabled).toBe(false);
  });

  it("seeds the target url from the selected source and posts a scoped run request", async () => {
    stubFetch((url) => {
      if (url.endsWith("/browser/sessions")) return jsonResponse({ sessions: [] });
      if (url.endsWith("/browser/run")) return jsonResponse({ session: runningSession });
      return jsonResponse({ trace: null, observations: [] });
    });
    const user = userEvent.setup();
    render(<BrowserPanel projectId={projectId} sources={sources} initialSessions={[]} />);

    await user.selectOptions(screen.getByLabelText(/source/i), "src_2");
    const urlInput = screen.getByLabelText(/start url/i) as HTMLInputElement;
    expect(urlInput.value).toBe("https://marketing.example.com");

    await user.type(screen.getByLabelText(/goal/i), "Check the pricing page");
    await user.type(
      screen.getByLabelText(/success criteria/i),
      'text contains "Pricing" and something poetic about the sky',
    );
    // Only the checkable half is promised an automatic verdict; the poetic half
    // is not counted, so the user is not misled about what will be verified.
    expect(screen.getByText(/1 criterion checked automatically/i)).toBeTruthy();
    await user.clear(screen.getByLabelText(/success criteria/i));
    await user.type(screen.getByLabelText(/success criteria/i), "the sky above is a deep blue");
    expect(screen.getByText(/Free text: the run only succeeds if a page assertion also passes/i)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /run task/i }));

    await waitFor(() => {
      const run = requests.find((request) => request.url.endsWith("/browser/run"));
      expect(run).toBeDefined();
      const body = JSON.parse(String(run?.init?.body)) as Record<string, unknown>;
      expect(body).toMatchObject({
        targetSourceId: "src_2",
        url: "https://marketing.example.com",
        goal: "Check the pricing page",
        successCriteria: "the sky above is a deep blue",
      });
    });
  });

  it("loads the trace and parsed observations for a selected session", async () => {
    stubFetch((url) => {
      if (url.endsWith("/observations?limit=20")) {
        return jsonResponse({
          observations: [
            {
              id: "obs_1",
              stepOrder: 1,
              url: "https://docs.example.com/pricing",
              title: "Pricing",
              createdAt: new Date().toISOString(),
              payload: {
                url: "https://docs.example.com/pricing",
                title: "Pricing",
                pageText: "Pricing plans",
                interactiveElements: [
                  { kind: "BUTTON", role: "button", name: "Choose plan", enabled: true },
                ],
              },
            },
          ],
        });
      }
      if (url.includes("/browser/sessions/")) {
        return jsonResponse({
          session: runningSession,
          trace: {
            steps: [
              {
                order: 1,
                actionType: "GOTO",
                targetSummary: null,
                inputSummary: "https://docs.example.com/pricing",
                status: "COMPLETED",
                durationMs: 40,
                result: "ok",
                errorCode: null,
                errorMessage: null,
              },
            ],
          },
        });
      }
      return jsonResponse({ sessions: [] });
    });
    const user = userEvent.setup();
    render(<BrowserPanel projectId={projectId} sources={sources} initialSessions={[runningSession]} />);

    await user.click(screen.getByText("Find the pricing page"));

    await waitFor(() => expect(screen.getByText("Page observations")).toBeTruthy());
    expect(screen.getByText(/step 1: Pricing/)).toBeTruthy();
    expect(screen.getByText(/1 control/)).toBeTruthy();
    expect(screen.getByText(/Choose plan/)).toBeTruthy();
    expect(screen.getByText("GOTO")).toBeTruthy();
  });

  it("cancels a running session through the scoped cancel endpoint", async () => {
    stubFetch((url, init) => {
      if (init?.method === "POST" && url.endsWith("/cancel")) return jsonResponse({ session: { ...runningSession, status: "CANCELLED" } });
      if (url.endsWith("/observations?limit=20")) return jsonResponse({ observations: [] });
      if (url.includes("/browser/sessions/")) return jsonResponse({ session: runningSession, trace: null });
      return jsonResponse({ sessions: [runningSession] });
    });
    const user = userEvent.setup();
    render(<BrowserPanel projectId={projectId} sources={sources} initialSessions={[runningSession]} />);

    await user.click(screen.getByText("Find the pricing page"));
    await waitFor(() => expect(screen.getByRole("button", { name: /cancel/i })).toBeTruthy());
    await user.click(screen.getByRole("button", { name: /cancel/i }));

    await waitFor(() => {
      const cancel = requests.find((request) => request.url.endsWith("/cancel"));
      expect(cancel?.init?.method).toBe("POST");
      expect(cancel?.url).toBe(`/api/projects/${projectId}/browser/sessions/${runningSession.id}/cancel`);
    });
  });

  it("shows why a finished session failed", () => {
    stubFetch(() => jsonResponse({ sessions: [] }));
    render(
      <BrowserPanel
        projectId={projectId}
        sources={sources}
        initialSessions={[
          {
            ...runningSession,
            status: "FAILED",
            errorCode: "VERIFICATION_FAILED",
            errorMessage: 'Success criteria not met: page text does not contain "Pricing"',
          },
        ]}
      />,
    );
    expect(screen.getByText("Find the pricing page")).toBeTruthy();
    expect(
      screen.getByText(/VERIFICATION_FAILED: Success criteria not met/),
    ).toBeTruthy();
  });

  it("surfaces a server error instead of pretending the run started", async () => {
    stubFetch((url) => {
      if (url.endsWith("/browser/run")) {
        return new Response(JSON.stringify({ error: "Target is not allowed" }), { status: 400 });
      }
      return jsonResponse({ sessions: [] });
    });
    const user = userEvent.setup();
    render(<BrowserPanel projectId={projectId} sources={sources} initialSessions={[]} />);

    await user.type(screen.getByLabelText(/goal/i), "Try something forbidden");
    await user.click(screen.getByRole("button", { name: /run task/i }));

    await waitFor(() => expect(screen.getByText(/not allowed|failed/i)).toBeTruthy());
  });
});
