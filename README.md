# 吃瓜补损系统

游戏 [EVE Online](https://www.eveonline.com/) 内，[吃瓜军团](https://zkillboard.com/corporation/98524084/)使用的军团内舰船补损系统。

- **军团成员**于游戏内向指定邮件列表发送 KM（自己舰船被击毁的信息）；
- **该系统**从 ESI（游戏暴露的 API 接口）拉取邮件，并：
  - 解析 KM，根据既定规则判断是否通过补损；
  - 计算每个帐号的补损金额；
  - 根据补损明细生成游戏内邮件；
- **军团补损官**复核机审结果，向成员汇款，并确认发送补损明细邮件。

前端（[`chigua-srp`](./chigua-srp/)）主要技术栈为 TypeScript + Vue + tailwindcss，组件库使用 vxe。另有 [`oauth-proxy`](./oauth-proxy/) 负责转发前端的 OAuth 请求，部署于 Cloudflare Workers。

## 开发

### 准备开发环境

安装依赖：

```
nvm use
corepack enable
pnpm i
```

本地开发环境需要自行[前往 ESI 创建一个 App](https://developers.eveonline.com/applications/create)。名称和介绍不重要，任意内容均可；Callback URL 填写 `http://localhost:5173/callback`，scope 按照 [esi.ts](chigua-srp/src/esi.ts) 内的 `SCOPES` 勾选。创建完成后，页面会显示一个 Client ID。在 [chigua-srp](./chigua-srp/) 目录下创建如下 `.env.development` 文件，并将 `<cliend id>` 替换为刚刚申请得到的即可。

```dotenv
VITE_CLIENT_ID="<client id>"
VITE_OAUTH_PROXY="http://localhost:5173/.well-known/openid-configuration"
```

如此操作后，每次使用 vite 启动开发服务器时，vite 会自动读取这两个环境变量，并传给应用。

### 启动开发服务器

在 [`oauth-proxy`](./oauth-proxy/) 和 [`chigua-srp`](./chigua-srp/) 目录下依次分别运行：

```
pnpm dev
```

注意需先启动 [`oauth-proxy`](./oauth-proxy/)，否则会导致 5173 端口分配给 [`chigua-srp`](./chigua-srp/)，前端无法从上述 `.env.development` 文件内配置的地址访问到 `oauth-proxy`。

### 构建

```
pnpm lint
pnpm dist
```
