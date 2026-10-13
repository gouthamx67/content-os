/**
 * @vitest-environment jsdom
 *
 * The workspace is where a layer becomes visible or not, where a group and its
 * children read as one block, and where an AI proposal is either applied or
 * thrown away. These tests pin the three that a wrong answer would be felt on:
 * a hidden layer stays out of the canvas, a group renders and its child nests,
 * and discarding a proposal leaves the document untouched. The network is only
 * stubbed where a click would otherwise reach it — rendering the workspace
 * itself makes no request.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/projects/prj_1/editor/edoc_1",
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { EditorWorkspace } from "./EditorWorkspace";
import { emptyStyle, type EditorNode, type EditorSnapshot } from "../../../../../modules/editor-engine/domain/types";

const projectId = "prj_1";
const documentId = "edoc_1";

function node(overrides: Partial<EditorNode> & { id: string }): EditorNode {
  return {
    parentId: null,
    type: "TEXT",
    name: "Headline",
    zIndex: 0,
    transform: { x: 40, y: 80, width: 900, height: 200, rotation: 0, opacity: 1 },
    visible: true,
    asset: null,
    text: { value: "Draft headline" },
    style: emptyStyle(),
    trim: null,
    audio: null,
    shape: null,
    motion: null,
    effects: [],
    automation: [],
    provenance: null,
    ...overrides,
  };
}

function snapshot(nodes: EditorNode[]): EditorSnapshot {
  return {
    version: 1,
    documentId,
    width: 1080,
    height: 1920,
    durationMs: 15_000,
    frameRate: 30,
    nodes,
  };
}

function renderWorkspace(nodes: EditorNode[]) {
  return render(
    <EditorWorkspace
      projectId={projectId}
      document={{
        id: documentId,
        projectId,
        name: "Launch edit",
        status: "DRAFT",
        documentVersion: 1,
        currentRevisionId: "edrev_1",
        createdById: "usr_1",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        revisionCount: 1,
        lastOperation: "CREATE",
      }}
      headRevision={{ id: "edrev_1", number: 1 }}
      snapshot={snapshot(nodes)}
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("editor workspace layer rendering", () => {
  it("keeps a hidden layer out of the canvas but in the tree", () => {
    const { container } = renderWorkspace([
      node({ id: "visible", name: "Shown" }),
      node({ id: "hidden", name: "Hidden", visible: false, zIndex: 1 }),
    ]);

    const painted = container.querySelectorAll('[data-testid="editor-node"]');
    expect(painted).toHaveLength(1);
    expect(container.querySelector('[data-testid="editor-node"][data-node-id="hidden"]')).toBeNull();

    // The tree still lists it, with the eye toggle that can bring it back.
    const hiddenLayer = container.querySelector(
      '[data-testid="editor-layer"][data-node-id="hidden"]',
    );
    expect(hiddenLayer).not.toBeNull();
  });

  it("renders a group on the canvas and nests its child one level deep", () => {
    const { container } = renderWorkspace([
      node({ id: "group", type: "GROUP", name: "Hero", text: null }),
      node({ id: "child", parentId: "group", name: "Caption", zIndex: 1 }),
    ]);

    const group = container.querySelector(
      '[data-testid="editor-node"][data-node-type="GROUP"]',
    );
    expect(group).not.toBeNull();

    const childLayer = container.querySelector(
      '[data-testid="editor-layer"][data-node-id="child"]',
    );
    expect(childLayer?.getAttribute("data-depth")).toBe("1");
  });

  it("hides a group's children along with the group", () => {
    const { container } = renderWorkspace([
      node({ id: "group", type: "GROUP", name: "Hero", text: null, visible: false }),
      node({ id: "child", parentId: "group", name: "Caption", zIndex: 1 }),
    ]);

    expect(container.querySelectorAll('[data-testid="editor-node"]')).toHaveLength(0);
  });
});

describe("editor workspace timeline", () => {
  it("scrubs the playhead and marks the clip under it active", async () => {
    const user = userEvent.setup();
    const { container } = renderWorkspace([
      node({ id: "intro", name: "Intro", trim: { startMs: 0, endMs: 5_000 } }),
      node({
        id: "outro",
        name: "Outro",
        zIndex: 1,
        trim: { startMs: 10_000, endMs: 15_000 },
      }),
    ]);

    await user.click(screen.getByTestId("editor-tab-timeline"));

    const scrubber = screen.getByTestId(
      "editor-timeline-scrubber",
    ) as HTMLInputElement;
    expect(screen.getByTestId("editor-timeline-time").textContent).toBe("0 ms");

    const clips = container.querySelectorAll('[data-testid="editor-timeline-clip"]');
    expect(clips[0]?.getAttribute("data-active")).toBe("true");
    expect(clips[1]?.getAttribute("data-active")).toBe("false");

    fireEvent.change(scrubber, { target: { value: "12000" } });

    expect(screen.getByTestId("editor-timeline-time").textContent).toBe("12000 ms");
    const playhead = container.querySelector('[data-testid="editor-playhead"]') as HTMLElement;
    expect(playhead.style.left).toBe("80%");
    const after = container.querySelectorAll('[data-testid="editor-timeline-clip"]');
    expect(after[0]?.getAttribute("data-active")).toBe("false");
    expect(after[1]?.getAttribute("data-active")).toBe("true");
  });
});

describe("editor workspace revision preview", () => {
  it("previews an old revision read-only without touching the head", async () => {
    const user = userEvent.setup();
    const calls: Array<{ url: string; method: string }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? "GET" });
      if (url.endsWith("/history")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            revisions: [
              {
                id: "edrev_2",
                revisionNumber: 2,
                operationType: "SET_TEXT",
                sourceType: "USER",
                sourceId: null,
              },
              {
                id: "edrev_1",
                revisionNumber: 1,
                operationType: "CREATE",
                sourceType: "USER",
                sourceId: null,
              },
            ],
          }),
        } as Response;
      }
      if (url.includes("/revisions/")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            revision: { revisionNumber: 1 },
            snapshot: snapshot([
              node({ id: "historical", name: "Archive", text: { value: "Historical text" } }),
            ]),
          }),
        } as Response;
      }
      return { ok: false, status: 500, json: async () => ({}) } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    renderWorkspace([node({ id: "visible", name: "Shown" })]);

    await user.click(screen.getByTestId("editor-tab-history"));

    const previewButtons = await screen.findAllByTestId("editor-history-preview");
    expect(previewButtons.length).toBe(2);
    await user.click(previewButtons[1]!);

    await waitFor(() => {
      expect(screen.getByTestId("editor-preview-banner")).toBeTruthy();
    });

    // The inspector refuses to edit while a past revision is on screen.
    await user.click(screen.getByTestId("editor-tab-inspector"));
    expect(screen.getByTestId("editor-preview-note").textContent).toContain(
      "read-only",
    );

    // The stage is now showing the past revision's bytes...
    await waitFor(() => {
      expect(screen.getByText("Historical text")).toBeTruthy();
    });

    // ...and looking at the past issued no write.
    expect(
      calls.filter((call) => /POST|PUT|PATCH|DELETE/.test(call.method)),
    ).toHaveLength(0);

    // Leaving the preview returns to the live revision.
    await user.click(screen.getByTestId("editor-preview-exit"));
    await waitFor(() => {
      expect(screen.queryByTestId("editor-preview-banner")).toBeNull();
    });
    expect(screen.getByText("Draft headline")).toBeTruthy();
  });
});

describe("editor workspace AI proposal", () => {
  it("discards a proposal without applying it", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/ai/propose")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            proposal: {
              proposalId: "prop_1",
              baseRevision: "edrev_1",
              summary: "Make the headline bolder",
              provider: "LOCAL",
              grounding: { status: "SUPPORTED", reason: null, claims: ["c1"] },
              operation: { type: "SET_OPACITY", nodeId: "visible", opacity: 0.5 },
            },
          }),
        } as Response;
      }
      return { ok: false, status: 500, json: async () => ({}) } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    renderWorkspace([node({ id: "visible", name: "Shown" })]);

    await user.click(screen.getByText("AI edit"));
    await user.type(screen.getByTestId("editor-propose-input"), "make it bolder");
    await user.click(screen.getByTestId("editor-propose-button"));

    await waitFor(() => {
      expect(screen.getByTestId("editor-proposal-summary")).toBeTruthy();
    });

    await user.click(screen.getByTestId("editor-discard-button"));

    expect(screen.queryByTestId("editor-proposal-summary")).toBeNull();
    // Discarding is a UI action only: nothing was posted to apply.
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).endsWith("/ai/apply")),
    ).toBe(false);
  });
});
