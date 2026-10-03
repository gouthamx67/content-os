import { describe, expect, it } from "vitest";
import { compileAudio } from "../ffmpeg/compile-audio";
import {
  automationDbExpression,
  duckDbExpression,
  linearVolumeExpression,
  panGains,
} from "../ffmpeg/audio-expressions";
import { buildAudioGraph } from "../serialization/audio-graph";
import type {
  AudioCompositionRecord,
  AudioTrackRecord,
} from "../domain/types";

function track(overrides: Partial<AudioTrackRecord> = {}): AudioTrackRecord {
  return {
    id: "t1",
    audioCompositionId: "c1",
    kind: "MUSIC",
    name: "Bed",
    sourceRef: "asset:a",
    startMs: 0,
    sourceOffsetMs: 0,
    durationMs: 5000,
    gainDb: 0,
    pan: 0,
    fadeInMs: 0,
    fadeOutMs: 0,
    mute: false,
    solo: false,
    duckVoiceoverDb: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    automation: [],
    ...overrides,
  };
}

function graph(tracks: AudioTrackRecord[]) {
  const composition: AudioCompositionRecord = {
    id: "c1",
    projectId: "p1",
    compositionId: "vis1",
    name: "Audio",
    sampleRate: 48000,
    channels: 2,
    durationMs: 5000,
    status: "DRAFT",
    createdById: "u1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    tracks,
  };
  return buildAudioGraph(composition);
}

function assetsFor(tracks: AudioTrackRecord[]) {
  return new Map(
    tracks.map((t) => [t.id, { path: `/tmp/${t.id}.wav` }] as const),
  );
}

describe("automationDbExpression", () => {
  it("falls back to the static gain when there are no points", () => {
    const result = automationDbExpression([], -6);
    expect(result.constant).toBe(true);
    expect(Number(result.expression)).toBeCloseTo(-6, 6);
  });

  it("collapses a flat envelope to a constant", () => {
    const result = automationDbExpression(
      [
        { timeMs: 0, value: -3, easing: "LINEAR" },
        { timeMs: 1000, value: -3, easing: "LINEAR" },
      ],
      0,
    );
    expect(result.constant).toBe(true);
    expect(Number(result.expression)).toBeCloseTo(-3, 6);
  });

  it("compiles a varying envelope to a time expression", () => {
    const result = automationDbExpression(
      [
        { timeMs: 0, value: 0, easing: "LINEAR" },
        { timeMs: 1000, value: -12, easing: "LINEAR" },
      ],
      0,
    );
    expect(result.constant).toBe(false);
    expect(result.expression).toContain("t");
    expect(result.expression).toContain("if(lt(t,");
  });
});

describe("duckDbExpression", () => {
  it("is constant zero with no intervals", () => {
    expect(duckDbExpression([], -12, 0)).toEqual({
      expression: "0",
      constant: true,
    });
  });

  it("shifts the interval into track-local time", () => {
    const result = duckDbExpression(
      [{ startMs: 1000, endMs: 3000 }],
      -12,
      500,
    );
    // Shifted by 500ms: 0.5s .. 2.5s.
    expect(result.expression).toContain("between(t,0.5,2.5)");
    expect(result.expression).toContain("-12");
  });
});

describe("linearVolumeExpression", () => {
  it("sums decibels then converts once", () => {
    const result = linearVolumeExpression(
      { expression: "-6", constant: true },
      { expression: "-6", constant: true },
    );
    expect(result.constant).toBe(true);
    expect(Number(result.expression)).toBeCloseTo(10 ** (-12 / 20), 6);
  });

  it("keeps a non-constant envelope and converts at run time", () => {
    const result = linearVolumeExpression(
      { expression: "if(lt(t,1),0,-12)", constant: false },
      { expression: "0", constant: true },
    );
    expect(result.constant).toBe(false);
    expect(result.expression).toContain("pow(10,");
    expect(result.expression).toContain("if(lt(t,1),0,-12)");
  });
});

describe("panGains", () => {
  it("keeps unity at centre", () => {
    expect(panGains(0)).toEqual({ left: 1, right: 1 });
  });

  it("fades the right channel for a left pan", () => {
    expect(panGains(-0.5)).toEqual({ left: 1, right: 0.5 });
  });

  it("fades the left channel for a right pan", () => {
    expect(panGains(0.25)).toEqual({ left: 0.75, right: 1 });
  });
});

describe("compileAudio", () => {
  it("emits a silent bed when there are no audible tracks", () => {
    const compiled = compileAudio(graph([]), { assets: new Map() });
    expect(compiled.inputArgs).toContain("anullsrc=r=48000:cl=stereo");
    expect(compiled.filterComplex).toContain("[abase]anull[aout]");
    expect(compiled.outputLabel).toBe("aout");
    expect(compiled.outputArgs).toContain("pcm_s16le");
  });

  it("mixes a single track over the bed", () => {
    const tracks = [track()];
    const compiled = compileAudio(graph(tracks), {
      assets: assetsFor(tracks),
    });

    expect(compiled.filterComplex).toContain("atrim=start=0:duration=5");
    expect(compiled.filterComplex).toContain("volume=1");
    expect(compiled.filterComplex).toContain("amix=inputs=2");
    expect(compiled.filterComplex).not.toContain("adelay");
  });

  it("delays a track that does not start at zero", () => {
    const tracks = [track({ startMs: 1500 })];
    const compiled = compileAudio(graph(tracks), {
      assets: assetsFor(tracks),
    });
    expect(compiled.filterComplex).toContain("adelay=1500:all=1");
  });

  it("applies ducking to music under a voiceover", () => {
    const tracks = [
      track({ id: "vo", kind: "VOICEOVER", startMs: 1000, durationMs: 2000 }),
      track({ id: "music", duckVoiceoverDb: -12, durationMs: 5000 }),
    ];
    const compiled = compileAudio(graph(tracks), {
      assets: assetsFor(tracks),
    });

    expect(compiled.filterComplex).toContain("between(t,");
    expect(compiled.filterComplex).toContain("eval=frame");
  });

  it("adds fades and pan only when they are set", () => {
    const tracks = [
      track({ fadeInMs: 500, fadeOutMs: 500, pan: -0.5 }),
    ];
    const compiled = compileAudio(graph(tracks), {
      assets: assetsFor(tracks),
    });

    expect(compiled.filterComplex).toContain("afade=t=in:st=0:d=0.5");
    expect(compiled.filterComplex).toContain("afade=t=out:st=4.5:d=0.5");
    expect(compiled.filterComplex).toContain("pan=stereo|c0=c0*1|c1=c1*0.5");
  });

  it("throws when an audible track has no resolved source", () => {
    expect(() => compileAudio(graph([track()]), { assets: new Map() })).toThrow();
  });
});
