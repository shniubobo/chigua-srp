import { ErrorMessage, throwOnStatus } from "./error";
import {
  buildEsiContext,
  fetchCharacter,
  getAccessTokenOrRefresh,
  type Character,
  type EsiContext,
  type Killmail,
} from "./esi";
import {
  getShipNames,
  isDrifterKill,
  isNpcKill,
  isTypeInMarketGroups,
} from "./sde";

const CHIGUA_CORP_IDS = [
  98524084, // Chi Gua
  98807825, // Chi Gua Auxiliary
];
const CHIGUA_FC_IDS = [
  2112612580, // Lvte Xiao
  2122946394, // Heite Xiao
  2113321478, // Nishikinomaki Ms
  2115444624, // Nine -L
];

const LOGISTICS = 437;
const LOGISTICS_FRIGATES = 2146;
const RECON_SHIPS = 824;
const COMMAND_DESTROYERS = 2125;
const INTERCEPTORS = 399;
const INTERDICTORS = 823;
const SHIPS = 4;

const AUTO_SRP_SHIP_TYPE_IDS = [
  626, // Vexor
  34317, // Confessor
  35683, // Hecate
];
const AUTO_SRP_MARKET_GROUP_IDS = [
  1370, // Navy Cruisers
  LOGISTICS_FRIGATES,
  INTERCEPTORS,
  1065, // Electronic Attack Frigates
  INTERDICTORS,
  COMMAND_DESTROYERS,
];
const BC_OR_GREATER_MARKET_GROUP_IDS = [
  1374, // Battlecruisers
  1376, // Battleships
  1381, // Capital Ships
  1698, // Special Edition Battlecruisers
  1620, // Special Edition Battleships
];
const SPECIAL_MODIFIERS = new Map([
  [LOGISTICS, 0.95],
  [LOGISTICS_FRIGATES, 0.95],
  [RECON_SHIPS, 0.95],
  [COMMAND_DESTROYERS, 0.95],
]);
const DEFAULT_MODIFIER = 0.85;
const FIXED_ISK_BASE = new Map([
  [INTERDICTORS, 60_000_000],
  [INTERCEPTORS, 30_000_000],
  [SHIPS, 15_000_000],
]);

export class Decision<T extends DecisionKind> {
  constructor(
    public readonly iskBase: IfApprove<T, number, null>,
    public readonly iskModifier: IfApprove<T, number, null>,
    public readonly needReview: boolean = false,
  ) {}

  public get mIskModified(): number | null {
    if (this.iskBase === null || this.iskModifier === null) {
      return null;
    }
    return Math.floor((this.iskBase * this.iskModifier) / 1_000_000);
  }
}

export type DecisionKind = Reject | Approve;
export type Reject = typeof _RejectSymbol;
export type Approve = typeof _ApproveSymbol;
declare const _RejectSymbol: unique symbol;
declare const _ApproveSymbol: unique symbol;

type IfApprove<TCond, TTrue, TFalse> = [TCond] extends [Approve]
  ? TTrue
  : [TCond] extends [Reject]
    ? TFalse
    : never;

export class DecisionContext {
  private constructor(
    public readonly victimName: string,
    public readonly victimIsChiGua: boolean,
    public readonly issuerName: string,
    public readonly issuerIsChiGuaFc: boolean,
    public readonly isShip: boolean,
    public readonly isNpcKill: boolean,
    public readonly isDrifterKill: boolean,
    public readonly isInAutoSrp: boolean,
    public readonly shipNameEn: string,
    // public readonly shipGroupNameEn: string,
    public readonly shipNameZh: string,
    // public readonly shipGroupNameZh?: string,
  ) {}

  public static async fetch(
    esi: EsiContext,
    killmail: Killmail,
  ): Promise<DecisionContext> {
    const victim = await fetchCharacter(
      esi,
      killmail.killmail.victim.character_id,
    );
    const victimName = victim.detail.name;
    const victimIsChiGua = isChiGua(victim);

    const issuerId = killmail.pointer.report.issuerId;
    let issuerName = "";
    let issuerIsChiGuaFc = false;
    if (issuerId) {
      const issuer = await fetchCharacter(esi, issuerId);
      issuerName = issuer.detail.name;
      issuerIsChiGuaFc = isChiGuaFc(issuer);
    }

    const isShip_ = isShip(killmail);
    const isNpcKill_ = isNpcKill(killmail);
    const isDrifterKill_ = isDrifterKill(killmail);
    const isInAutoSrp_ = isInAutoSrp(killmail);

    const shipTypeId = killmail.killmail.victim.ship_type_id;
    const shipNames = getShipNames(shipTypeId);
    let shipNameEn = "";
    let shipNameZh = "";
    if (shipNames) {
      shipNameEn = shipNames.en;
      if (shipNames.zh) shipNameZh = shipNames.zh;
    }

    return new this(
      victimName,
      victimIsChiGua,
      issuerName,
      issuerIsChiGuaFc,
      isShip_,
      isNpcKill_,
      isDrifterKill_,
      isInAutoSrp_,
      shipNameEn,
      shipNameZh,
    );
  }
}

type PriceHistory = Map<string, number>;
class ZKillBoard {
  private static cache: Map<number, PriceHistory> = new Map();
  private static readonly PRICE_API_BASE = new URL(
    "https://zkillboard.com/api/prices/",
  );

  public static async fetchPrice(typeId: number, date: Date): Promise<number> {
    const priceHistory = await this.fetchPriceHistory(typeId);
    const dateString = this.toDateString(date);
    return priceHistory.get(dateString) ?? priceHistory.get("currentPrice")!;
  }

  private static async fetchPriceHistory(
    typeId: number,
  ): Promise<PriceHistory> {
    return navigator.locks.request("fetch-price-history", async () => {
      if (!this.needUpdate(typeId)) return this.cache.get(typeId)!;
      return this.updatePriceHistory(typeId);
    });
  }

  private static needUpdate(typeId: number): boolean {
    const yesterday = new Date();
    const today = new Date();
    yesterday.setUTCDate(today.getUTCDate() - 1);
    const upToDate =
      this.cache.get(typeId)?.has(this.toDateString(yesterday)) ?? false;
    return !upToDate;
  }

  private static async updatePriceHistory(
    typeId: number,
  ): Promise<PriceHistory> {
    const resp = await fetch(new URL(`${typeId}/`, this.PRICE_API_BASE));
    throwOnStatus(resp.status);

    const priceHistoryRaw = (await resp.json()) as unknown;
    const priceHistory = this.validatePriceHistory(priceHistoryRaw);

    this.cache.set(typeId, priceHistory);
    return priceHistory;
  }

  private static validatePriceHistory(priceHistoryRaw: unknown): PriceHistory {
    const priceHistory: PriceHistory = new Map();

    this.assertObject(priceHistoryRaw);
    for (const [dateString, price] of Object.entries(priceHistoryRaw)) {
      if (dateString === "typeID") {
        // Why is zkb's author hiding all these shit inside that
        // mountain of prices? 😅
        continue;
      }

      if (dateString === "currentPrice") {
        try {
          this.assertString(price);
          priceHistory.set(dateString, parseFloat(price));
        } catch {
          // WTF couldn't you just be consistent with the type?
          this.assertNumber(price);
          priceHistory.set(dateString, price);
        }

        continue;
      }

      const date = new Date(dateString);
      if (isNaN(date.valueOf()))
        throw new Error(ErrorMessage.MalformedPriceHistory, {
          cause: priceHistoryRaw,
        });
      this.assertNumber(price);

      priceHistory.set(dateString, price);
    }

    return priceHistory;
  }

  private static assertObject(obj: unknown): asserts obj is object {
    if (typeof obj !== "object" || Array.isArray(obj) || obj === null)
      throw new Error(ErrorMessage.MalformedPriceHistory);
  }

  private static assertNumber(obj: unknown): asserts obj is number {
    if (typeof obj !== "number")
      throw new Error(ErrorMessage.MalformedPriceHistory);
  }

  private static assertString(obj: unknown): asserts obj is string {
    if (typeof obj !== "string")
      throw new Error(ErrorMessage.MalformedPriceHistory);
  }

  private static toDateString(date: Date): string {
    return date.toISOString().split("T")[0]!;
  }
}

export type SrpData = Map<string, SrpDataEntry>;
export interface SrpDataEntry {
  killmail: Killmail;
  decision: Decision<DecisionKind>;
  decisionContext: DecisionContext;
}

export type Reviews = Map<string, ReviewEntry>;
export interface ReviewEntry {
  approve: boolean;
  reject: boolean;
}

export async function buildSrpData(killmails: Killmail[]): Promise<SrpData> {
  const decisionPromises = killmails.map((killmail) => makeDecision(killmail));
  const decisions = await Promise.all(decisionPromises);

  return new Map(
    killmails.map((killmail, idx) => [
      formatId(killmail),
      {
        killmail,
        decision: decisions[idx]![0],
        decisionContext: decisions[idx]![1],
      },
    ]),
  );
}

function formatId(killmail: Killmail): string {
  const id = killmail.killmail.killmail_id;
  const date = killmail.pointer.report.date?.toJSON() ?? "";
  return `${id}-${date}`;
}

async function makeDecision(
  killmail: Killmail,
): Promise<[Decision<DecisionKind>, DecisionContext]> {
  const accessToken = await getAccessTokenOrRefresh();
  if (accessToken === null) throw new Error(ErrorMessage.NotLoggedIn);
  const esi = await buildEsiContext(accessToken);
  const context = await DecisionContext.fetch(esi, killmail);

  if (!context.isShip) {
    return [new Decision<Reject>(null, null), context];
  }

  if (context.victimIsChiGua) {
    if (context.isNpcKill && !context.isDrifterKill)
      return [new Decision<Reject>(null, null), context];
    if (context.isInAutoSrp && !context.isNpcKill && !context.isDrifterKill)
      return [new Decision<Reject>(null, null), context];

    return [
      new Decision<Approve>(
        await fetchIskBase(killmail),
        getModifier(killmail),
        isBcOrGreater(killmail),
      ),
      context,
    ];
  }

  if (!context.issuerIsChiGuaFc)
    return [new Decision<Reject>(null, null), context];
  if (context.isNpcKill && !context.isDrifterKill)
    return [new Decision<Reject>(null, null), context];

  const modifier = getModifier(killmail);
  if (modifier !== DEFAULT_MODIFIER) {
    return [
      new Decision<Approve>(
        await fetchIskBase(killmail),
        modifier,
        isBcOrGreater(killmail),
      ),
      context,
    ];
  }
  return [
    new Decision<Approve>(
      getFixedIskBase(killmail),
      1,
      isBcOrGreater(killmail),
    ),
    context,
  ];
}

function isShip(killmail: Killmail): boolean {
  const victimTypeId = killmail.killmail.victim.ship_type_id;
  return isTypeInMarketGroups(victimTypeId, [SHIPS]);
}

function isChiGua(character: Character): boolean {
  return CHIGUA_CORP_IDS.includes(character.detail.corporation_id);
}

function isChiGuaFc(character: Character): boolean {
  return CHIGUA_FC_IDS.includes(character.id);
}

function isInAutoSrp(killmail: Killmail): boolean {
  const victimShipId = killmail.killmail.victim.ship_type_id;
  return (
    AUTO_SRP_SHIP_TYPE_IDS.includes(victimShipId) ||
    isTypeInMarketGroups(victimShipId, AUTO_SRP_MARKET_GROUP_IDS)
  );
}

function isBcOrGreater(killmail: Killmail): boolean {
  return isTypeInMarketGroups(
    killmail.killmail.victim.ship_type_id,
    BC_OR_GREATER_MARKET_GROUP_IDS,
  );
}

async function fetchIskBase(killmail: Killmail): Promise<number> {
  const shipTypeId = killmail.killmail.victim.ship_type_id;
  const killDate = new Date(killmail.killmail.killmail_time);
  return await ZKillBoard.fetchPrice(shipTypeId, killDate);
}

function getModifier(killmail: Killmail): number {
  const shipTypeId = killmail.killmail.victim.ship_type_id;
  const specialModifier = SPECIAL_MODIFIERS.entries().find(
    ([marketGroupId, _]) => isTypeInMarketGroups(shipTypeId, [marketGroupId]),
  )?.[1];
  return specialModifier ?? DEFAULT_MODIFIER;
}

function getFixedIskBase(killmail: Killmail): number {
  const shipTypeId = killmail.killmail.victim.ship_type_id;
  return FIXED_ISK_BASE.entries().find(([marketGroupId, _]) =>
    isTypeInMarketGroups(shipTypeId, [marketGroupId]),
  )?.[1] as number; // We should always be able to find one
}

export interface SrpPayee {
  id: number;
  name: string;
}

export function getSrpPayee(srpDataEntry: SrpDataEntry): SrpPayee {
  const { killmail, decisionContext: context } = srpDataEntry;
  return {
    id: context.victimIsChiGua
      ? (killmail.pointer.report.issuerId ?? 0)
      : killmail.killmail.victim.character_id,
    name: context.victimIsChiGua ? context.issuerName : context.victimName,
  };
}
