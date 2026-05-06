<script setup lang="ts">
import { computed, reactive, useTemplateRef } from "vue";
import { VxeButton, VxeTag } from "vxe-pc-ui";
import {
  VxeColumn,
  VxeTable,
  type VxeTableInstance,
  type VxeTablePropTypes,
} from "vxe-table";
import { getSrpPayee, type Reviews, type SrpData, type SrpPayee } from "./srp";

interface Row {
  id: string;
  victimName: string;
  issuerName: string;
  killTime: Date;
  reportTime?: Date;
  mailSubject?: string;
  mailBody?: string;
  tags: Tags;
  shipName: ShipName;
  shipPrice: number | null;
  srpModifier: number | null;
  srpPrice: number | null;
  killmailId: number;
  srpPayee: SrpPayee;
}

interface Tags {
  victimIsChiGua: boolean;
  issuerIsChiGuaFc: boolean;
  isNpcKill: boolean;
  isDrifterKill: boolean;
  isInAutoSrp: boolean;
  needReview: boolean;
}

interface ShipName {
  en: string;
  zh: string;
}

const props = defineProps<{
  loading: boolean;
  srpData: SrpData;
}>();

const reviews = defineModel<Reviews>("reviews", { required: true });

const rows = computed<Row[]>(() =>
  Array.from(
    props.srpData
      .entries()
      .map(([id, { killmail, decision, decisionContext: context }]) => ({
        id: id,
        victimName: context.victimName,
        issuerName: context.issuerName,
        killTime: new Date(killmail.killmail.killmail_time),
        reportTime: killmail.pointer.report.date,
        mailSubject: killmail.pointer.report.subject,
        mailBody: killmail.pointer.report.bodyPlainText,
        tags: {
          victimIsChiGua: context.victimIsChiGua,
          issuerIsChiGuaFc: context.issuerIsChiGuaFc,
          isShip: context.isShip,
          isNpcKill: context.isNpcKill,
          isDrifterKill: context.isDrifterKill,
          isInAutoSrp: context.isInAutoSrp,
          needReview: decision.needReview,
        },
        shipName: { en: context.shipNameEn, zh: context.shipNameZh },
        shipPrice: decision.iskBase,
        srpModifier: decision.iskModifier,
        srpPrice: decision.mIskModified,
        killmailId: killmail.killmail.killmail_id,
        srpPayee: getSrpPayee({ killmail, decision, decisionContext: context }),
      })),
  ),
);

const table = useTemplateRef<VxeTableInstance>("table");

async function onDataRendered() {
  await table.value?.setAllRowGroupExpand(true);
}

const spanMethod: VxeTablePropTypes.SpanMethod<Row> = ({ row, column }) => {
  if (table.value?.isAggregateRecord(row)) {
    if (column.field === "srpPayee")
      return { rowspan: 1, colspan: table.value.getColumns().length - 2 };
    if (["补损金额", "操作"].includes(column.title.toString()))
      return { rowspan: 1, colspan: 1 };
    return { rowspan: 0, colspan: 0 };
  }
  return { rowspan: 1, colspan: 1 };
};

const aggregateConfig = reactive<VxeTablePropTypes.AggregateConfig<Row>>({
  groupFields: ["srpPayee.name"],
  expandAll: true,
  showIcon: false,
  calcValuesMethod: ({ column, children }) => {
    if (column.field === "srpPrice")
      return children
        .filter(
          (child) =>
            !isAwaitingReview(child) &&
            !isManuallyRejected(child) &&
            child.srpPrice !== null,
        )
        .map((child) => child.srpPrice!)
        .reduce((accumulator, currentValue) => accumulator + currentValue, 0);
    return 0;
  },
});

function formatDateEt(
  date: Date | undefined,
  fallback: string = "未知",
): string {
  if (date === undefined) return fallback;
  const jsonString = date.toJSON();
  const matches = /^(?<date>[\d-]{10})T(?<time>[\d:]{8})/.exec(jsonString);
  if (matches === null) return fallback;
  return `${matches.groups!.date} ${matches.groups!.time}`;
}

function formatSrpPrice(row: Row): string {
  if (isAwaitingReview(row)) return "等待审核";
  if (isManuallyRejected(row) || row.srpPrice === null) return "拒绝补损";
  return `${row.srpPrice}m`;
}

function isAwaitingReview(row: Row): boolean {
  return (
    row.tags.needReview && !isManuallyApproved(row) && !isManuallyRejected(row)
  );
}

function isManuallyApproved(row: Row): boolean {
  return reviews.value.get(row.id)?.approve ?? false;
}

function isManuallyRejected(row: Row): boolean {
  return reviews.value.get(row.id)?.reject ?? false;
}

const ZKB_BASE_URL = new URL("https://zkillboard.com/kill/");
function redirectZkb(killId: number) {
  const url = new URL(`${killId}/`, ZKB_BASE_URL);
  open(url, "_blank", "noreferrer");
}

function needManualApprove(row: Row): boolean {
  if (isManuallyRejected(row)) return true;
  return row.tags.needReview && !isManuallyApproved(row);
}

function canManualReject(row: Row): boolean {
  return !isManuallyRejected(row) && row.srpPrice !== null;
}

async function onManualApprove(row: Row) {
  const entry = reviews.value.get(row.id)!;
  if (row.tags.needReview) entry.approve = true;
  entry.reject = false;
  reviews.value.set(row.id, entry);

  await table.value?.refreshAggregateCalcValues();
}

async function onManualReject(row: Row) {
  const entry = reviews.value.get(row.id)!;
  entry.reject = true;
  entry.approve = false;
  reviews.value.set(row.id, entry);

  await table.value?.refreshAggregateCalcValues();
}
</script>

<template>
  <VxeTable
    ref="table"
    border
    stripe
    size="medium"
    height="auto"
    auto-resize
    empty-text="无 KM 数据，请先拉取"
    :loading="props.loading"
    :show-header="srpData.size > 0"
    :row-config="{ isHover: true, keyField: 'id' }"
    :data="rows"
    :span-method="spanMethod"
    :aggregate-config="aggregateConfig"
    @data-rendered="onDataRendered()"
  >
    <VxeColumn
      field="srpPayee"
      title="收款人"
      width="150"
      fixed="left"
      row-group-node
    >
      <template #groupContent="{ groupContent }">
        {{ groupContent }}
      </template>
      <template #default></template>
    </VxeColumn>

    <VxeColumn
      field="victimName"
      title="损船人"
      width="150"
      show-overflow="tooltip"
    ></VxeColumn>

    <VxeColumn
      field="issuerName"
      title="报损人"
      width="150"
      show-overflow="tooltip"
    ></VxeColumn>

    <VxeColumn
      field="killTime"
      title="KM 时间"
      width="auto"
      :formatter="({ cellValue }) => formatDateEt(cellValue)"
    ></VxeColumn>

    <VxeColumn
      field="reportTime"
      title="邮件时间"
      width="auto"
      :formatter="({ cellValue }) => formatDateEt(cellValue)"
    ></VxeColumn>

    <VxeColumn
      field="mailSubject"
      title="邮件标题"
      width="auto"
      show-overflow="tooltip"
    ></VxeColumn>

    <VxeColumn
      field="mailBody"
      title="邮件正文"
      width="350"
      show-overflow="tooltip"
    ></VxeColumn>

    <VxeColumn
      field="shipName"
      title="船体"
      show-overflow="tooltip"
      width="250"
      :formatter="({ cellValue: { en, zh } }) => (en ? `${en} ${zh}` : '未知')"
    ></VxeColumn>

    <VxeColumn title="标签" min-width="auto">
      <template #default="{ row }">
        <VxeTag v-if="!row.tags.victimIsChiGua" status="info">非吃瓜</VxeTag>
        <VxeTag
          v-if="!row.tags.victimIsChiGua && !row.tags.issuerIsChiGuaFc"
          status="error"
          >非 FC 转发</VxeTag
        >
        <VxeTag v-if="!row.tags.isShip" status="error">非船损</VxeTag>
        <VxeTag v-if="row.tags.isNpcKill" status="error">怪损</VxeTag>
        <VxeTag v-if="row.tags.isDrifterKill" status="info">流浪爹损</VxeTag>
        <VxeTag
          v-if="row.tags.isInAutoSrp && row.tags.victimIsChiGua"
          status="error"
          >自动补损</VxeTag
        >
        <VxeTag v-if="row.tags.needReview" status="warning">需人工复核</VxeTag>
        <VxeTag v-if="isManuallyApproved(row)" status="primary"
          >人工通过</VxeTag
        >
        <VxeTag v-if="isManuallyRejected(row)" status="error">人工拒绝</VxeTag>
      </template>
    </VxeColumn>

    <VxeColumn
      field="shipPrice"
      title="船体价格"
      width="auto"
      align="right"
      header-align="left"
      :cell-render="{
        name: 'FormatNumberInput',
        props: { type: 'amount', align: 'right', digits: 0 },
      }"
    ></VxeColumn>

    <VxeColumn
      field="srpModifier"
      title="补损倍率"
      width="auto"
      align="right"
      header-align="left"
      :formatter="
        ({ cellValue }) => {
          if (cellValue === 1) return '固定金额';
          if (cellValue === null) return '';
          return `${cellValue * 100}%`;
        }
      "
    ></VxeColumn>

    <VxeColumn
      field="srpPrice"
      title="补损金额"
      width="auto"
      align="right"
      header-align="right"
      fixed="right"
      agg-func
    >
      <template #default="{ row }">{{ formatSrpPrice(row) }}</template>
      <template #group-values="{ aggValue }">{{ `${aggValue}m` }}</template>
    </VxeColumn>

    <!--
      We have to specify a `field`, or the `group-values` template
      would be ignored.
    -->
    <VxeColumn
      field="id"
      title="操作"
      width="auto"
      show-overflow
      fixed="right"
      header-align="right"
      agg-func
    >
      <template #default="{ row }">
        <VxeButton
          content="ZKB 页面"
          @click="redirectZkb(row.killmailId)"
        ></VxeButton>
        <VxeButton
          content="通过"
          :status="!needManualApprove(row) ? 'info' : 'primary'"
          :disabled="!needManualApprove(row)"
          @click="onManualApprove(row)"
        ></VxeButton>
        <VxeButton
          content="拒绝"
          :status="!canManualReject(row) ? 'info' : 'error'"
          :disabled="!canManualReject(row)"
          @click="onManualReject(row)"
        ></VxeButton>
      </template>
      <template #group-values></template>
    </VxeColumn>
  </VxeTable>
</template>
