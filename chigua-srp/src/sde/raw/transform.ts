// To run:
// pnpm tsc transform.ts --ignoreConfig --types node
// node transform.js

import fs from "fs";
import readline from "readline";

import { Convert as ConvertMarketGroup } from "./marketGroups.js";
import { Convert as ConvertType } from "./types.js";

export type MarketGroupId = number;
export interface MarketGroupValue {
  nameEn: string;
  nameZh?: string;
  parent?: MarketGroupId;
  ancestors: Set<MarketGroupId>;
}
export type MarketGroups = Map<MarketGroupId, MarketGroupValue>;

export type TypeId = number;
export interface TypeValue {
  nameEn: string;
  nameZh?: string;
  marketGroup?: MarketGroupId;
}
export type Types = Map<TypeId, TypeValue>;

async function* readJsonl<T>(
  path: fs.PathLike,
  deserializer: (json: string) => T,
) {
  const stream = fs.createReadStream(path);
  const lines = readline.createInterface(stream);
  for await (const line of lines) {
    yield deserializer(line);
  }
}

// #region Market Group

// Read in everything
const marketGroups: MarketGroups = new Map();
for await (const marketGroupRaw of readJsonl("./marketGroups.jsonl", (json) =>
  ConvertMarketGroup.toMarketGroup(json),
)) {
  const marketGroupValue: MarketGroupValue = {
    nameEn: marketGroupRaw.name.en,
    nameZh: marketGroupRaw.name.zh,
    parent: marketGroupRaw.parentGroupID,
    // Make a group its own ancestor, so that when checking if a type
    // belongs to a group, we don't have to special-case the type's
    // direct group.
    ancestors: new Set([marketGroupRaw._key]),
  };
  marketGroups.set(marketGroupRaw._key, marketGroupValue);
}

// Assign non-parent ancestors
for (const [id, marketGroup] of marketGroups) {
  let cursor = marketGroup.parent;
  while (true) {
    if (cursor === undefined) break;
    marketGroup.ancestors.add(cursor);
    cursor = marketGroups.get(cursor)?.parent;
  }
  marketGroups.set(id, marketGroup);
}

// Filter out non-ship groups
const lcaId = marketGroups
  .entries()
  .find(([_, marketGroup]) => marketGroup.nameEn === "Ships")?.[0];
if (lcaId === undefined) throw new Error("LCA of ships not found.");
for (const [id, marketGroup] of marketGroups) {
  if (!marketGroup.ancestors.has(lcaId)) marketGroups.delete(id);
}

// Serialize
const jsonMarketGroups = JSON.stringify(
  Object.fromEntries(marketGroups),
  (k, v) => {
    if (k === "parent") return undefined;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    if (v instanceof Set) return [...v];
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return v;
  },
  2,
);
fs.writeFileSync("../marketGroups.json", `${jsonMarketGroups}\n`, {
  encoding: "utf8",
});

// #endregion

// #region Type

// Read in everything
const types: Types = new Map();
for await (const typeRaw of readJsonl("./types.jsonl", (json) =>
  ConvertType.toType(json),
)) {
  types.set(typeRaw._key, {
    nameEn: typeRaw.name.en,
    nameZh: typeRaw.name.zh,
    marketGroup: typeRaw.marketGroupID,
  });
}

// Filter out non-ship types
for (const [id, type] of types.entries()) {
  if (
    type.marketGroup === undefined ||
    !marketGroups.get(type.marketGroup)?.ancestors.has(lcaId)
  )
    types.delete(id);
}

// Serialize
const jsonTypes = JSON.stringify(Object.fromEntries(types), undefined, 2);
fs.writeFileSync("../types.json", `${jsonTypes}\n`, { encoding: "utf8" });

// #endregion
