import { LocalizationError } from "../errors";
import type { TextDirection } from "./types";

/**
 * The one place a locale string is normalized.
 *
 * BCP-47 is case-insensitive but its canonical form is not: `pt-br` and
 * `PT-BR` are the same locale, and a project that stores both has two rows for
 * one thing. Everything funnels through `Intl.getCanonicalLocales`, which both
 * validates the tag and produces `pt-BR`.
 */
export function canonicalizeLocale(input: string): string {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new LocalizationError("INVALID_LOCALE", "A locale is required");
  }

  let canonical: string[];
  try {
    canonical = Intl.getCanonicalLocales(trimmed);
  } catch {
    throw new LocalizationError(
      "INVALID_LOCALE",
      `Not a valid BCP-47 locale: ${input}`,
      { locale: input },
    );
  }

  const first = canonical[0];
  if (canonical.length !== 1 || first === undefined) {
    throw new LocalizationError(
      "INVALID_LOCALE",
      `Not a single BCP-47 locale: ${input}`,
      { locale: input },
    );
  }

  return first;
}

export function isValidLocale(input: string): boolean {
  try {
    canonicalizeLocale(input);
    return true;
  } catch {
    return false;
  }
}

/**
 * Direction is a property of the writing system, but it is stored per project so
 * a reviewer can correct an unusual case. When `Intl` knows the answer we use it
 * to seed a new project locale; when it does not, the caller must supply one.
 */
export function directionFromLocale(locale: string): TextDirection | null {
  try {
    const intlLocale = new Intl.Locale(locale) as Intl.Locale & {
      getTextInfo?: () => { direction?: string };
    };
    const info = intlLocale.getTextInfo?.();
    if (info?.direction === "rtl") return "RTL";
    if (info?.direction === "ltr") return "LTR";
  } catch {
    return null;
  }
  return null;
}

export function formatNumberForLocale(
  locale: string,
  value: number,
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(locale, options).format(value);
}

export function formatDateForLocale(
  locale: string,
  value: Date,
  options?: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat(locale, options).format(value);
}

export function pluralCategoryForLocale(
  locale: string,
  count: number,
): Intl.LDMLPluralRule {
  return new Intl.PluralRules(locale).select(count);
}
