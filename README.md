# 吃瓜补损系统

游戏 [EVE Online](https://www.eveonline.com/) 内，[吃瓜军团](https://zkillboard.com/corporation/98524084/)使用的军团内舰船补损系统。

- **军团成员**于游戏内向指定邮件列表发送 KM（自己舰船被击毁的信息）；
- **该系统**从 ESI（游戏暴露的 API 接口）拉取邮件，并：
  - 解析 KM，根据既定规则判断是否通过补损；
  - 计算每个帐号的补损金额；
  - 根据补损明细生成游戏内邮件；
- **军团补损官**复核机审结果，向成员汇款，并确认发送补损明细邮件。

主要技术栈为 TypeScript + Vue + tailwindcss，组件库使用 vxe。无后端。

## 开发

准备开发环境：

```
nvm use
corepack enable
pnpm i
```

启动开发服务器：

```
pnpm dev
```

构建：

```
pnpm lint
pnpm dist
```
