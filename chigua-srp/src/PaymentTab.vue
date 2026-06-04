<template>
  <SrpTab>
    <template #body>
      <VxeTable
        border
        stripe
        size="medium"
        height="auto"
        auto-resize
        empty-text="无 KM 数据，请先拉取"
        :show-header="rows.length > 0"
        :loading="props.loading"
        :row-config="{ isHover: true, keyField: 'key' }"
        :data="rows"
        @cell-click="onCellClick"
      >
        <VxeColumn
          field="marked"
          title="标记"
          width="auto"
          align="center"
          class-name="cursor-pointer"
        >
          <template #default="{ row }">
            <div>
              {{ row.marked ? "✅" : "⬛" }}
            </div>
          </template>
        </VxeColumn>

        <VxeColumn
          field="payeeName"
          title="收款人"
          width="250"
          show-overflow="tooltip"
        >
          <template #default="{ row }">
            <div
              :class="
                row.marked ? 'text-neutral-400 line-through' : 'cursor-pointer'
              "
            >
              {{ row.payeeName }}
            </div>
          </template>
        </VxeColumn>

        <VxeColumn
          field="mIsk"
          title="金额"
          width="auto"
          align="right"
          header-align="left"
        >
          <template #default="{ row }">
            <div
              :class="
                row.marked ? 'text-neutral-400 line-through' : 'cursor-pointer'
              "
            >
              {{ row.mIsk }}m
            </div>
          </template>
        </VxeColumn>

        <VxeColumn field="reason" title="转账理由" min-width="auto">
          <template #default="{ row }">
            <div
              :class="
                row.marked ? 'text-neutral-400 line-through' : 'cursor-pointer'
              "
            >
              {{ row.reason }}
            </div>
          </template>
        </VxeColumn>
      </VxeTable>
    </template>
  </SrpTab>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { VxeColumn, VxeTable, VxeUI, type VxeTableEvents } from "vxe-table";

import { type Killmail } from "./esi";
import SrpTab from "./SrpTab.vue";
import {
  SrpKind,
  useSrpOutcomeStore,
  type SrpOutcomeApproveEntry,
  type SrpOutcomeApproveKey,
} from "./stores/srpOutcomeStore";

const PREFIX = "SRP: ";
const SUFFIX = " +";
const OVERHEAD = `${PREFIX}${SUFFIX}`.length;
const LIMIT = 40;
const DELIMITER = ", ";

const props = defineProps<{
  loading: boolean;
}>();

const rows = ref<Row[]>([]);
interface Row {
  key: string;
  payeeName: string;
  mIsk: number;
  reason: string;
  killmails: Killmail[];
  marked: boolean;
}

const srpOutcome = useSrpOutcomeStore();
watch(
  () => srpOutcome.srpOutcome,
  () => {
    rows.value = Array.from(
      (
        srpOutcome.srpOutcome
          .entries()
          .filter(
            ([_, value]) => value.kind === SrpKind.Approve,
          ) as IteratorObject<[SrpOutcomeApproveKey, SrpOutcomeApproveEntry]>
      ).map(([key, value]) => ({
        key,
        payeeName: value.payee.name,
        mIsk: value.mIsks.reduce((sum, current) => sum + current),
        reason: buildReason(value),
        killmails: value.killmails,
        marked: false,
      })),
    );
  },
  {
    deep: true,
    // This tab is lazily mounted. We need to trigger this watcher upon
    // mounting.
    immediate: true,
  },
);

function buildReason(srpOutcome: SrpOutcomeApproveEntry): string {
  let isSuffixNeeded = false;
  let nUnlistedKillmail = srpOutcome.killmails.length;
  let nListedCharacters = 0;
  const listedKillmails = [] as Killmail[];

  for (const killmail of srpOutcome.killmails) {
    const nAvailable =
      LIMIT - OVERHEAD - nListedCharacters - countCharacters(nUnlistedKillmail);
    let nNeeded = countCharacters(killmail.pointer.id);
    if (!isFirstKillmail(listedKillmails)) nNeeded += DELIMITER.length;

    if (nNeeded > nAvailable) {
      isSuffixNeeded = true;
      break;
    }

    listedKillmails.push(killmail);
    nListedCharacters += nNeeded;
    nUnlistedKillmail -= 1;
  }

  const killmailIds = listedKillmails
    .map((killmail) => killmail.pointer.id)
    .join(DELIMITER);
  let suffix = "";
  if (isSuffixNeeded) suffix = `${SUFFIX}${nUnlistedKillmail}`;
  return `${PREFIX}${killmailIds}${suffix}`;
}

function countCharacters(toCount: number): number {
  return Math.floor(Math.log10(toCount)) + 1;
}

function isFirstKillmail(killmails: Killmail[]): boolean {
  return killmails.length === 0;
}

const MILLION = 1_000_000;
const onCellClick: VxeTableEvents.CellClick<Row> = ({ row, column }) => {
  const field = column.field as keyof Omit<Row, "killmails">;
  let cellValue = row[field];

  if (field === "marked") {
    row.marked = !row.marked;
    return;
  }
  if (field === "mIsk") cellValue = (cellValue as number) * MILLION;

  if (row.marked) return;

  void navigator.clipboard.writeText(cellValue.toString());
  void VxeUI.modal.message({
    id: "copied",
    content: "已复制",
    status: "success",
  });
};
</script>
