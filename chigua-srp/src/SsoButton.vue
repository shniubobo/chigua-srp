<template>
  <div>
    <VxeButton
      v-if="!isLoggedIn()"
      status="primary"
      :loading
      @click="redirectToSso()"
      >登入</VxeButton
    >
    <div v-else>
      <span class="pr-4">{{ characterName }}</span>
      <VxeButton @click="logOut">登出</VxeButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { VxeButton } from "vxe-pc-ui";

import {
  getOAuthCharacterName,
  isLoggedIn,
  logOut,
  maybeFinalizeSsoLogin,
  prepareToRedirect,
} from "./esi";

const loading = ref(false);
const characterName = computed(getOAuthCharacterName);

async function redirectToSso() {
  loading.value = true;
  try {
    const urlToRedirectTo = await prepareToRedirect();
    location.href = urlToRedirectTo.href;
  } finally {
    loading.value = false;
  }
}

try {
  await onRedirectedBack();
} catch (e) {
  console.error(e);
  // Do not re-throw, or this component cannot be rendered.
}

async function onRedirectedBack() {
  await maybeFinalizeSsoLogin();

  const currentUrl = new URL(location.href);
  currentUrl.search = "";
  history.pushState({}, "", currentUrl);
}
</script>
