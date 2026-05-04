import { createApp } from "vue";
import {
  VxeDatePanel,
  VxeIcon,
  VxeLoading,
  VxeModal,
  VxeTooltip,
  VxeUI,
} from "vxe-pc-ui";
import zhCN from "vxe-pc-ui/lib/language/zh-CN";

import App from "./App.vue";

import "vxe-pc-ui/styles/cssvar.scss";
import "vxe-table/styles/cssvar.scss";

import "./style.css";

console.debug(import.meta.env.MODE);
console.debug(import.meta.env.VITE_REVISION ?? "none");

VxeUI.setI18n("zh-CN", zhCN);
VxeUI.setLanguage("zh-CN");

VxeUI.component(VxeDatePanel);
VxeUI.component(VxeIcon);
VxeUI.component(VxeLoading);
VxeUI.component(VxeModal);
VxeUI.component(VxeTooltip);

// eslint-disable-next-line @typescript-eslint/no-unsafe-argument
const app = createApp(App);
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.config.errorHandler = async (err, _instance, info) => {
  console.error(`info = ${info}`);
  await VxeUI.modal.message({
    id: "uncaught-error",
    content: "发生未知错误，请联系开发者！",
    status: "error",
  });
  throw err;
};
app.mount("#app");
