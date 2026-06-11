<template>
  <SrpTab>
    <template #header-left>
      <VxeButton status="primary" :loading="props.loading" @click="onExport()"
        >导出</VxeButton
      >
    </template>

    <template #body>
      <VxeTable
        ref="table"
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
      >
        <VxeColumn
          field="payeeName"
          title="payee_name"
          min-width="auto"
          show-overflow="tooltip"
          cell-type="string"
        ></VxeColumn>

        <VxeColumn
          field="isChiGua"
          title="is_chi_gua"
          min-width="auto"
          show-overflow="tooltip"
          cell-type="string"
        ></VxeColumn>

        <VxeColumn
          field="shipNameEn"
          title="ship_name_en"
          min-width="auto"
          show-overflow="tooltip"
          cell-type="string"
        ></VxeColumn>

        <VxeColumn
          field="shipNameZh"
          title="ship_name_zh"
          min-width="auto"
          show-overflow="tooltip"
          cell-type="string"
        ></VxeColumn>

        <VxeColumn
          field="mIsk"
          title="m_isk"
          min-width="auto"
          show-overflow="tooltip"
          cell-type="number"
        ></VxeColumn>
      </VxeTable>
    </template>
  </SrpTab>
</template>

<script setup lang="ts">
import { ref, useTemplateRef, watch } from "vue";
import { VxeButton } from "vxe-pc-ui";
import { VxeColumn, VxeTable } from "vxe-table";
import { toDateString } from "xe-utils";

import { type Killmail } from "./esi.ts";
import SrpTab from "./SrpTab.vue";
import { SrpKind, useSrpOutcomeStore } from "./stores/srpOutcomeStore";

const props = defineProps<{
  loading: boolean;
}>();

const rows = ref<Row[]>([]);
interface Row {
  key: string;
  payeeName: string;
  isChiGua: boolean;
  shipNameEn: string;
  shipNameZh: string;
  mIsk: number;
}

const srpOutcome = useSrpOutcomeStore();
watch(
  () => srpOutcome.srpOutcome,
  () => {
    rows.value = Array.from(
      srpOutcome.srpOutcome
        .values()
        .filter((value) => value.kind === SrpKind.Approve)
        .flatMap((value) =>
          value.killmails.map((killmail, i) => ({
            key: buildRowKey(killmail),
            payeeName: value.payee.name,
            isChiGua: value.contexts[i]!.victimIsChiGua,
            shipNameEn: value.contexts[i]!.shipNameEn,
            shipNameZh: value.contexts[i]!.shipNameZh,
            mIsk: value.mIsks[i]!,
          })),
        ),
    );
  },
  { deep: true, immediate: true },
);

function buildRowKey(killmail: Killmail): string {
  const id = killmail.pointer.id;
  const date = killmail.pointer.report.date?.valueOf() ?? 0;
  return `${id}-${date}`;
}

const table = useTemplateRef("table");

function onExport() {
  if (table.value === null) return;
  const date = toDateString(new Date(), "yyyyMMdd-HHmmss");
  const filename = `chigua-srp-${date}`;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  table.value.exportData({ type: "csv", filename });
}
</script>
