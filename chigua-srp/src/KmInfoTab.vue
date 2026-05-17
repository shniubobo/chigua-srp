<template>
  <SrpTab>
    <template #header-left>
      <span class="border-e border-gray-300 pr-2">
        <VxeDateRangePicker
          v-model:start-value="startDateTimeString"
          v-model:end-value="endDateTimeString"
          type="datetime"
          value-format="yyyy-MM-ddTHH:mm:00[Z]"
          label-format="yyyy-MM-dd HH:mm [E]T"
          placeholder="选择邮件拉取时间范围"
          clearable
          class="mr-2"
        ></VxeDateRangePicker>
        <VxeButton status="primary" :loading @click="onFetchKillmails()"
          >拉取</VxeButton
        >
      </span>
      <span>
        <VxeSwitch
          v-model="sinceLastSrp"
          open-label="是"
          close-label="否"
        ></VxeSwitch>
        <span>自动排除上一次补损前的 KM</span>
      </span>
    </template>

    <template #body>
      <KmInfoTable
        v-model:reviews="reviews"
        :srp-data="srpData"
        :loading="loading"
      ></KmInfoTable>
    </template>
  </SrpTab>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { VxeButton, VxeDateRangePicker, VxeSwitch, VxeUI } from "vxe-pc-ui";

import { fetchKillmails } from "./esi";
import KmInfoTable from "./KmInfoTable.vue";
import { buildSrpData, type Reviews, type SrpData } from "./srp";
import SrpTab from "./SrpTab.vue";

const loading = defineModel<boolean>("loading", { required: true });
const srpData = defineModel<SrpData>("srp-data", { required: true });
const reviews = defineModel<Reviews>("reviews", { required: true });

const startDateTimeString = ref("");
const endDateTimeString = ref("");
const startDateTime = computed(() => {
  if (!startDateTimeString.value) return null;
  return new Date(startDateTimeString.value);
});
const endDateTime = computed(() => {
  if (!endDateTimeString.value) return null;
  return new Date(endDateTimeString.value);
});

const sinceLastSrp = ref(false);

async function onFetchKillmails() {
  if (startDateTime.value === null || endDateTime.value === null) {
    await VxeUI.modal.message({
      id: "date-not-picked",
      content: "请先选择日期！",
      status: "error",
    });
    return;
  }

  loading.value = true;

  try {
    const killmails = await fetchKillmails(
      startDateTime.value,
      endDateTime.value,
      sinceLastSrp.value,
    );
    srpData.value = await buildSrpData(killmails);
  } finally {
    loading.value = false;
  }
}
</script>
