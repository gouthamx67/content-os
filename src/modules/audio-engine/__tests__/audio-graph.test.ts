import { describe, expect, it } from "vitest";
import {
  AUDIO_GRAPH_CONTRACT_VERSION,
  buildAudioGraph,
} from "../serialization/audio-graph";
import { hashAudioGraph } from "../serialization/hash-audio-graph";
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

function composition(
  tracks: AudioTrackRecord[],
): AudioCompositionRecord {
  return {
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
}

describe("buildAudioGraph", () => {
  it("stamps the contract version and project", () => {
    const graph = buildAudioGraph(composition([track()]));
    expect(graph.contractVersion).toBe(AUDIO_GRAPH_CONTRACT_VERSION);
    expect(graph.projectId).toBe("p1");
  });

  it("orders tracks by startMs", () => {
    const graph = buildAudioGraph(
      composition([
        track({ id: "late", startMs: 2000 }),
        track({ id: "early", startMs: 0 }),
      ]),
    );

    expect(graph.composition.tracks.map((t) => t.id)).toEqual([
      "early",
      "late",
    ]);
  });

  it("sorts automation and drops persistence-only fields", () => {
    const graph = buildAudioGraph(
      composition([
        track({
          automation: [
            {
              id: "b",
              trackId: "t1",
              property: "VOLUME_DB",
              timeMs: 2000,
              value: -6,
              easing: "LINEAR",
              createdAt: "2026-01-01T00:00:00.000Z",
            },
            {
              id: "a",
              trackId: "t1",
              property: "VOLUME_DB",
              timeMs: 1000,
              value: 0,
              easing: "LINEAR",
              createdAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        }),
      ]),
    );

    const points = graph.composition.tracks[0]!.automation;
    expect(points.map((p) => p.timeMs)).toEqual([1000, 2000]);
    expect(points[0]).not.toHaveProperty("id");
  });
});

describe("hashAudioGraph", () => {
  it("is stable regardless of track insertion order", () => {
    const a = buildAudioGraph(
      composition([
        track({ id: "a", startMs: 0 }),
        track({ id: "b", startMs: 1000 }),
      ]),
    );
    const b = buildAudioGraph(
      composition([
        track({ id: "b", startMs: 1000 }),
        track({ id: "a", startMs: 0 }),
      ]),
    );

    expect(hashAudioGraph(a)).toBe(hashAudioGraph(b));
  });

  it("changes when a track changes", () => {
    const a = buildAudioGraph(composition([track({ gainDb: 0 })]));
    const b = buildAudioGraph(composition([track({ gainDb: -6 })]));
    expect(hashAudioGraph(a)).not.toBe(hashAudioGraph(b));
  });
});
