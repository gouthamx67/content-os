/**
 * @vitest-environment jsdom
 *
 * The brand panel is where a user sees whether the layer is trustworthy: what
 * was read, what beat what, and which disagreements stayed open. So it gets a
 * real render test against a stubbed fetch. It asserts the panel *asks* for the
 * right things; that the requests are honoured is covered by the API
 * integration tests.
 */
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

import { BrandPanel } from "./BrandPanel";
import { serializeBrandProfile } from "../../lib/brand-api";
import { emptyBrandProfile, toBrandExecutionProfile } from "../../core/domain/brand";

const projectId = "prj_1";

function profile(overrides: Parameters<typeof emptyBrandProfile> extends never ? never : object = {}) {
  const base = emptyBrandProfile(projectId, "brp_1", "2026-01-01T00:00:00.000Z");
  return {
    ...base,
    name: "Acme",
    positioning: "The content operating system for regulated teams",
    colors: [
      {
        id: "brc_1",
        name: "Brand indigo",
        hex: "#4f46e5",
        role: "PRIMARY" as const,
        confidence: "HIGH" as const,
        origin: "EXTRACTED" as const,
        basis: "DESIGN_TOKEN" as const,
        sourceIds: [],
        evidenceIds: ["evd_1"],
        notes: null,
      },
    ],
    ...overrides,
  };
}

/** Each section has its own edit affordance, so tests target them by name. */
function editIn(sectionTitle: string): HTMLElement {
  const section = screen.getByRole("heading", { name: sectionTitle }).closest("section");
  expect(section).toBeTruthy();
  return within(section as HTMLElement).getByRole("button", { name: /^edit$/i });
}

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
  refreshMock.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("BrandPanel", () => {
  it("offers analysis instead of pretending a brand exists", () => {
    stubFetch(() => jsonResponse({ brand: null }));
    render(<BrandPanel projectId={projectId} brand={null} execution={null} sourceStates={[]} />);

    expect(screen.getByText("No brand profile yet")).toBeTruthy();
    expect(screen.getByRole("button", { name: /analyze brand/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /refresh/i })).toBeNull();
  });

  it("renders the composed brand, its provenance and the generation projection", () => {
    const brand = serializeBrandProfile(profile());
    render(
      <BrandPanel
        projectId={projectId}
        brand={brand}
        execution={toBrandExecutionProfile(profile())}
        sourceStates={[
          {
            sourceId: "src_1",
            contentHash: "hash_1",
            sourceUpdatedAt: "2026-01-01T00:00:00.000Z",
            analyzerId: "brand-text",
            brandVersion: 1,
            analyzedAt: "2026-01-01T00:00:00.000Z",
          },
        ]}
      />,
    );

    expect(screen.getByRole("heading", { name: "Acme" })).toBeTruthy();
    expect(screen.getByText("#4f46e5 · primary")).toBeTruthy();
    // Provenance is part of the value, not a detail: a design token must read
    // differently from a loose extraction.
    expect(screen.getAllByText(/design token/i).length).toBeGreaterThan(0);
    expect(
      screen.getByText((_content, node) => node?.textContent === "1 source read. A refresh re-reads only new or changed sources."),
    ).toBeTruthy();
  });

  it("keeps a disagreement visible with both values and the deciding basis", () => {
    const brand = serializeBrandProfile(
      profile({
        conflicts: [
          {
            id: "brx_1",
            field: "color:primary",
            retained: "PRIMARY #111111",
            competing: "PRIMARY #4f46e5",
            resolvedBy: "USER",
            sourceIds: [],
            evidenceIds: [],
          },
        ],
      }),
    );
    render(
      <BrandPanel projectId={projectId} brand={brand} execution={toBrandExecutionProfile(profile())} sourceStates={[]} />,
    );

    const section = screen.getByText("Unresolved disagreements").closest("section");
    expect(section).toBeTruthy();
    const text = within(section as HTMLElement).getByText(/Kept/);
    expect(text.textContent).toContain("#111111");
    expect(text.textContent).toContain("#4f46e5");
    expect(within(section as HTMLElement).getByText(/resolved by user/i)).toBeTruthy();
  });

  it("posts a manual analysis and reports what was actually read", async () => {
    stubFetch(() =>
      jsonResponse({
        brand: serializeBrandProfile(profile()),
        skipped: "NONE",
        analyzedSourceIds: ["src_1"],
        notes: ["AI interpretation disabled; deterministic brand analysis only"],
      }),
    );
    const user = userEvent.setup();
    render(<BrandPanel projectId={projectId} brand={null} execution={null} sourceStates={[]} />);

    await user.click(screen.getByRole("button", { name: /analyze brand/i }));

    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]?.url).toBe(`/api/projects/${projectId}/brand/analyze`);
    expect(requests[0]?.init?.method).toBe("POST");
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({ force: false });
    await waitFor(() => expect(screen.getByText(/Analyzed 1 source/)).toBeTruthy());
  });

  it("asks for a forced re-analysis when the user says re-analyze all", async () => {
    stubFetch(() =>
      jsonResponse({
        brand: serializeBrandProfile(profile()),
        skipped: "NONE",
        analyzedSourceIds: ["src_1"],
        notes: [],
      }),
    );
    const user = userEvent.setup();
    render(
      <BrandPanel
        projectId={projectId}
        brand={serializeBrandProfile(profile())}
        execution={null}
        sourceStates={[]}
      />,
    );

    await user.click(screen.getByRole("button", { name: /re-analyze all/i }));

    await waitFor(() => expect(requests).toHaveLength(1));
    // Without the flag the endpoint would only look at changed sources, and the
    // button would quietly do nothing.
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({ force: true });
  });

  it("says an unchanged refresh did nothing instead of claiming a new analysis", async () => {
    stubFetch(() => jsonResponse({ brand: serializeBrandProfile(profile()), skipped: "UP_TO_DATE" }));
    const user = userEvent.setup();
    render(
      <BrandPanel
        projectId={projectId}
        brand={serializeBrandProfile(profile())}
        execution={toBrandExecutionProfile(profile())}
        sourceStates={[]}
      />,
    );

    await user.click(screen.getByRole("button", { name: /^refresh$/i }));

    expect(requests[0]?.url).toBe(`/api/projects/${projectId}/brand/refresh`);
    await waitFor(() =>
      expect(screen.getByText(/No new or changed sources since the last brand analysis/i)).toBeTruthy(),
    );
  });

  it("cannot refresh a locked brand without unlocking it first", () => {
    stubFetch(() => jsonResponse({}));
    render(
      <BrandPanel
        projectId={projectId}
        brand={serializeBrandProfile(profile({ locked: true }))}
        execution={toBrandExecutionProfile(profile())}
        sourceStates={[]}
      />,
    );

    const refresh = screen.getByRole("button", { name: /^refresh$/i });
    expect((refresh as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("button", { name: /unlock/i })).toBeTruthy();
  });

  it("only sends the text fields the user actually changed", async () => {
    let patched: Record<string, unknown> = {};
    stubFetch((_url, init) => {
      patched = JSON.parse(String(init?.body ?? "{}"));
      return jsonResponse({ brand: serializeBrandProfile(profile()) });
    });
    const user = userEvent.setup();
    render(
      <BrandPanel
        projectId={projectId}
        brand={serializeBrandProfile(profile())}
        execution={toBrandExecutionProfile(profile())}
        sourceStates={[]}
      />,
    );

    await user.click(editIn("Identity"));
    const nameInput = screen.getByDisplayValue("Acme");
    await user.clear(nameInput);
    await user.type(nameInput, "Acme Holdings");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(requests).toHaveLength(1));
    // The patch owns only what changed, so an untouched field is never sent and
    // can never be cleared by accident.
    expect(patched).toEqual({ name: "Acme Holdings" });
    expect(requests[0]?.init?.method).toBe("PATCH");
  });

  it("replaces the whole palette in one patch and warns what it displaces", async () => {
    let patched: Record<string, unknown> = {};
    stubFetch((_url, init) => {
      patched = JSON.parse(String(init?.body ?? "{}"));
      return jsonResponse({ brand: serializeBrandProfile(profile()) });
    });
    const user = userEvent.setup();
    render(
      <BrandPanel
        projectId={projectId}
        brand={serializeBrandProfile(profile())}
        execution={toBrandExecutionProfile(profile())}
        sourceStates={[]}
      />,
    );

    await user.click(editIn("Color"));
    const hexInput = screen.getByDisplayValue("#4f46e5");
    await user.clear(hexInput);
    await user.type(hexInput, "#111111");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(requests).toHaveLength(1));
    expect(patched).toEqual({
      colors: [{ name: "Brand indigo", hex: "#111111", role: "PRIMARY" }],
    });
    await waitFor(() =>
      expect(screen.getByText(/The replaced color is kept as a visible conflict/)).toBeTruthy(),
    );
  });

  it("surfaces an API error instead of pretending the edit landed", async () => {
    stubFetch(
      () =>
        new Response(JSON.stringify({ error: "brand profile is locked" }), {
          status: 423,
          headers: { "content-type": "application/json" },
        }),
    );
    const user = userEvent.setup();
    render(
      <BrandPanel
        projectId={projectId}
        brand={serializeBrandProfile(profile())}
        execution={toBrandExecutionProfile(profile())}
        sourceStates={[]}
      />,
    );

    await user.click(screen.getByRole("button", { name: /lock/i }));

    await waitFor(() => expect(screen.getByText("brand profile is locked")).toBeTruthy());
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
