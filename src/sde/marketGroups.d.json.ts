export type MarketGroupId = number;
export interface MarketGroupValue {
  nameEn: string;
  nameZh?: string;
  ancestors: MarketGroupId[];
}
export type MarketGroups = Record<string, MarketGroupValue>;

declare const data: MarketGroups;
export default data;
