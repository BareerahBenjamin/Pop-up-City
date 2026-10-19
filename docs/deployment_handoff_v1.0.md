# Rae 仓库与部署交接

- **版本：** v1.0
- **负责人：** Herstory 仓库维护者；服务器执行授权由服务器负责人管理
- **状态：** 已核对线上版本并归档现有脚本；未授权新的服务器部署权限
- **最后更新：** 2026-10-15（Asia/Hong_Kong）

## 仓库合并规则

仓库为 `BareerahBenjamin/Pop-up-City`，正式分支为 `main`。2026-10-15 核查时，main 没有传统分支保护，仓库及继承的 Rulesets 列表为空，也没有 Actions 工作流。因此没有现存的审批项可取消，需补齐 PR 和测试门槛。

已生效配置：main 必须通过 PR 合并；必需检查为 GitHub Actions 的 `test`，分支须与 main 保持最新。必需审批数为 0，不要求 Code Owner 审批，不要求最近一次推送审批；同样约束管理员。Rae 已具备仓库 write 权限，可在 test 通过且分支保持最新后自行检查并合并自己的 PR。仓库拥有者仍保留管理权限。

CI 对 main 的 PR、main 更新和手动触发执行：Node v22.23.1、Linux 依赖安装、现有隔离测试和发布自检。交接脚本在本地完成语法和摘要校验。CI 不持有服务器密钥或生产配置，不进行部署。

网站超级管理员身份不授予 GitHub 仓库权限。用户提供 Rae 的 GitHub 用户名 `whyyt` 后，已通过 GitHub 的协作者权限接口确认其拥有当前仓库 `write` 权限（push=true、admin=false），可在分支规则满足后自行合并 PR。另有一条属于其他用户名的过期邀请，与 Rae 无关。

已通过 [PR #1](https://github.com/BareerahBenjamin/Pop-up-City/pull/1) 验证：62 项 Linux 测试及发布自检通过，无审批记录、未使用管理员绕过选项即正常合并；main 合并后的 CI 也成功。完整配置及证据见 [分支保护记录](branch_protection_change_v1.0.md)。

## 现有部署是否遵循文档

是，采用 [云端升级文档](../cloud_deployment_v1.0.md#已有云端数据库升级) 的核心流程：校验发布包、准备独立版本目录、隔离回归和发布自检、停机后一致性备份、校验或迁移数据库、原子切换 current、启动本站并验收。

最近一次应用发布为 2026-10-08，代码提交 `c6832ce435f03133076ee088a8599099d494a035`。2026-10-15 实际读取的线上配置如下：

| 项目 | 当前值 |
| --- | --- |
| 网站 | https://herstory.net.cn |
| current | `/opt/herstory-popup-city/releases/20261008-c6832ce` |
| 上一代码版本 | `/opt/herstory-popup-city/releases/20261008-43a0440` |
| systemd 服务 | `herstory-popup-city.service`，active |
| 运行用户 | `herstory-popup-city` |
| Node | `/opt/herstory-popup-city/runtime/bin/node`，v22.23.1 |
| 配置 | `/etc/herstory-popup-city/server.env`，root:herstory-popup-city，0640 |
| 数据库 | `/var/lib/herstory-popup-city/popup-city.sqlite` |
| 监听 | `127.0.0.1:3300` |
| 已应用迁移 | 0001–0011，共 11 项 |

该次发布与通用文档有两处具体差异：依赖清单和锁文件经逐字节比对相同，因此复制上一版的 Linux node_modules；迁移文件全部相同，因此只执行 `checkSchema`，没有重复执行 migrate。对依赖有变化的未来发布，应重新 npm ci；对新增迁移，须遵循文档先备份再增量迁移，不能照搬本次只校验结构的路径。

2026-10-12 后续执行的是域名和配置迁移，没有切换应用代码版本。当前主域名为 herstory.net.cn；仓库同步保留 [域名迁移记录](../domain_migration_v1.0.md)。2026-10-15 的 Rae 超级管理员调整只涉及现有数据库的账号权限，没有发布应用。

**信心：★★★★★。** 服务器 current、服务属性、迁移表、历史验收日志和脚本摘要与本地发布记录一致。

## 已有脚本交接

仓库归档见 [历史脚本说明](../deploy/history/README.md)。源码已与服务器文件摘要核对；未复制数据库、审计数据快照、配置内容、SMTP 密码或 SSH 密钥。

| 脚本 | 服务器原位置 | 功能与边界 |
| --- | --- | --- |
| `prepare.sh` | `/tmp/herstory-popup-city-release-20261008-c6832ce/prepare.sh` | 校验包和源码、确认上一版、准备新目录、比对迁移及依赖、Linux 回归和自检 |
| `cutover.sh` | 同目录 | 停本站、完整性审计、一致性备份、结构校验、原子切 current、启动及健康验收；失败时内置代码回退 |
| `audit.mjs` | 同目录 | 只读检查数据库完整性、外键、迁移、结构和各表摘要；不包含生产数据 |
| `migrate.py` | `/var/backups/herstory-domain-20261012/migrate.py` | 域名配置准备、应用与回退；处理 Caddyfile、Caddy 站点片段和 server.env |

上述应用脚本写死 upload、release、previous、备份名及校验条件，属于已执行发布的历史脚本，不能原样重跑或只改一个版本号就执行。`cutover.sh` 的内置回退只适用于该次无新增迁移发布；未来迁移失败不能假定旧代码兼容。现未发现独立、通用、已授权的应用部署或代码回退命令。

域名脚本的 rollback 会恢复 2026-10-12 之前的三个完整配置文件，并重启本站、reload Caddy。它不回退应用或数据库；当前域名已经变更，不能把它当作日常代码回退工具。执行前须比较后续配置差异并获得服务器负责人授权。仅交接源码，不交接受保护配置备份。

## Rae 当前服务器权限与后续授权

服务器已有 `herstory-ops` 运维账号。现有 `/etc/sudoers.d/herstory-ops` 仅允许下列三个精确命令：

```sh
sudo /usr/bin/systemctl --no-pager status herstory-popup-city.service
sudo /usr/bin/journalctl -u herstory-popup-city.service -n 100 --no-pager
sudo /usr/bin/systemctl restart herstory-popup-city.service
```

账号存在不等于已确认 Rae 持有对应 SSH 身份；须由负责人核对公钥归属。当前没有安装版本、以服务身份备份／迁移、切换 current、编辑配置或回退的授权。本次未变更 sudoers、SSH、公钥、服务、路由或生产数据。

后续固定脚本由服务器负责人审阅并安装：

1. 基于云端升级文档和归档脚本，分别定义准备、切换、回退命令；输入限定已核验的发布版本和预期上一版本。
2. 脚本由 root 持有，Rae 无法改写；规定备份路径、迁移兼容性检查、操作互斥、健康检查和审计位置。
3. 明确代码回退与数据库恢复边界。新业务已写入后，不以恢复旧库作为自动回退方式；新增迁移须单独核验旧代码兼容性。
4. 负责人批准精确 sudo 命令及 SSH 公钥，并在非生产环境演练。现有脚本交接不代表已获执行授权。

**信心：★★★★★（现有授权范围）。** 直接读取 sudoers 和服务属性；本次只做远程只读核查，未执行部署或回退。
