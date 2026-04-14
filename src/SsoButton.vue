<template>
  <div>
    <VxeButton v-if="!isLoggedIn()" status="primary" @click="redirectToSso()"
      >登入</VxeButton
    >
    <div v-else>
      <span class="pr-4">{{ characterName }}</span>
      <VxeButton @click="logOut">登出</VxeButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { VxeButton } from "vxe-pc-ui";

import {
  getOAuthCharacterName,
  isLoggedIn,
  logOut,
  maybeFinalizeSsoLogin,
  prepareToRedirect,
} from "./esi";

const characterName = computed(getOAuthCharacterName);

async function redirectToSso() {
  const urlToRedirectTo = await prepareToRedirect();
  location.href = urlToRedirectTo.href;
}

await onRedirectedBack();
async function onRedirectedBack() {
  await maybeFinalizeSsoLogin();

  const currentUrl = new URL(location.href);
  currentUrl.search = "";
  history.pushState({}, "", currentUrl);
}
</script>
