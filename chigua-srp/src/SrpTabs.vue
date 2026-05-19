<template>
  <div class="grid h-full grid-cols-24">
    <div
      class="col-span-24 overflow-hidden p-4 xl:col-span-18 xl:col-start-4
        xl:px-0"
    >
      <VxeTabs position="left">
        <VxeTabPane title="KM 信息" name="km-info">
          <template #default>
            <KmInfoTab v-model:loading="loading"></KmInfoTab>
          </template>
        </VxeTabPane>

        <VxeTabPane title="补损邮件" name="srp-mail">
          <template #default>
            <SrpMailTab :loading></SrpMailTab>
          </template>
        </VxeTabPane>

        <VxeTabPane title="转账信息" name="payment">
          <template #default>
            <PaymentTab :loading></PaymentTab>
          </template>
        </VxeTabPane>
      </VxeTabs>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { VxeTabPane, VxeTabs } from "vxe-pc-ui";

import KmInfoTab from "./KmInfoTab.vue";
import PaymentTab from "./PaymentTab.vue";
import SrpMailTab from "./SrpMailTab.vue";

const loading = ref(false);
</script>
