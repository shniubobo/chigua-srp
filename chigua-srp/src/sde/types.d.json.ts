import { type MarketGroupId } from "./marketGroups.json";

export type TypeId = string;
export interface TypeValue {
  nameEn: string;
  nameZh?: string;
  marketGroup?: MarketGroupId;
}
export type Types = Record<TypeId, TypeValue>;

declare const data: Types;
export default data;
