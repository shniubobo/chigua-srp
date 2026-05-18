import { defineStore } from "pinia";
import { computed, ref } from "vue";

import { ErrorMessage } from "@/error";
import type { Killmail } from "@/esi";
import {
  getSrpPayee,
  type ReviewEntry,
  type Reviews,
  type SrpData,
  type SrpDataEntry,
  type SrpPayee,
} from "@/srp";

export const enum SrpKind {
  Reject = "拒绝",
  Approve = "通过",
  AwaitingReview = "等待审核",
}

export type SrpOutcome = Map<SrpOutcomeKey, SrpOutcomeEntry>;
export type SrpOutcomeKey =
  | SrpOutcomeApproveKey
  | SrpOutcomeRejectKey
  | SrpOutcomeAwaitingReviewKey;
export type SrpOutcomeEntry =
  | SrpOutcomeApproveEntry
  | SrpOutcomeRejectEntry
  | SrpOutcomeAwaitingReviewEntry;

type SrpOutcomeKeyPrefix = `${PayeeId}-`;
type SrpOutcomeKeyPostfix = `-${KillmailId}-${ReportDate}`;
type PayeeId = number;
type KillmailId = number;
type ReportDate = number;

interface SrpOutcomeCommonEntry {
  payee: SrpPayee;
  note: string;
}

type SrpOutcomeApproveKey = `${SrpOutcomeKeyPrefix}${SrpKind.Approve}`;
interface SrpOutcomeApproveEntry extends SrpOutcomeCommonEntry {
  kind: SrpKind.Approve;
  killmails: Killmail[];
  mIsks: number[];
}

type SrpOutcomeRejectKey =
  `${SrpOutcomeKeyPrefix}${SrpKind.Reject}${SrpOutcomeKeyPostfix}`;
interface SrpOutcomeRejectEntry extends SrpOutcomeCommonEntry {
  kind: SrpKind.Reject;
  killmail: Killmail;
}

type SrpOutcomeAwaitingReviewKey =
  `${SrpOutcomeKeyPrefix}${SrpKind.AwaitingReview}${SrpOutcomeKeyPostfix}`;
interface SrpOutcomeAwaitingReviewEntry extends SrpOutcomeCommonEntry {
  kind: SrpKind.AwaitingReview;
  killmail: Killmail;
}

export const useSrpOutcomeStore = defineStore("srpOutcome", () => {
  const inner = useSrpOutcomeStoreInner();

  // This re-construct the entire `SrpOutcome` whenever `inner` changes, which
  // is kind of awkward. We could instead store an `SrpOutcome` in `inner`, and
  // patch it when this store is updated. However, that would require more
  // complex logic, and there is not enough evidence that the current
  // performance overhead is so significant that optimization is a must.
  // Therefore, we will keep the current implementation, until optimization
  // proves to be necessary.
  const srpOutcome = computed<SrpOutcome>(() => {
    const outcome = new Map() as SrpOutcome;

    for (const dataKey of inner.srpData.keys()) {
      const dataEntry = inner.srpData.get(dataKey)!;
      const review = inner.reviews.get(dataKey)!;

      const kind = getSrpKind(dataEntry, review);
      const outcomeKey = buildOutcomeKey(dataEntry, kind);
      const payee = getSrpPayee(dataEntry);
      const note = inner.notes.get(outcomeKey) ?? "";

      let outcomeEntry: SrpOutcomeEntry;
      if (kind === SrpKind.Approve) {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
        outcomeEntry = outcome.getOrInsertComputed(outcomeKey, () => ({
          kind,
          payee,
          killmails: [],
          mIsks: [],
          note,
        })) as SrpOutcomeApproveEntry;
        outcomeEntry.killmails.push(dataEntry.killmail);
        outcomeEntry.mIsks.push(dataEntry.decision.mIskModified!);
      } else {
        outcomeEntry = {
          kind,
          payee,
          killmail: dataEntry.killmail,
          note,
        };
      }

      outcome.set(outcomeKey, outcomeEntry);
    }

    return outcome;
  });

  const srpData = computed(() => inner.srpData);

  function putSrpData(srpData: SrpData) {
    inner.srpData = srpData;
    inner.reviews = new Map();
    inner.notes = new Map();

    inner.reviews = new Map(
      srpData.keys().map((key) => [key, { approve: false, reject: false }]),
    );
  }

  function getReview(dataKey: string): ReviewEntry | undefined {
    return inner.reviews.get(dataKey);
  }

  function setReview(dataKey: string, review: ReviewEntry) {
    if (inner.reviews.get(dataKey) === undefined)
      throw new Error(ErrorMessage.SrpDataKeyNotFound);
    inner.reviews.set(dataKey, review);
  }

  function updateNote(dataKey: string, note: string) {
    const dataEntry = inner.srpData.get(dataKey)!;
    const review = inner.reviews.get(dataKey)!;
    const kind = getSrpKind(dataEntry, review);

    const outcomeKey = buildOutcomeKey(inner.srpData.get(dataKey)!, kind);
    inner.notes.set(outcomeKey, note);
  }

  return {
    srpOutcome,
    srpData,
    putSrpData,
    getReview,
    setReview,
    updateNote,
  };
});

const useSrpOutcomeStoreInner = defineStore("srpOutcomeInner", () => {
  const srpData = ref<SrpData>(new Map());
  const reviews = ref<Reviews>(new Map());
  const notes = ref<Map<SrpOutcomeKey, string>>(new Map());

  return { srpData, reviews, notes };
});

function getSrpKind(srpData: SrpDataEntry, review?: ReviewEntry): SrpKind {
  if (review?.reject) return SrpKind.Reject;
  if (review?.approve) return SrpKind.Approve;
  if (srpData.decision.needReview) return SrpKind.AwaitingReview;

  if (srpData.decision.mIskModified === null) return SrpKind.Reject;
  return SrpKind.Approve;
}

function buildOutcomeKey(srpData: SrpDataEntry, kind: SrpKind): SrpOutcomeKey {
  const payeeId = getSrpPayee(srpData).id;
  if (kind === SrpKind.Approve) return `${payeeId}-${kind}`;
  const killmailId = srpData.killmail.pointer.id;
  const reportDate = srpData.killmail.pointer.report.date?.valueOf() ?? 0;
  return `${payeeId}-${kind}-${killmailId}-${reportDate}`;
}
