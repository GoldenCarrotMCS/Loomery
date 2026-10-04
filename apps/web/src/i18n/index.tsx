import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { en, type Messages } from "./en.js";
import { zhCN } from "./zh-CN.js";

export type { Messages };

/**
 * Locale registry. Adding a language is one entry here plus one catalogue file —
 * the `Messages` type makes a missing key a compile error, so a new catalogue
 * cannot ship half-translated without failing the build.
 */
export const LOCALES = {
  en: { name: "English", messages: en },
  "zh-CN": { name: "简体中文", messages: zhCN },
} as const;

export type LocaleId = keyof typeof LOCALES;

const LOCALE_IDS = Object.keys(LOCALES) as LocaleId[];
export const DEFAULT_LOCALE: LocaleId = "en";

const STORAGE_KEY = "loomery.locale";

/**
 * Pick the first locale the browser actually asks for, falling back through
 * language-only matches (`zh` → `zh-CN`). A stored choice always wins, so a user
 * who switched languages once is never overridden by the browser's header.
 */
export function detectLocale(): LocaleId {
  if (typeof navigator === "undefined") return DEFAULT_LOCALE;

  let stored: string | null = null;
  try {
    stored = globalThis.localStorage?.getItem(STORAGE_KEY) ?? null;
  } catch {
    // Storage can throw in private mode; detection just falls through.
  }
  if (stored !== null && (LOCALE_IDS as string[]).includes(stored)) return stored as LocaleId;

  const wanted = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const tag of wanted) {
    const lower = tag.toLowerCase();
    const exact = LOCALE_IDS.find((id) => id.toLowerCase() === lower);
    if (exact !== undefined) return exact;
    const base = lower.split("-")[0]!;
    const partial = LOCALE_IDS.find((id) => id.toLowerCase().split("-")[0] === base);
    if (partial !== undefined) return partial;
  }
  return DEFAULT_LOCALE;
}

/** Dotted path into the catalogue, e.g. `"rail.options"`. */
type Path = string;

function lookup(messages: Messages, path: Path): string {
  let node: unknown = messages;
  for (const part of path.split(".")) {
    if (typeof node !== "object" || node === null) return path;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : path;
}

/**
 * Substitute `{name}` placeholders. A missing value is left as the literal
 * `{name}` rather than replaced with "undefined", so a translation gap is
 * visible in the UI instead of silently reading as broken copy.
 */
export function interpolate(template: string, values?: Record<string, string | number>): string {
  if (values === undefined) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = values[key];
    return value === undefined ? match : String(value);
  });
}

interface I18nValue {
  locale: LocaleId;
  setLocale: (id: LocaleId) => void;
  /** Translated string for a dotted key, with `{placeholder}` substitution. */
  t: (key: Path, values?: Record<string, string | number>) => string;
  /** Every locale, for the language switcher. */
  locales: { id: LocaleId; name: string }[];
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<LocaleId>(() => detectLocale());

  const setLocale = useCallback((id: LocaleId) => {
    setLocaleState(id);
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, id);
    } catch {
      // Persisting is a convenience; a blocked store must not break switching.
    }
  }, []);

  // Keep the document language in sync for screen readers, hyphenation and
  // font fallback (a CJK locale wants different default faces).
  useEffect(() => {
    if (typeof document !== "undefined") document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo<I18nValue>(() => {
    const messages = LOCALES[locale].messages;
    return {
      locale,
      setLocale,
      t: (key, values) => interpolate(lookup(messages, key), values),
      locales: LOCALE_IDS.map((id) => ({ id, name: LOCALES[id].name })),
    };
  }, [locale, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (value === null) throw new Error("useI18n must be used inside <I18nProvider>");
  return value;
}

/** Shorthand for the common `const { t } = useI18n()` case. */
export function useT(): I18nValue["t"] {
  return useI18n().t;
}
