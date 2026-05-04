<template>
  <div class="grid h-full grid-cols-24">
    <div
      class="col-span-24 overflow-hidden p-4 xl:col-span-18 xl:col-start-4
        xl:px-0"
    >
      <VxeTabs position="left">
        <VxeTabPane title="KM 信息" name="km-info">
          <template #default>
            <KmInfoTab
              v-model:loading="loading"
              v-model:srp-data="srpData"
              v-model:reviews="reviews"
            ></KmInfoTab>
          </template>
        </VxeTabPane>

        <VxeTabPane title="补损邮件" name="srp-mail">
          <template #default>
            <SrpMailTab :loading :srp-data :reviews></SrpMailTab>
          </template>
        </VxeTabPane>
      </VxeTabs>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { VxeTabPane, VxeTabs } from "vxe-pc-ui";

import KmInfoTab from "./KmInfoTab.vue";
import SrpMailTab from "./SrpMailTab.vue";
import { type Reviews, type SrpData } from "./srp";

const loading = ref(false);
const srpData = ref<SrpData>(new Map());
const reviews = ref<Reviews>(new Map());

watch(srpData, (srpData) => {
  reviews.value.clear();
  srpData.keys().forEach((id) => {
    reviews.value.set(id, { approve: false, reject: false });
  });
});
</script>

<style lang="postcss"></style>
