# 活动网站同机隔离部署手册

- **版本：** v1.0
- **负责人：** 技术实施
- **状态：** 域名选定 kunyuan.site，待 DNS 核对与 SMTP 配置；部署步骤尚未在服务器执行
- **最后更新：** 2026-10-05

## 目标

在项目指定的服务器上新增活动服务，保留 Node `127.0.0.1:3000`、Python `127.0.0.1:3210`、PM2、Workshop、现有 Caddy 路由及全部旧文件和数据。当前依据是用户提供的只读输出；旧站完整部署路径、流量高峰及 Caddy 配置仍需在实际部署时确认。

| 项目 | 新服务专用资源 |
| --- | --- |
| 系统账户 | `herstory-popup-city`，禁止交互登录，不加入旧应用的权限组 |
| 发布目录 | `/opt/herstory-popup-city/releases/<版本>/` |
| 当前版本 | `/opt/herstory-popup-city/current`，仅指向上述发布目录 |
| Node 运行时 | `/opt/herstory-popup-city/runtime/bin/node` |
| 持久数据 | `/var/lib/herstory-popup-city/` |
| 配置文件 | `/etc/herstory-popup-city/server.env` |
| systemd 服务 | `herstory-popup-city.service` |
| HTTP | `127.0.0.1:3300`，不在云防火墙开放此端口 |
| 域名 | `https://kunyuan.site`，使用根域名；保留现有其他站点及解析 |

资源限制初值：MemoryHigh 384M、MemoryMax 512M、禁用本服务 Swap、CPUQuota 50%（半个 CPU 核的执行时间上限，并非整台 4 核机器的一半）、低 CPU/IO 调度权重。这些是起始预算，不是容量承诺；应在模拟实际人数的负载验证后调整。★★★☆☆（资源有余量，但尚无新应用生产负载数据。）

本仓库保留 `0001`–`0005` 全部迁移。下方命令中的服务器地址、密钥路径和版本名是部署参数，需要替换；不要上传本机数据库覆盖服务器已有数据。

## 1. 准备发布物

本地在 `server_backend` 目录执行：

```sh
npm ci --ignore-scripts
npm test
sh scripts/package-release.sh /tmp/herstory-popup-city-v1.tar.gz
```

不打包 `.env`、数据库、其他旧项目、Cloudflare `.wrangler` 缓存或私钥。选用经核验的官方 Linux Node 发行包，CPU 架构必须匹配服务器 `uname -m`。将独立运行时解压到上表路径，不改全局 `/usr/bin/node`、NVM 或旧程序的 Node 版本。此步骤和下面各步只在实际部署阶段执行。

## 2. 记录旧服务基线

部署前确认新端口未被占用，记录旧域名的页面/API 响应及旧服务状态；如果新端口已占用，换新端口并同步修改新服务环境变量与 Caddy 片段，不能停止占用者。确认 `/opt/herstory-popup-city` 等专用名称没有被其他项目使用，如有冲突先换名称。

禁止为了此次部署执行 `apt upgrade`、全局 Node/Python 升级、`pm2 restart all`、停止旧服务、重装系统或全局 Docker 改造。不执行旧数据库迁移。

## 3. 安装新服务

仅建立新系统账户与上表专属目录。代码和运行时归 root 所有，新服务只读；数据目录归新账户所有，权限 0700；配置目录 root 管理，配置文件设为 `root:herstory-popup-city`、0640。不得对 `/opt`、`/var/lib` 等共享父目录进行递归 chown/chmod。

解压发布包到新的版本目录，用**专用运行时**安装锁定依赖：

```sh
/opt/herstory-popup-city/runtime/bin/node \
  /opt/herstory-popup-city/runtime/lib/node_modules/npm/bin/npm-cli.js \
  ci --omit=dev --ignore-scripts
```

该命令工作目录必须是新版本目录。不要在旧项目目录运行。建立 `current` 指向该版本，不覆盖同名的非符号链接目录。

参考 `deploy/server.env.example` 创建生产配置，设置最终 `PUBLIC_ORIGIN`、稳定随机 `AUTH_PEPPER` 和新数据库路径。发件人使用 `FROM_EMAIL=info@0xherstory.cn`，SMTP 服务必须允许该地址发信；不要根据站点域名猜测 SMTP 参数。尚未取得 SMTP 时保持 `MAIL_MODE=disabled`；公开页可以验收，但不可宣称成员登录完成。

在新版本目录，以专用用户显式初始化数据库及管理员：

```sh
sudo -u herstory-popup-city /opt/herstory-popup-city/runtime/bin/node \
  --env-file=/etc/herstory-popup-city/server.env manage.js migrate
sudo -u herstory-popup-city /opt/herstory-popup-city/runtime/bin/node \
  --env-file=/etc/herstory-popup-city/server.env manage.js admin \
  YOUR_ADMIN_EMAIL 你的昵称
```

替换管理员邮箱，不能盲目沿用历史管理员。管理命令拒绝覆盖或提权已有邮箱。空库首位管理员为超级管理员；已有库应用 `0003_member_roles_and_interests.sql` 时，只把最早创建的未停用管理员升级为超级管理员。正式升级前核对目标账号，备份并迁移后重启本服务。

将模板复制为 `/etc/systemd/system/herstory-popup-city.service`。检查专用运行时和所有路径后，先执行 `systemd-analyze verify` 验证该文件，再 `systemctl daemon-reload` 加载服务定义，最后仅启动 `herstory-popup-city`。`daemon-reload` 不重启现有应用；不要运行 `systemctl restart caddy`。

模板通过只读文件系统、专用用户、私有临时目录及 `/opt`、`/var/lib` 挂载隔离隐藏常见旧应用目录。尚未在目标 systemd 上实测，若启动报权限或命名空间问题，检查新服务日志并针对其路径修正，不解除整个主机的保护设置。

## 4. 先测试，再接入域名

检查新服务 `/healthz` 与 `/api/events`，验证进程运行于新用户，并检查 systemd 实际应用的 MemoryMax、CPUQuota、数据写入目录。可在 Mac 上通过隧道先看页面：

```sh
ssh -i ~/.ssh/YOUR_SERVER_KEY -o IdentitiesOnly=yes \
  -L 13300:127.0.0.1:3300 ubuntu@YOUR_SERVER_IP
```

打开 `http://127.0.0.1:13300` 仅验证公开页。生产配置要求 HTTPS 且 Origin 与 `https://kunyuan.site` 一致，不能为了隧道下登录而关闭生产来源检查或 Secure Cookie。完整登录在正式 HTTPS 入口验收。

域名就绪后，先核对 `kunyuan.site` 的现有 A、AAAA、CNAME 与业务用途；如果根域名已有网站，先确认切换安排，不能直接覆盖。无冲突后将根域名（DNS 主机记录通常为 `@`）的 A 记录配置为 目标服务器公网 IP。如存在指向其他服务器的 AAAA，也需明确处理方案，避免 IPv6 访问落到错误站点。保留现有其他网站和邮件记录，本次不配置 `www`。读取现有 Caddy 的实际启动配置、import 结构和证书方式，只增加 `deploy/Caddyfile.snippet` 对应的新站点。**不能用片段覆盖整份 Caddyfile。**

验证合并后的完整配置，使用现有服务支持的 reload 方式平滑加载。若验证失败，不 reload。Caddy 配置校验与 reload 的命令参数以其实际配置路径和适配器为准。[Caddy 官方命令说明](https://caddyserver.com/docs/command-line)

加载后同时验收旧域名和新域名；旧应用进程不应因这次操作重启。新服务端口继续仅绑定回环地址。

## 5. 上线验收与回退

- 邮件发送功能必须保留；配置 SMTP 后验证真实邮箱送达、管理员与普通成员登录、一次性链接和管理员发送登录邀请，再验收活动审核和报名、头像选择、任务与设备接口。`MAIL_MODE=disabled` 仅用于准备阶段，不能作为完整上线状态。
- 确认新服务重启后数据仍存在，CPU/内存上限生效；观察旧站响应与磁盘余量。
- 开机自启仅启用 `herstory-popup-city`；不改变旧服务开机策略。
- 若新服务异常，只停止 `herstory-popup-city`；如需撤下公网入口，仅撤销新增站点片段，校验完整 Caddy 配置后 reload。不要删除数据库和发布目录。
- 回退代码仅切换本服务 `current` 并重启本服务。若新版本有数据库迁移，先验证旧代码兼容性，不盲目降级数据库、不覆盖旧站数据。
- 不新增或删除主机快照，不自动删除历史 Cloudflare Worker/D1。备份与个人数据保留规则须另行确定；本手册没有授权更改这些设置。

## 当前尚缺

1. `kunyuan.site` 的 DNS 管理权限及现有解析用途核对。
2. SMTP 服务商、发信邮箱、授权信息（只填受保护配置文件），以及实际发信测试。
3. 是否需要迁移历史 Cloudflare 数据；目前默认新建独立空数据库。
4. 实际服务器运行时、systemd 沙箱与旧站回归验证。
