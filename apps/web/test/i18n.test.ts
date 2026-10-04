import { describe, expect, it } from "vitest";
import { en, type Messages } from "../src/i18n/en.js";
import { zhCN } from "../src/i18n/zh-CN.js";
import { LOCALES, interpolate } from "../src/i18n/index.js";

/** Flatten a catalogue into dotted key → string, so locales can be compared. */
function flatten(value: unknown, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof value === "string") {
    out[prefix] = value;
    return out;
  }
  if (typeof value !== "object" || value === null) return out;
  for (const [key, child] of Object.entries(value)) {
    Object.assign(out, flatten(child, prefix === "" ? key : `${prefix}.${key}`));
  }
  return out;
}

const ENGLISH = flatten(en);
const CATALOGUES: { id: string; messages: Messages }[] = Object.entries(LOCALES).map(([id, entry]) => ({
  id,
  messages: entry.messages,
}));

/** `{name}` placeholders used by a template, as a sorted list. */
function placeholders(template: string): string[] {
  return [...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();
}

describe("message catalogues", () => {
  it("ships at least English and Simplified Chinese", () => {
    const ids = Object.keys(LOCALES);
    expect(ids).toContain("en");
    expect(ids).toContain("zh-CN");
  });

  it("has exactly the same key set as English in every locale", () => {
    // The `Messages` type already enforces this, but a structural check catches
    // a catalogue that was cast or assembled dynamically.
    for (const { id, messages } of CATALOGUES) {
      const keys = Object.keys(flatten(messages)).sort();
      expect(Object.keys(ENGLISH).sort(), `${id} key set differs from en`).toEqual(keys);
    }
  });

  it("has no empty or whitespace-only strings", () => {
    // An empty string renders as a blank label rather than an obvious TODO, so
    // it is worse than a missing key.
    for (const { id, messages } of CATALOGUES) {
      for (const [key, text] of Object.entries(flatten(messages))) {
        expect(text.trim().length, `${id}: "${key}" is empty`).toBeGreaterThan(0);
      }
    }
  });

  it("uses the same interpolation placeholders as English", () => {
    // A `{count}` present only in English would render literally in the other
    // locales; a placeholder present only in a translation would never be
    // substituted at all.
    for (const { id, messages } of CATALOGUES) {
      const flat = flatten(messages);
      for (const [key, text] of Object.entries(flat)) {
        const expected = placeholders(ENGLISH[key] ?? "");
        expect(placeholders(text), `${id}: "${key}" placeholders differ from en`).toEqual(expected);
      }
    }
  });

  it("keeps the inline markup markers balanced", () => {
    // RichText splits on backticks and asterisks; an odd count silently eats the
    // rest of the sentence instead of failing loudly.
    for (const { id, messages } of CATALOGUES) {
      for (const [key, text] of Object.entries(flatten(messages))) {
        const backticks = (text.match(/`/g) ?? []).length;
        const doubles = (text.match(/\*\*/g) ?? []).length;
        expect(backticks % 2, `${id}: "${key}" has an unclosed \`code\` span`).toBe(0);
        expect(doubles % 2, `${id}: "${key}" has an unclosed **bold** span`).toBe(0);
      }
    }
  });

  it("translates the visible chrome, not just leaves it in English", () => {
    // Spot-check a few user-facing strings that would be easy to forget.
    const zh = flatten(zhCN);
    expect(zh["convert.action"]).not.toBe(ENGLISH["convert.action"]);
    expect(zh["rail.packs"]).not.toBe(ENGLISH["rail.packs"]);
    expect(zh["work.workspace"]).not.toBe(ENGLISH["work.workspace"]);
  });

  it("leaves technical identifiers untranslated", () => {
    // Plugin and file names must survive translation as searchable strings.
    const zh = flatten(zhCN);
    for (const key of ["plugins.geyser", "plugins.floodgate", "plugins.utils"]) {
      expect(zh[key]).toBe(ENGLISH[key]);
    }
    expect(zh["result.reportJson"]).toBe("report.json");
  });

  it("keeps the product name out of the translations", () => {
    // "Loomery" is a brand, not copy — it must not be transliterated.
    for (const { messages } of CATALOGUES) {
      const flat = flatten(messages);
      expect(flat["lang.name"]).toBeDefined();
      expect(Object.values(flat).some((v) => v.includes("Loomery"))).toBe(false);
    }
  });
});

describe("interpolate", () => {
  it("substitutes every named placeholder", () => {
    expect(interpolate("Converting {name}", { name: "pack.zip" })).toBe("Converting pack.zip");
    expect(interpolate("{done}/{total}", { done: 3, total: 7 })).toBe("3/7");
  });

  it("substitutes the same placeholder more than once", () => {
    expect(interpolate("{n} of {n}", { n: 2 })).toBe("2 of 2");
  });

  it("leaves an unknown placeholder visible instead of printing undefined", () => {
    // A gap must read as a gap, not as "undefined" in the middle of a sentence.
    expect(interpolate("Hello {who}", {})).toBe("Hello {who}");
    expect(interpolate("Hello {who}")).toBe("Hello {who}");
  });

  it("does not touch braces that are not placeholders", () => {
    expect(interpolate("a { b } c", { b: "x" })).toBe("a { b } c");
    expect(interpolate("set {a-b}", { "a-b": "x" })).toBe("set {a-b}");
  });

  it("passes numbers through without locale formatting surprises", () => {
    // Values come from report counters, not user input; keeping them verbatim
    // avoids a thousands separator appearing inside a filename or stage label.
    expect(interpolate("{count}", { count: 12345 })).toBe("12345");
  });
});
