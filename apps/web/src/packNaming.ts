/**
 * Names a conversion from the uploaded files.
 *
 * This is not cosmetic: `packagingStage` derives BOTH manifest UUIDs from the
 * pack name, and Bedrock keys installed packs by UUID. A constant name for
 * merged packs once gave every merge the same identity, so two different merged
 * packs overwrote each other on the client and a server could not ship both.
 * Kept as a pure function so that rule is testable without mounting React.
 */

/** Strip a known archive extension, so "MyPack.zip" is named "MyPack". */
export function stripArchiveExtension(name: string): string {
  return name.replace(/\.(zip|mcpack|tgz|tar\.gz)$/i, "");
}

/**
 * Derive the Bedrock pack name for a set of uploads.
 *
 * One file keeps its own name; several are joined as "Merged: a + b", which is
 * unique per input combination. Passing an empty list is a programming error
 * (the UI disables Convert until something is staged) and returns an empty
 * string rather than throwing, so a render path can never crash here.
 */
export function packNameFor(files: { name: string }[]): string {
  if (files.length === 0) return "";
  if (files.length === 1) return stripArchiveExtension(files[0]!.name);
  return `Merged: ${files.map((f) => stripArchiveExtension(f.name)).join(" + ")}`;
}

/** Short label describing the upload for progress text: the filename or a count. */
export function uploadLabelFor(files: { name: string }[]): string {
  if (files.length === 0) return "";
  return files.length === 1 ? files[0]!.name : `${files.length} packs`;
}

/** The original filenames, in merge-priority order, for the report's merge accounting. */
export function packNamesFor(files: { name: string }[]): string[] {
  return files.map((f) => f.name);
}
