"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "../../../../components/ui/Button";
import type { ProjectLocaleRecord } from "../../../../modules/localization-engine/domain/types";

type LocaleSelectorProps = {
  projectId: string;
  initialLocales: ProjectLocaleRecord[];
};

/**
 * Locale configuration.
 *
 * A locale is added as a canonical code (the server canonicalizes it, so
 * `pt-br` becomes `pt-BR`), and a project may mark exactly the locale it writes
 * in as the source. Direction is stored, never guessed from the language name.
 */
export function LocaleSelector({ projectId, initialLocales }: LocaleSelectorProps) {
  const router = useRouter();
  const [locales, setLocales] = useState(initialLocales);
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [isSource, setIsSource] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function reload() {
    const response = await fetch(`/api/projects/${projectId}/locales`, {
      credentials: "include",
    });
    if (response.ok) {
      const payload = (await response.json()) as { locales: ProjectLocaleRecord[] };
      setLocales(payload.locales);
    }
    router.refresh();
  }

  async function add(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");

    try {
      const response = await fetch(`/api/projects/${projectId}/locales`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          locale: code.trim(),
          label: label.trim() || undefined,
          isSource,
          isTarget: !isSource,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(payload.error ?? "Could not add locale");
        return;
      }

      setCode("");
      setLabel("");
      setIsSource(false);
      await reload();
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  async function remove(localeId: string) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/api/projects/${projectId}/locales/${localeId}`,
        { method: "DELETE", credentials: "include" },
      );
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(payload.error ?? "Could not remove locale");
        return;
      }
      await reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-[#202329] bg-[#101216] p-4">
      <p className="text-xs uppercase tracking-wide text-[#62666f]">Locales</p>

      <ul className="mt-3 flex flex-wrap gap-2">
        {locales.map((locale) => (
          <li
            key={locale.id}
            data-testid="locale-row"
            data-locale={locale.locale}
            className="inline-flex items-center gap-2 rounded-full border border-[#30343c] px-3 py-1 text-xs text-white"
          >
            <span>{locale.label}</span>
            <span className="text-[#62666f]">{locale.locale}</span>
            {locale.isSource && (
              <span className="text-[10px] uppercase text-[#7dd3fc]">source</span>
            )}
            {locale.direction === "RTL" && (
              <span className="text-[10px] uppercase text-[#fbbf24]">rtl</span>
            )}
            <button
              type="button"
              onClick={() => remove(locale.id)}
              disabled={busy}
              data-testid="remove-locale"
              className="text-[#62666f] hover:text-red-300"
              aria-label={`Remove ${locale.locale}`}
            >
              ×
            </button>
          </li>
        ))}
        {locales.length === 0 && (
          <li className="text-xs text-[#777b84]" data-testid="locale-empty">
            No locales configured yet.
          </li>
        )}
      </ul>

      <form onSubmit={add} className="mt-4 flex flex-wrap items-end gap-2">
        <label className="text-[10px] text-[#777b84]">
          Locale code
          <input
            data-testid="locale-code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="pt-BR"
            className="mt-1 block w-32 rounded-md border border-[#30343c] bg-[#15171c] px-2 py-1.5 text-xs text-white"
          />
        </label>
        <label className="text-[10px] text-[#777b84]">
          Label
          <input
            data-testid="locale-label"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Brazilian Portuguese"
            className="mt-1 block w-48 rounded-md border border-[#30343c] bg-[#15171c] px-2 py-1.5 text-xs text-white"
          />
        </label>
        <label className="inline-flex items-center gap-2 pb-1 text-xs text-[#b4b7bf]">
          <input
            type="checkbox"
            data-testid="locale-is-source"
            checked={isSource}
            onChange={(event) => setIsSource(event.target.checked)}
          />
          Source
        </label>
        <Button variant="secondary" disabled={busy} data-testid="add-locale">
          Add locale
        </Button>
      </form>

      {error && (
        <p className="mt-3 text-xs text-red-300" data-testid="locale-error">
          {error}
        </p>
      )}
    </section>
  );
}
