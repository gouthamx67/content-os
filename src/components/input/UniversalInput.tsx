"use client";

import {
  FileText,
  GitBranch,
  Globe,
  Upload,
} from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "../ui/Button";

const sources = [
  {
    label: "Website",
    icon: Globe,
    accept: "url",
  },
  {
    label: "Repository",
    icon: GitBranch,
    accept: "url",
  },
  {
    label: "Files",
    icon: FileText,
    accept: "file",
  },
];

export function UniversalInput() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [files, setFiles] = useState<string[]>([]);

  function handleFiles(selected: FileList | null) {
    if (!selected) return;

    setFiles((current) => [
      ...current,
      ...Array.from(selected).map((file) => file.name),
    ]);
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-[#30343c] bg-[#101216] shadow-2xl shadow-black/20">
      <div className="p-3">
        <div className="rounded-xl border border-[#24272e] bg-[#0c0e11]">
          <textarea
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="Paste a website, GitHub repository, product URL, or describe what you're starting with..."
            className="min-h-32 w-full resize-none bg-transparent px-4 py-4 text-sm text-white outline-none placeholder:text-[#62666f]"
          />

          {files.length > 0 && (
            <div className="flex flex-wrap gap-2 border-t border-[#24272e] px-4 py-3">
              {files.map((file) => (
                <span
                  key={file}
                  className="rounded-md border border-[#30343c] bg-[#15171c] px-2 py-1 text-xs text-[#b4b7bf]"
                >
                  {file}
                </span>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#24272e] p-3">
            <div className="flex flex-wrap gap-1">
              {sources.map((source) => {
                const Icon = source.icon;

                return (
                  <button
                    key={source.label}
                    type="button"
                    onClick={() => {
                      if (source.accept === "file") {
                        inputRef.current?.click();
                      }
                    }}
                    className="inline-flex min-h-9 items-center gap-2 rounded-lg px-3 text-xs text-[#8d919a] transition-colors hover:bg-[#181b20] hover:text-white"
                  >
                    <Icon size={14} />
                    {source.label}
                  </button>
                );
              })}

              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="inline-flex min-h-9 items-center gap-2 rounded-lg px-3 text-xs text-[#8d919a] hover:bg-[#181b20] hover:text-white"
              >
                <Upload size={14} />
                Upload
              </button>
            </div>

            <Button
              type="button"
              onClick={() => {
                if (!value.trim() && files.length === 0) {
                  inputRef.current?.click();
                }
              }}
            >
              <span className="text-xs">✦</span>
              Start creating
            </Button>
          </div>
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.zip"
        onChange={(event) => {
          handleFiles(event.target.files);
          event.currentTarget.value = "";
        }}
      />
    </div>
  );
}