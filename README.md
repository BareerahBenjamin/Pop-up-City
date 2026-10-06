# Herstory Pop-up City

- **版本：** v1.0
- **负责人：** Herstory 项目维护者
- **状态：** Game Jam及首次登录资料流程已完成；发布时需应用0011增量迁移
- **最后更新：** 2026-10-06

面向 Herstory 社区的活动、成员和共同生活管理网站。采用 **Node.js + SQLite + 原生 JavaScript/CSS**，同一服务提供页面与 API，活动页面无需额外前端构建；星球源码修改后运行 `npm run build:planet`。

本仓库仅包含当前 Node.js 版本，不依赖旧 Cloudflare、Python 桥接服务、硬件固件或独立头像发行项目。真实成员数据、设备凭证、邮箱密码和本地运行环境不随源码发布。★★★★★（运行依赖与提交范围核对。）

## 第一版功能

| 功能 | 当前能力 |
| --- | --- |
| 成员登录 | 管理员导入邮箱和昵称后，六位验证码或一次性邮件链接登录；未导入／已停用邮箱返回403，不发送邮件、不生成凭证 |
| 活动 | 发布、编辑、审核、退回、取消、官方标记、可选图片封面 |
| 活动安排 | 一天/三天/一周日历，感兴趣收藏，今日和未来安排按时间排序 |
| 报名 | 参与者与志愿者名额独立；开始后禁止新增报名、收藏及迟到签到 |
| 分享 | 浏览器生成 PNG 海报，可选活动二维码和系统分享；未发布活动只能生成草稿 |
| 生活任务 | 发布、领取、退出、成员自行标记完成 |
| 成员主页 | 资料、已发布活动、完成任务、本人签到和社交连接 |
| 头像与资料 | 首次登录先填资料、再设置头像、确认后进入星球；头像首次确认后锁定，普通资料可继续编辑；已有头像保留；不是正式唯一头像发行 |
| 星球 | 主网站内嵌 3D、持久身份与四色、真实社交连接与个人活动资产成长；2D 仅硬件；首次登录主动引导 |
| Game Jam | 真实作品画廊、分类搜索、成员投稿、manifest／固件与封面存储、管理员审核与文件下载 |
| 管理后台 | 成员导入/启停、超级管理员授权、设备凭证管理、活动批量导入和名单、成长活动绑定与角色审核 |
| 设备接口 | 设备令牌鉴权、现场 PIN 签到、一次性六位社交码与连接记录 |

个人星球成长已支持58场活动目录、累计轨道、两场市集、志愿者与发起者奖励、账本及纠正。进入管理后台「星球成长」，启用固定规则并绑定实际活动后使用；详见 [成长说明](planet_growth_v1.0.md)。原 P/H/V/M 指标账本保留，指标计算 API 仍待确定；设备接口存在不代表真机联调已通过。

## 本地运行

要求 Node.js **22.16 或以上**。从仓库根目录执行：

```sh
npm ci --ignore-scripts
cp -n .env.example .env
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

将生成值填入本地 `.env` 的 `AUTH_PEPPER`，再运行：

```sh
npm run migrate
npm run admin -- YOUR_ADMIN_EMAIL 你的昵称
npm start
```

打开 <http://127.0.0.1:3300>。新数据库为空，不包含演示账号或默认密码；首位管理员为超级管理员。已有 `.env` 和数据库时不要覆盖，也不要反复创建同一管理员。

## 邮箱配置

先在管理后台「成员」导入名单，每行填写 `邮箱,昵称`（两项必填）。导入成功且账号未停用后，成员才能获取登录邮件；未导入邮箱在登录表单内提示联系管理员，不会进入验证码页面。首位管理员仍通过 `manage.js admin` 建立。★★★★★（隔离数据库及模拟邮件回归验证。）

默认 `MAIL_MODE=disabled`，可以浏览公开活动，但无法发送登录邮件。启用登录时，在本地 `.env` 或服务器专用配置中设置 `MAIL_MODE=smtp`，填写 `FROM_EMAIL`、`SMTP_HOST`、`SMTP_PORT`、`SMTP_SECURE`、`SMTP_USER`、`SMTP_PASS`。模板不含真实密码。

项目发件地址为 `info@0xherstory.cn`，SMTP 必须允许此地址发信。465 使用 SSL；587 使用 STARTTLS 时将 `SMTP_SECURE=false`。客户端专用密码仅写入受保护的本地配置，不提交 GitHub。

`/healthz` 的 `mail_configured` 仅表示参数存在，不证明认证或投递成功。2026-10-06 云端 SMTP 连接与认证已验证成功，公网 [kunyuan.site](https://kunyuan.site) 返回200、健康检查正常。尚未发送测试邮件；收件箱送达和垃圾邮件归类仍需由真实登录验证。发信失败返回503和明确提示。

## 项目结构

```text
server.js / api.js        HTTP 服务、业务路由与权限
config.js / mail.js       环境配置、SMTP
covers.js / roles.js      图片封面、超级管理员授权
planet.js / planet-growth.js 星球身份、快照与资产成长
hardware.js              硬件确认、签名回执与RGB565
game-jam.js              投稿、应用归属、审核、文件存储与下载
config/                  固定模型单元与市集清单
database.js              SQLite、事务与迁移检查
manage.js / backup.js     迁移、建立管理员、在线备份
migrations/              0001–0011 全部增量迁移
public/                  页面、样式、交互、品牌和头像素材
test/                    隔离数据库、模拟邮件及可选浏览器测试
deploy/                  systemd、Caddy 与生产环境模板
scripts/                 不含秘密或数据库的发布打包
```

`.env`、`data/` 和 `node_modules/` 只在本地存在，并由 `.gitignore` 排除。

## 页面与接口

页面入口：`#planet`、`#setup`、`#events`、`#event/:id`、`#tasks`、`#members`、`#member/:id`、`#me`、`#admin`。成员及管理页面由服务端会话校验；隐藏按钮不是授权机制。

| 接口组 | 主要路径 |
| --- | --- |
| 登录 | `POST /api/auth/request`、`/verify`、`/redeem`、`/logout` |
| 本人与成员 | `GET/PATCH /api/me`、`GET /api/me/records`、`GET /api/members`、`GET /api/members/:id` |
| 活动 | `GET/POST /api/events`、`GET/PATCH /api/events/:id` |
| 收藏和报名 | `POST/DELETE /api/events/:id/interest`、`/attendees`、`/volunteers` |
| 封面和二维码 | `GET /api/events/:id/cover`、`/qr`；封面随创建/编辑活动提交 |
| 任务 | `GET/POST /api/tasks`、`PATCH /api/tasks/:id`、`POST/DELETE /api/tasks/:id/claims`、`POST /api/tasks/:id/complete` |
| 管理 | `/api/admin/members/*`、`/api/admin/events/*`；批量活动 `POST /api/admin/events/import` |
| 星球成长、Game Jam审核 | `/api/herstory/planet-state`、`/api/admin/planet/growth/*` |
| 设备 | `/api/device/me`、`/events`、`/records`、`/checkins`、`/social-code`、`/connections` |

字段和精确方法以 [api.js](api.js) 为准。时间使用 Unix 秒，页面展示 UTC+8。设备使用独立 Bearer Token；网页写请求要求 Origin 与 `PUBLIC_ORIGIN` 一致。当前签到窗口为开始前一小时（含）至开始时刻（不含）。

## 数据与升级

所有 `migrations/*.sql` 都必须保留。已应用迁移有 SHA-256 校验，禁止重写、合并或删除旧迁移；新变更新增编号文件。服务启动仅校验，迁移需显式运行。

升级只替换代码并增量迁移，**不上传本机 SQLite 覆盖服务器数据库**。迁移前可运行 `npm run backup -- backup-before-upgrade.sqlite`；备份文件不得提交仓库。`AUTH_PEPPER` 需要保持稳定。

## 验证

```sh
npm test
```

测试使用临时数据库和模拟发信，不读取正式成员或发送真实邮件。当前仓库未启用 GitHub Actions；可以在具备 workflow 权限后配置自动执行同一测试入口。

可选浏览器检查需要自行提供 Playwright 与 Chromium，避免把本机浏览器依赖提交仓库：

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
CHROMIUM_PATH=/absolute/path/to/chromium \
node test/browser.mjs
```

浏览器检查使用独立内存数据库和本地端口 3331；不使用运行中的 3300 数据库。用同样环境变量运行 `node test/login-browser.mjs` 可在端口3336验证「未导入被拒绝 → 管理员导入邮箱和昵称 → 验证码登录」，邮件仅捕获在内存中。测试通过不代表真实邮件投递或硬件已经验收。

## 部署与对接文档

- [Game Jam页面与数据库接入](game_jam_integration_v1.0.md)

- [独立部署与安全升级](deployment_v1.0.md)
- [数据库完整结构](database_schema_v1.0.md)
- [成长后端架构与实现边界](growth_architecture_v1.0.md)
- [成长数据字典](growth_data_dictionary_v1.0.md)
- [当前视觉说明](visual_refresh_v1.0.md)
- [技术决策记录](decision_log_v1.0.md)
- [星球嵌入与首次身份设置](planet_integration_v1.0.md)

本仓库是 Node 服务源码，不能直接用 GitHub Pages 运行后端。品牌图片和头像素材为项目提供素材；公开源码不代表额外授予第三方素材的使用授权。

2026-10-06 更新：头像确认后锁定，其他个人资料可编辑。硬件签到、双向交友与版本化 RGB565 分块接口见 [硬件 API](hardware_api_v1.0.md)。增量迁移至 0009；部署前备份，勿覆盖历史迁移。

- [个人星球成长规则与验收](planet_growth_v1.0.md)
- [硬件数据与确认契约](hardware_api_v1.0.md)

- [云服务器逐步部署流程](cloud_deployment_v1.0.md)
- [RGB565硬件画面存储契约](rgb565_storage_v1.0.md)
