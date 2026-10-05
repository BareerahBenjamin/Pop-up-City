# Herstory Pop-up City

- **版本：** v1.0
- **负责人：** Herstory 项目维护者
- **状态：** 第一版 Node.js 网站源码；生产部署与真实邮件投递需单独验收
- **最后更新：** 2026-10-05

面向 Herstory 社区的活动、成员和共同生活管理网站。采用 **Node.js + SQLite + 原生 JavaScript/CSS**，同一服务提供页面与 API，无需额外前端构建。

本仓库仅包含当前 Node.js 版本，不依赖旧 Cloudflare、Python 桥接服务、硬件固件或独立头像发行项目。真实成员数据、设备凭证、邮箱密码和本地运行环境不随源码发布。★★★★★（运行依赖与提交范围核对。）

## 第一版功能

| 功能 | 当前能力 |
| --- | --- |
| 成员登录 | 管理员导入邮箱，六位验证码或一次性邮件链接登录；没有公开注册 |
| 活动 | 发布、编辑、审核、退回、取消、官方标记、可选图片封面 |
| 活动安排 | 一天/三天/一周日历，感兴趣收藏，今日和未来安排按时间排序 |
| 报名 | 参与者与志愿者名额独立；开始后禁止新增报名、收藏及迟到签到 |
| 分享 | 浏览器生成 PNG 海报，可选活动二维码和系统分享；未发布活动只能生成草稿 |
| 生活任务 | 发布、领取、退出、成员自行标记完成 |
| 成员主页 | 资料、已发布活动、完成任务、本人签到和社交连接 |
| 头像 | 图层选择、穿搭预览和保存配置；不是正式唯一头像发行 |
| 管理后台 | 成员导入/启停、超级管理员授权、设备凭证管理、活动批量导入和名单 |
| 设备接口 | 设备令牌鉴权、现场 PIN 签到、一次性六位社交码与连接记录 |

成长系统已具备期数、类型、核验、奖励账本和资产表及约束；**规则计算、成长业务 API 和星球页面尚未实现**。设备接口存在不代表真机联调已通过。

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

默认 `MAIL_MODE=disabled`，可以浏览公开活动，但无法发送登录邮件。启用登录时，在本地 `.env` 或服务器专用配置中设置 `MAIL_MODE=smtp`，填写 `FROM_EMAIL`、`SMTP_HOST`、`SMTP_PORT`、`SMTP_SECURE`、`SMTP_USER`、`SMTP_PASS`。模板不含真实密码。

项目发件地址为 `info@0xherstory.cn`，SMTP 必须允许此地址发信。465 使用 SSL；587 使用 STARTTLS 时将 `SMTP_SECURE=false`。客户端专用密码仅写入受保护的本地配置，不提交 GitHub。

`/healthz` 的 `mail_configured` 仅表示参数存在，不证明认证或投递成功。发信失败返回 503 和明确提示；SMTP 认证、收件箱送达和垃圾邮件归类需单独验证。截至本版整理，真实 SMTP 认证故障尚未确认恢复。

## 项目结构

```text
server.js / api.js        HTTP 服务、业务路由与权限
config.js / mail.js       环境配置、SMTP
covers.js / roles.js      图片封面、超级管理员授权
database.js              SQLite、事务与迁移检查
manage.js / backup.js     迁移、建立管理员、在线备份
migrations/              0001–0005 全部增量迁移
public/                  页面、样式、交互、品牌和头像素材
test/                    隔离数据库、模拟邮件及可选浏览器测试
deploy/                  systemd、Caddy 与生产环境模板
scripts/                 不含秘密或数据库的发布打包
```

`.env`、`data/` 和 `node_modules/` 只在本地存在，并由 `.gitignore` 排除。

## 页面与接口

页面入口：`#events`、`#event/:id`、`#tasks`、`#members`、`#member/:id`、`#me`、`#admin`。成员及管理页面由服务端会话校验；隐藏按钮不是授权机制。

| 接口组 | 主要路径 |
| --- | --- |
| 登录 | `POST /api/auth/request`、`/verify`、`/redeem`、`/logout` |
| 本人与成员 | `GET/PATCH /api/me`、`GET /api/me/records`、`GET /api/members`、`GET /api/members/:id` |
| 活动 | `GET/POST /api/events`、`GET/PATCH /api/events/:id` |
| 收藏和报名 | `POST/DELETE /api/events/:id/interest`、`/attendees`、`/volunteers` |
| 封面和二维码 | `GET /api/events/:id/cover`、`/qr`；封面随创建/编辑活动提交 |
| 任务 | `GET/POST /api/tasks`、`PATCH /api/tasks/:id`、`POST/DELETE /api/tasks/:id/claims`、`POST /api/tasks/:id/complete` |
| 管理 | `/api/admin/members/*`、`/api/admin/events/*`；批量活动 `POST /api/admin/events/import` |
| 设备 | `/api/device/me`、`/events`、`/records`、`/checkins`、`/social-code`、`/connections` |

字段和精确方法以 [api.js](api.js) 为准。时间使用 Unix 秒，页面展示 UTC+8。设备使用独立 Bearer Token；网页写请求要求 Origin 与 `PUBLIC_ORIGIN` 一致。当前签到窗口为开始前一小时（含）至开始时刻（不含）。

## 数据与升级

所有 `migrations/*.sql` 都必须保留。已应用迁移有 SHA-256 校验，禁止重写、合并或删除旧迁移；新变更新增编号文件。服务启动仅校验，迁移需显式运行。

升级只替换代码并增量迁移，**不上传本机 SQLite 覆盖服务器数据库**。迁移前可运行 `npm run backup -- /绝对路径/backup.sqlite`；备份文件不得提交仓库。`AUTH_PEPPER` 需要保持稳定。

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

浏览器检查使用独立内存数据库和本地端口 3331；不使用运行中的 3300 数据库。测试通过不代表 SMTP、腾讯云部署或真实硬件已经验收。

## 部署与对接文档

- [独立部署与安全升级](deployment_v1.0.md)
- [数据库完整结构](database_schema_v1.0.md)
- [成长后端架构与实现边界](growth_architecture_v1.0.md)
- [成长数据字典](growth_data_dictionary_v1.0.md)
- [当前视觉说明](visual_refresh_v1.0.md)
- [技术决策记录](decision_log_v1.0.md)

本仓库是 Node 服务源码，不能直接用 GitHub Pages 运行后端。品牌图片和头像素材为项目提供素材；公开源码不代表额外授予第三方素材的使用授权。
