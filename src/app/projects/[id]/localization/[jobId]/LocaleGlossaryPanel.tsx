"use client";

import { useState } from "react";
import { Button } from "../../../../../components/ui/Button";
import type { LocaleGlossaryRecord } from "../../../../../modules/localization-engine/domain/types";

type LocaleGlossaryPanelProps = {
  projectId: string;
  glossary: LocaleGlossaryRecord[];
  sourceLocale: string;
  targetLocale: string;
  onChanged: () => void | Promise<void>;
};

export function LocaleGlossaryPanel({
  projectId,
  glossary,
  sourceLocale,
  targetLocale,
  onChanged,
}: LocaleGlossaryPanelProps) {
  const [term, setTerm] = useState("");
  const [translation, setTranslation] = useState("");
  const [doNotTranslate, setDoNotTranslate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const base = `/api/projects/${projectId}/localization/glossary`;

  async function add(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch(base, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceLocale,
          targetLocale,
          term: term.trim(),
          translation: translation.trim(),
          doNotTranslate,
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(payload.error ?? "Could not add term");
        return;
      }
      setTerm("");
      setTranslation("");
      setDoNotTranslate(false);
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function remove(termId: string) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`${base}/${termId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(payload.error ?? "Could not remove term");
        return;
      }
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-[#202329] bg-[#101216] p-4">
      <p className="text-xs uppercase tracking-wide text-[#62666f]">
        Glossary · {sourceLocale} → {targetLocale}
      </p>

      {glossary.length === 0 ? (
        <p className="mt-2 text-xs text-[#777b84]" data-testid="glossary-empty">
          No pinned terms.
        </p>
      ) : (
        <ul className="mt-3 space-y-1.5" data-testid="glossary-list">
          {glossary.map((entry) => (
            <li
              key={entry.id}
              data-testid="glossary-row"
              data-term={entry.term}
              className="flex items-center justify-between rounded-lg border border-[#202329] px-3 py-1.5 text-xs"
            >
              <span className="text-[#b4b7bf]">
                {entry.term} →{" "}
                {entry.doNotTranslate ? (
                  <span className="text-[#fbbf24]">do not translate</span>
                ) : (
                  entry.translation
                )}
              </span>
              <button
                type="button"
                onClick={() => remove(entry.id)}
                disabled={busy}
                data-testid="remove-glossary"
                className="text-[#62666f] hover:text-red-300"
                aria-label={`Remove ${entry.term}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={add} className="mt-3 space-y-2">
        <input
          data-testid="glossary-term"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Term"
          className="w-full rounded-md border border-[#30343c] bg-[#15171c] px-2 py-1.5 text-xs text-white"
        />
        <input
          data-testid="glossary-translation"
          value={translation}
          onChange={(event) => setTranslation(event.target.value)}
          placeholder="Translation"
          disabled={doNotTranslate}
          className="w-full rounded-md border border-[#30343c] bg-[#15171c] px-2 py-1.5 text-xs text-white disabled:opacity-50"
        />
        <label className="flex items-center gap-2 text-xs text-[#b4b7bf]">
          <input
            type="checkbox"
            data-testid="glossary-do-not-translate"
            checked={doNotTranslate}
            onChange={(event) => setDoNotTranslate(event.target.checked)}
          />
          Do not translate
        </label>
        {error && (
          <p className="text-xs text-red-300" data-testid="glossary-error">
            {error}
          </p>
        )}
        <Button
          variant="secondary"
          className="w-full"
          disabled={busy || term.trim().length === 0}
          data-testid="add-glossary"
        >
          Pin term
        </Button>
      </form>
    </section>
  );
}
