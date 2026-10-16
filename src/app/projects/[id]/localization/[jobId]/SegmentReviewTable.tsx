"use client";

import { useState } from "react";
import { Button } from "../../../../../components/ui/Button";
import type { LocalizationSegment } from "../../../../../modules/localization-engine/domain/types";

type SegmentReviewTableProps = {
  segments: LocalizationSegment[];
  editable: boolean;
  busy: boolean;
  onEdit: (segmentId: string, targetText: string) => void | Promise<void>;
};

export function SegmentReviewTable({
  segments,
  editable,
  busy,
  onEdit,
}: SegmentReviewTableProps) {
  if (segments.length === 0) {
    return (
      <p
        className="rounded-xl border border-dashed border-[#30343c] p-6 text-xs text-[#777b84]"
        data-testid="segment-empty"
      >
        No segments in this revision.
      </p>
    );
  }

  return (
    <div className="rounded-xl border border-[#202329] bg-[#101216] p-4">
      <p className="text-xs uppercase tracking-wide text-[#62666f]">Segments</p>
      <ul className="mt-3 space-y-3" data-testid="segment-list">
        {segments.map((segment) => (
          <SegmentRow
            key={segment.id}
            segment={segment}
            editable={editable}
            busy={busy}
            onEdit={onEdit}
          />
        ))}
      </ul>
    </div>
  );
}

function SegmentRow({
  segment,
  editable,
  busy,
  onEdit,
}: {
  segment: LocalizationSegment;
  editable: boolean;
  busy: boolean;
  onEdit: SegmentReviewTableProps["onEdit"];
}) {
  const [value, setValue] = useState(segment.targetText ?? "");

  return (
    <li
      data-testid="segment-row"
      data-segment-id={segment.id}
      data-segment-kind={segment.kind}
      className="rounded-lg border border-[#202329] p-3"
    >
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-[#62666f]">
        <span>{segment.kind}</span>
        <span className="normal-case tracking-normal">{segment.path}</span>
      </div>
      <p className="mt-2 text-xs text-[#b4b7bf]">{segment.sourceText}</p>
      <textarea
        data-testid="segment-target"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        readOnly={!editable}
        rows={2}
        className="mt-2 w-full rounded-md border border-[#30343c] bg-[#15171c] px-2 py-1.5 text-xs text-white read-only:opacity-70"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {segment.placeholders.map((placeholder) => (
          <span
            key={placeholder}
            className="rounded border border-[#30343c] px-1.5 py-0.5 text-[10px] text-[#7dd3fc]"
          >
            {placeholder}
          </span>
        ))}
        {editable && (
          <Button
            variant="ghost"
            onClick={() => onEdit(segment.id, value)}
            disabled={busy || value === (segment.targetText ?? "")}
            data-testid="save-segment"
          >
            Save
          </Button>
        )}
      </div>
    </li>
  );
}
