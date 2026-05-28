import path from "node:path";
import { collectFilesByExtension, readJsonSafe } from "./core/fs.mjs";
import { mergeDeep } from "./core/object.mjs";

export { mergeDeep } from "./core/object.mjs";

export const loadRootGlobalData = ({ srcRoot, dataRoot }) => {
  const jsonFiles = collectFilesByExtension(dataRoot, new Set([".json"]));
  const merged = jsonFiles.reduce(
    (acc, filePath) => mergeDeep(acc, readJsonSafe(filePath) ?? {}),
    {},
  );
  return merged;
};
