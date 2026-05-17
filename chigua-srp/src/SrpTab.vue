<template>
  <div class="mb-2 flex">
    <div class="grow">
      <span v-if="isLoggedIn()">
        <slot name="header-left"></slot>
      </span>
    </div>

    <SsoButtonSuspended></SsoButtonSuspended>
  </div>

  <div class="grow overflow-hidden">
    <slot name="body"></slot>
  </div>
</template>

<script setup lang="ts">
import { isLoggedIn } from "./esi";
import SsoButtonSuspended from "./SsoButtonSuspended.vue";
</script>
