# 正式域名迁移记录

- **版本：** v1.0
- **负责人：** 网站／数据库／后台负责人
- **状态：** 已上线；公网基础验证通过；真实登录投递与真机待验收
- **最后更新：** 2026-10-12（Asia/Hong_Kong）

## 结果与原因

用户因 kunyuan.site 备案未完成，指定正式域名改为 **https://herstory.net.cn**。新域名和 www 原已解析至 152.136.224.197；腾讯云公开查询返回 GovStatus=true、LandedStatus=true、Ban=false，HTTPS 校验正常。本次不修改 DNS。

将 herstory.net.cn 的旧意向申请首页替换为现有活动网站，Caddy 兜底路由转发至 127.0.0.1:3300。原静态文件仍保留在 `/srv/herstory.net.cn/current`，原 TLS 配置、`/workshop/common-sense/*`、www 跳转与 lm.herstory.net.cn 路由保留。设备 API 不开启响应压缩。

PUBLIC_ORIGIN 改为 https://herstory.net.cn，使同源检查、登录邮件链接和活动二维码采用新域名。旧域名配置改为保留路径的 308 跳转，但其备案拦截仍可能发生在请求到达 Caddy 之前，因此对外必须直接使用新域名。

## 数据与登录

只修改 `/etc/caddy/Caddyfile`、`/etc/caddy/herstory-popup-city.caddy` 和 `/etc/herstory-popup-city/server.env` 中的 PUBLIC_ORIGIN。未执行数据库迁移或业务数据写入，未替换代码发布目录、SMTP 或认证密钥；current 仍指向 `/opt/herstory-popup-city/releases/20261008-c6832ce`。

仅重启 herstory-popup-city，Caddy 平滑 reload。Caddy、Workshop 和 PM2 主进程 PID 与 lm.herstory.net.cn 配置摘要保持一致。成员需要在新域名重新登录；硬件更改服务器 base URL 后继续使用原 device_id 和 token，不依赖旧域名跳转。

## 验证

| 项目 | 结果 |
| --- | --- |
| Caddy 完整候选配置与应用配置 | 切换前验证通过；切换后完整配置再次验证通过 |
| 公网首页、登录页、公开活动接口 | HTTP 200 |
| 首页引用的 18 个静态资源 | 全部 HTTP 200 |
| 公网 /healthz | HTTP 200，status=ok，mail_configured=true |
| www | 301 跳转至 https://herstory.net.cn/ |
| Workshop 页面 | 切换前后均 HTTP 200 |
| 新域名 Origin + 空登录请求 | 400 邮箱不合法，已通过来源检查 |
| 旧域名 Origin + 同样请求 | 403 请求来源不允许 |
| 无凭证访问个人星球与设备元数据 | 均为预期 HTTP 401 |

**信心：★★★★★（配置切换与已列出的公网检查）；★★★☆☆（完整用户流程）。** 未发送真实登录邮件、使用真实会话或设备令牌；尚未完成 Safari 真机和真实硬件端到端验收。mail_configured=true 不等于已确认邮件送达。

## 备份与回退

服务器备份目录：`/var/backups/herstory-domain-20261012`，权限 0700。含三个原配置文件、候选配置、校验基线与 applied.json。server.env 含凭据，禁止下载到公开目录或提交版本库。

服务器执行 `sudo python3 /var/backups/herstory-domain-20261012/migrate.py rollback` 可恢复原配置，重启本站并平滑加载 Caddy。脚本恢复全部三个配置文件；若此后有新配置变更，先比较差异，不能直接回退覆盖。回退不会修改数据库，也不能解除旧域名的备案拦截。
