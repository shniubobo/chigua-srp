import type { Killmail } from "@/esi";
import marketGroups from "./marketGroups.json";
import types from "./types.json";

const DRIFTER_CHARACTER_IDS = [3019581, 3019582];

export interface ShipNames {
  en: string;
  zh?: string;
}

export function findMarketGroupId(name: string) {
  return Object.entries(marketGroups).find(
    ([_, marketGroup]) =>
      marketGroup.nameEn === name || marketGroup.nameZh === name,
  )?.[0];
}

export function isTypeInMarketGroups(typeId: number, marketGroupIds: number[]) {
  const type = types[typeId.toString()];
  if (type === undefined) return false; // Unknown type

  const typeMarketGroupId = type.marketGroup;
  if (typeMarketGroupId === undefined) return false; // Type has no group

  const typeMarketGroup = marketGroups[typeMarketGroupId];
  if (typeMarketGroup === undefined) return false; // Unknown group

  return marketGroupIds.some((marketGroupId) =>
    typeMarketGroup.ancestors.includes(marketGroupId),
  );
}

export function isDrifterKill(killmail: Killmail): boolean {
  return killmail.killmail.attackers.some((attacker) =>
    DRIFTER_CHARACTER_IDS.includes(attacker.character_id),
  );
}

export function isNpcKill(killmail: Killmail): boolean {
  return killmail.killmail.attackers.every(
    (attacker) =>
      attacker.character_id === undefined && attacker.faction_id !== undefined,
  );
}

export function getShipNames(typeId: number): ShipNames | null {
  const ship = types[typeId];
  if (ship === undefined) return null;
  return {
    en: ship.nameEn,
    zh: ship.nameZh,
  };
}
