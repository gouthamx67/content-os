import { describe, expect, it } from "vitest";
import { parseScript, scriptToVoiceover } from "./parse-script";

describe("parseScript", () => {
  it("reads speaker turns and plain narration", () => {
    const lines = parseScript(
      ["HOST: Welcome to the launch.", "Cut to the dashboard.", "NARRATOR: Here it is."].join(
        "\n",
      ),
    );
    expect(lines).toEqual([
      { speaker: "HOST", text: "Welcome to the launch." },
      { speaker: null, text: "Cut to the dashboard." },
      { speaker: "NARRATOR", text: "Here it is." },
    ]);
  });

  it("ignores blank lines", () => {
    expect(parseScript("A line.\n\n  \nAnother.")).toHaveLength(2);
  });

  it("joins spoken words for a voiceover", () => {
    expect(
      scriptToVoiceover("HOST: One.\nNARRATOR: Two."),
    ).toBe("One. Two.");
  });
});
