/**
 * Turns parsed plugin-config hints into the {@link ConvertOptions} fields they
 * feed. Lives here rather than in each caller because the HTTP API and the web
 * worker both need it, and when it was duplicated the two drifted: the API kept
 * dropping `furnitureTransforms` and `pluginConfigZips`, which silently disabled
 * furniture scale correction and ModelEngine scanning for every API conversion.
 * One implementation means a new hint field reaches both callers.
 */

import type { ConfigHints } from "../java/configShared.js";
import type { ConvertOptions } from "./context.js";

/** The subset of {@link ConvertOptions} that plugin-config hints populate. */
export type HintOptions = Pick<
  ConvertOptions,
  | "baseItemHints"
  | "displayNameHints"
  | "equippableHints"
  | "cmdItemKeys"
  | "vanillaModelItems"
  | "colorHints"
  | "backpackItems"
  | "furnitureItems"
  | "furnitureTransforms"
  | "configZipProvided"
  | "pluginConfigZips"
>;

/**
 * Spread the hints parsed from config zips into an options object.
 *
 * `configZips` is kept raw alongside the parsed hints because the pipeline
 * scans the archives themselves for `.bbmodel` ModelEngine blueprints — the
 * hints only carry item-level data. The bytes are copied so a caller that later
 * transfers (neuters) the originals cannot leave the pipeline with empty zips,
 * matching what the web worker does with its postMessage transferables.
 */
export function optionsFromHints(hints: ConfigHints, configZips: Uint8Array[]): HintOptions {
  return {
    baseItemHints: hints.baseItems,
    displayNameHints: hints.displayNames,
    equippableHints: hints.equippables,
    cmdItemKeys: hints.cmdKeys,
    vanillaModelItems: hints.vanillaModelItems,
    colorHints: hints.colors,
    backpackItems: hints.backpacks,
    furnitureItems: hints.furniture,
    furnitureTransforms: hints.furnitureTransforms,
    configZipProvided: true,
    pluginConfigZips: configZips.map((z) => z.slice()),
  };
}
