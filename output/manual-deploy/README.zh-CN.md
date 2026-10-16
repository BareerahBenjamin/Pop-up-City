# Herstory 手动部署工具 v2

仅使用 install-herstory-tools-v2.sh，旧版 install-herstory-tools.sh 已停用。

## 给服务器负责人的操作

1. 将 install-herstory-tools-v2.sh 上传到服务器 /tmp/install-herstory-tools-v2.sh。
2. 复制执行：

```bash
printf '%s\n' 'a12151ad346d2ce1379d13ca8142bac11e6f2e807cdab5e9f54930e7e66084d7  /tmp/install-herstory-tools-v2.sh' | sha256sum -c -
```

只有显示 OK 才执行：

```bash
sudo bash /tmp/install-herstory-tools-v2.sh
```

脚本先在受限账号和 systemd 临时环境中执行自动测试，用合成的临时 SQLite 数据和服务器实际旧版 database.js 验证升级及旧代码兼容性。禁止访问生产数据库/配置，禁用测试网络。测试失败时不授予发布权限，并撤销本次创建的账号和工具；把终端输出发回即可，不需要自行排查。

成功标记：HERSTORY_INSTALL_OK。

安装过程不部署、不升级正式数据库、不切换 current、不重启网站、不修改 Caddy。会创建隔离构建账号、工具、管理记录目录和精确 sudo 授权。已有同名工具/账号/目录时停止，不覆盖。

## 实际发布的流程

工具入口：

```bash
sudo /usr/local/sbin/herstory-deploy VERSION SHA256
sudo /usr/local/sbin/herstory-rollback
```

发布包固定在 /home/herstory-ops/releases-upload/VERSION.tar.gz，必须归 herstory-ops 所有。VERSION 为字母数字开头，后续仅字母数字、横线和下划线，总长度不超过80。

输入检查→操作锁→固定暂存→安全解包→非root安装依赖/测试/自检→锁定构建产物→备份→在数据库副本预演新增迁移→分别用线上旧代码与新代码校验副本→停本站→再次备份→事务升级→原子切换→健康检查。

只允许本包审阅并固定摘要的 0012_cloud_hardware.sql 和 0013_device_claims.sql；它们只增加表与索引。旧迁移内容变化、其他新迁移一律拒绝。其他未来迁移需要更新工具，不能擅自放开限制。

数据库备份、迁移和生产检查以 herstory-popup-city 身份执行，避免产生 root 所有的生产 WAL 文件。只有安装工具中的固定 SQL 被应用，不以 root 执行上传包中的应用代码。

失败时尝试恢复旧代码，不恢复旧数据库。已提交的新增表保留，避免丢失新业务数据；事务本身失败时回滚该次事务。若数据库检查失败、断电、SIGKILL或恢复旧代码也失败，需要负责人根据日志处理，不能承诺任意故障自动恢复。

回退限最近一次此工具成功发布，且 current 未被其他人手工修改。上线后的业务数据保留。

## 验证范围

本地已完成19项测试，涵盖真实SQLite增量升级、保留原成员、事务失败撤销、重复升级、Node新旧 schema 校验、备份、防路径越界、参数拒绝和模拟服务失败处理。
本地是macOS，尚未在Linux执行。Linux/systemd支持与上述隔离测试会在安装时自动验证。它不等于完整生产端到端验收；首次正式发布仍须检查网页登录、签到、交友和设备接口。

## 日志、备份及协作

日志和版本记录：/var/lib/herstory-deploy/（管理员可读）。
备份：/var/lib/herstory-popup-city/backup-manual-*.sqlite（服务用户所有、0600）。
公网健康地址：https://herstory.net.cn/healthz。

SHA256证明包内容匹配，不证明GitHub来源；发布前需核对原仓库main、Git提交和CI。此工具不自动提交、合并或部署GitHub代码。
原负责人若继续手工部署，不会自动取得此工具的锁，双方仍需约定发布时间。失败目录、历史版本和备份不会自动删除。
