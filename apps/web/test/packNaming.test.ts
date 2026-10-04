import { describe, expect, it } from "vitest";
import { packNameFor, packNamesFor, stripArchiveExtension, uploadLabelFor } from "../src/packNaming.js";

const f = (name: string) => ({ name });

describe("stripArchiveExtension", () => {
  it("removes the archive extensions an upload can carry", () => {
    expect(stripArchiveExtension("MyPack.zip")).toBe("MyPack");
    expect(stripArchiveExtension("MyPack.mcpack")).toBe("MyPack");
    expect(stripArchiveExtension("MyPack.tgz")).toBe("MyPack");
    // .tar.gz must match as a whole — stripping only ".gz" would leave ".tar".
    expect(stripArchiveExtension("MyPack.tar.gz")).toBe("MyPack");
  });

  it("is case-insensitive, because uploads from Windows are often capitalised", () => {
    expect(stripArchiveExtension("MyPack.ZIP")).toBe("MyPack");
    expect(stripArchiveExtension("MyPack.McPack")).toBe("MyPack");
    expect(stripArchiveExtension("MyPack.TAR.GZ")).toBe("MyPack");
  });

  it("leaves a name with no known extension alone", () => {
    expect(stripArchiveExtension("MyPack")).toBe("MyPack");
    expect(stripArchiveExtension("my.pack.v2")).toBe("my.pack.v2");
    // Only the LAST extension is stripped, and only if it is one we know.
    expect(stripArchiveExtension("Backup.zip.old")).toBe("Backup.zip.old");
  });
});

describe("packNameFor", () => {
  it("keeps a single upload's own name", () => {
    expect(packNameFor([f("Ruby Pack.zip")])).toBe("Ruby Pack");
  });

  it("names a merge after every input, so two merges never share an identity", () => {
    // The load-bearing property: packagingStage derives both manifest UUIDs from
    // this string, and Bedrock keys installed packs by UUID. A constant name
    // would make two different merged packs overwrite each other on the client.
    expect(packNameFor([f("A.zip"), f("B.zip")])).toBe("Merged: A + B");
    expect(packNameFor([f("A.zip"), f("C.zip")])).not.toBe(packNameFor([f("A.zip"), f("B.zip")]));
  });

  it("is order-sensitive, matching merge priority (first wins)", () => {
    expect(packNameFor([f("A.zip"), f("B.zip")])).not.toBe(packNameFor([f("B.zip"), f("A.zip")]));
  });

  it("distinguishes the same files uploaded in different sets", () => {
    const a = packNameFor([f("A.zip"), f("B.zip")]);
    const b = packNameFor([f("A.zip"), f("B.zip"), f("C.zip")]);
    expect(a).not.toBe(b);
    expect(b).toBe("Merged: A + B + C");
  });

  it("returns an empty string for no files rather than throwing", () => {
    // The UI disables Convert until something is staged, so this is a
    // programming-error path that must not crash a render.
    expect(packNameFor([])).toBe("");
  });

  it("tolerates names that are only an extension", () => {
    expect(packNameFor([f(".zip")])).toBe("");
    expect(packNameFor([f(".zip"), f("B.zip")])).toBe("Merged:  + B");
  });
});

describe("uploadLabelFor", () => {
  it("shows the filename for one upload and a count for a merge", () => {
    expect(uploadLabelFor([f("Ruby Pack.zip")])).toBe("Ruby Pack.zip");
    expect(uploadLabelFor([f("A.zip"), f("B.zip")])).toBe("2 packs");
    expect(uploadLabelFor([f("A.zip"), f("B.zip"), f("C.zip")])).toBe("3 packs");
  });

  it("keeps the extension in the label, unlike the pack name", () => {
    expect(uploadLabelFor([f("Pack.zip")])).toBe("Pack.zip");
  });

  it("returns an empty string for no files", () => {
    expect(uploadLabelFor([])).toBe("");
  });
});

describe("packNamesFor", () => {
  it("returns every filename in order, for the merge accounting report", () => {
    expect(packNamesFor([f("A.zip"), f("B.zip")])).toEqual(["A.zip", "B.zip"]);
    expect(packNamesFor([f("B.zip"), f("A.zip")])).toEqual(["B.zip", "A.zip"]);
    expect(packNamesFor([])).toEqual([]);
  });

  it("keeps extensions, since the report names the actual uploads", () => {
    expect(packNamesFor([f("Ruby Pack.zip")])).toEqual(["Ruby Pack.zip"]);
  });
});
