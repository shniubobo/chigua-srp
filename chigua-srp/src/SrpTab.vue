<template>
  <div class="mb-2 flex">
    <div class="grow">
      <slot name="header-left"></slot>
    </div>

    <SsoButtonSuspended></SsoButtonSuspended>
  </div>

  <div class="grow overflow-hidden">
    <slot name="body"></slot>
  </div>
</template>

<script setup lang="ts">
import SsoButtonSuspended from "./SsoButtonSuspended.vue";
</script>
