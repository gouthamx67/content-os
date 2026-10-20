/**
 * @vitest-environment jsdom
 *
 * Guided creative mode refuses to run without a product-UI asset, so the
 * asset form has to be able to create one. This covers the decision the form
 * owns: the selected type is what gets posted, not a hardcoded IMAGE.
 */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

import { SourceAssetForms } from "./SourceAssetForms";

describe("SourceAssetForms assets", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    refreshMock.mockReset();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("posts a screenshot when the user selects the screenshot type", async () => {
    const user = userEvent.setup();
    render(
      <SourceAssetForms
        projectId="prj_1"
        inputs={[]}
        versions={[]}
        assets={[]}
      />,
    );

    expect(
      screen.getByText(/Guided mode show the real product interface/i),
    ).toBeTruthy();

    await user.type(screen.getByPlaceholderText("Asset name"), "Dashboard");
    await user.selectOptions(
      screen.getByLabelText("Asset type"),
      "SCREENSHOT",
    );
    await user.type(
      screen.getByPlaceholderText("https://…/image.png"),
      "https://example.com/dashboard.png",
    );
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/projects/prj_1/assets");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      type: "SCREENSHOT",
      name: "Dashboard",
      uri: "https://example.com/dashboard.png",
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("uploads a screenshot file from the device", async () => {
    const user = userEvent.setup();
    render(
      <SourceAssetForms
        projectId="prj_1"
        inputs={[]}
        versions={[]}
        assets={[]}
      />,
    );

    await user.type(screen.getByPlaceholderText("Asset name"), "Checkout");
    await user.selectOptions(
      screen.getByLabelText("Asset type"),
      "SCREENSHOT",
    );
    await user.click(screen.getByRole("button", { name: "From device" }));

    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "checkout.png", {
      type: "image/png",
    });
    await user.upload(screen.getByLabelText("Asset file"), file);
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/projects/prj_1/assets/upload");
    expect(init.method).toBe("POST");
    expect(init.headers).toBeUndefined();

    const body = init.body as FormData;
    expect(body.get("type")).toBe("SCREENSHOT");
    expect(body.get("name")).toBe("Checkout");
    const uploaded = body.get("file") as File;
    expect(uploaded.name).toBe("checkout.png");
    expect(uploaded.type).toBe("image/png");
    expect(refreshMock).toHaveBeenCalled();
  });
});
