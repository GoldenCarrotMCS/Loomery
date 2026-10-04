import { afterEach, describe, expect, it } from "vitest";
import { Timings, beginTimings, finishTimings, timeOp, timeOpAsync } from "../src/report/timings.js";

// The hot-op sink is module-global and single-flight, so every test that arms it
// must disarm it or it leaks into the next test file.
afterEach(() => {
  finishTimings();
});

describe("Timings", () => {
  it("collects stages in call order, rounding each duration", () => {
    const timings = new Timings();
    timings.stage("textures", 12.4);
    timings.stage("items", 0.6);
    expect(timings.stages).toEqual([
      { name: "textures", ms: 12 },
      { name: "items", ms: 1 },
    ]);
  });

  it("sums stage times into totalMs", () => {
    const timings = new Timings();
    timings.stage("a", 10.2);
    timings.stage("b", 5.2);
    expect(timings.toJSON().totalMs).toBe(15);
  });

  it("accumulates repeated op categories into one count and total", () => {
    const timings = new Timings();
    timings.record("png.decode", 2);
    timings.record("png.decode", 3);
    timings.record("atlas.build", 1);
    expect(timings.ops.get("png.decode")).toEqual({ count: 2, totalMs: 5 });
    expect(timings.ops.get("atlas.build")).toEqual({ count: 1, totalMs: 1 });
  });

  it("sorts ops by total time descending, so the hottest work is first", () => {
    // PerfPanel renders these in order and shows only the first 8 — an unsorted
    // list would hide the actual hotspot.
    const timings = new Timings();
    timings.record("cold", 1);
    timings.record("hot", 100);
    timings.record("warm", 10);
    const ops = timings.toJSON().ops;
    expect(ops.map((o) => o.category)).toEqual(["hot", "warm", "cold"]);
  });

  it("returns an empty op list and zero total for no measurements", () => {
    const timings = new Timings();
    expect(timings.toJSON()).toEqual({ totalMs: 0, stages: [], ops: [] });
  });

  it("reports zero total when every stage duration rounds away", () => {
    const timings = new Timings();
    timings.stage("tiny", 0.2);
    expect(timings.toJSON()).toEqual({ totalMs: 0, stages: [{ name: "tiny", ms: 0 }], ops: [] });
  });
});

describe("timeOp / timeOpAsync", () => {
  it("runs the function and returns its value even when no conversion is armed", () => {
    // The zero-overhead path: outside a begin/finish bracket nothing is
    // recorded, but the wrapped call must behave exactly as if unwrapped.
    expect(timeOp("png.decode", () => 42)).toBe(42);
    expect(timeOp("png.decode", () => "x")).toBe("x");
  });

  it("does not record into an unarmed sink", () => {
    const timings = new Timings();
    beginTimings(timings);
    finishTimings();
    timeOp("png.decode", () => 1);
    expect(timings.ops.size).toBe(0);
  });

  it("records the elapsed time under the given category when armed", () => {
    const timings = new Timings();
    beginTimings(timings);
    const value = timeOp("atlas.build", () => 7);
    finishTimings();
    expect(value).toBe(7);
    expect(timings.ops.get("atlas.build")?.count).toBe(1);
    expect(timings.ops.get("atlas.build")?.totalMs).toBeGreaterThanOrEqual(0);
  });

  it("records the op even when the wrapped function throws", () => {
    // The record happens in a finally, so a stage that blows up still shows up
    // in the timing breakdown instead of vanishing from the profile.
    const timings = new Timings();
    beginTimings(timings);
    expect(() =>
      timeOp("geometry.build", () => {
        throw new Error("boom");
      }),
    ).toThrow("boom");
    finishTimings();
    expect(timings.ops.get("geometry.build")?.count).toBe(1);
  });

  it("awaits an async function, records it, and propagates its value", async () => {
    const timings = new Timings();
    beginTimings(timings);
    const value = await timeOpAsync("png.encode.pool", async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return "done";
    });
    finishTimings();
    expect(value).toBe("done");
    expect(timings.ops.get("png.encode.pool")?.count).toBe(1);
  });

  it("records an async op that rejects, and still rejects", async () => {
    const timings = new Timings();
    beginTimings(timings);
    await expect(
      timeOpAsync("png.encode.pool", async () => {
        throw new Error("async boom");
      }),
    ).rejects.toThrow("async boom");
    finishTimings();
    expect(timings.ops.get("png.encode.pool")?.count).toBe(1);
  });

  it("stops recording once finished, so a later conversion starts clean", () => {
    const first = new Timings();
    beginTimings(first);
    timeOp("png.decode", () => 1);
    finishTimings();
    const second = new Timings();
    beginTimings(second);
    timeOp("png.decode", () => 1);
    finishTimings();
    expect(first.ops.get("png.decode")?.count).toBe(1);
    expect(second.ops.get("png.decode")?.count).toBe(1);
  });
});
