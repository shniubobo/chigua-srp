<template>
  <Suspense>
    <SsoButton></SsoButton>
    <template #fallback>
      <div class="mb-2 py-button-placeholder">登入中……</div>
    </template>
  </Suspense>
</template>

<script setup lang="ts">
import SsoButton from "./SsoButton.vue";
</script>
