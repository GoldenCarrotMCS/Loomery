import { describe, expect, it } from "vitest";
import { ConversionReport } from "../src/report/report.js";

describe("ConversionReport", () => {
  it("starts empty with a zeroed four-key summary", () => {
    // The summary shape is a contract: ResultView's filter chips index it by
    // status, and the API/report.json consumers read all four keys.
    const report = new ConversionReport();
    expect(report.entries).toEqual([]);
    const { summary } = report.toJSON();
    expect(Object.keys(summary).sort()).toEqual(["approximated", "converted", "error", "skipped"]);
    expect(Object.values(summary)).toEqual([0, 0, 0, 0]);
  });

  it("counts every status into the summary", () => {
    const report = new ConversionReport();
    report.converted("textures", "a.png", ["textures/blocks/a.png"]);
    report.converted("textures", "b.png");
    report.approximated("items", "c.json", "no explicit rename rule");
    report.skipped("fonts", "d.json", "no Bedrock equivalent");
    report.error("items-3d", "e.json", "boom");
    const { summary } = report.toJSON();
    expect(summary).toEqual({ converted: 2, approximated: 1, skipped: 1, error: 1 });
    expect(report.entries).toHaveLength(5);
  });

  it("omits detail on converted, and outputs on skipped/error", () => {
    // The stored objects are what ship in report.json, so an absent field must
    // stay absent rather than serialising as null.
    const report = new ConversionReport();
    report.converted("textures", "a.png", ["out.png"]);
    report.skipped("fonts", "d.json", "why");
    report.error("items", "e.json", "boom");
    const [converted, skipped, errored] = report.entries as any[];
    expect(converted).toEqual({ stage: "textures", source: "a.png", status: "converted", outputs: ["out.png"] });
    expect("detail" in converted).toBe(false);
    expect("outputs" in skipped).toBe(false);
    expect("outputs" in errored).toBe(false);
    expect(skipped.detail).toBe("why");
  });

  it("keeps entries in the order they were reported", () => {
    const report = new ConversionReport();
    report.converted("a", "1");
    report.skipped("b", "2", "x");
    report.converted("c", "3");
    expect(report.entries.map((e) => e.source)).toEqual(["1", "2", "3"]);
  });

  it("records the stage verbatim, including the non-pipeline keys", () => {
    // "items-hints", "config-nudge", "merge" and friends are real stage strings
    // that consumers filter on (ConfigNudgeBanner looks for "config-nudge").
    const report = new ConversionReport();
    report.approximated("config-nudge", "n assets", "upload a config zip");
    report.converted("merge", "2 resource packs merged");
    expect(report.entries.map((e) => e.stage)).toEqual(["config-nudge", "merge"]);
  });

  it("round-trips through JSON with the summary still intact", () => {
    const report = new ConversionReport();
    report.converted("textures", "a.png");
    report.approximated("items", "b.json", "detail");
    const parsed = JSON.parse(JSON.stringify(report.toJSON()));
    expect(parsed.summary.converted).toBe(1);
    expect(parsed.summary.approximated).toBe(1);
    expect(parsed.entries).toHaveLength(2);
  });

  it("returns the live entries array, not a copy", () => {
    // Documented behaviour: toJSON hands back `this.entries`, so a caller that
    // keeps reporting after serialising changes what it already read.
    const report = new ConversionReport();
    const { entries } = report.toJSON();
    report.converted("late", "x");
    expect(entries).toHaveLength(1);
  });
});
