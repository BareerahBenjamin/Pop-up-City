# main 分支保护变更记录

- **版本：** v1.0
- **负责人：** Herstory 仓库维护者
- **状态：** 分支保护和 CI 已生效；PR 与 main 的 Linux CI 均通过，零他人审批正常合并已验证
- **最后更新：** 2026-10-15（Asia/Hong_Kong）

## 核查基线

仓库 BareerahBenjamin/Pop-up-City，default_branch 为 main，当前管理身份具备 ADMIN。main 原为 protected=false；传统保护接口返回 Branch not protected；Rulesets（包含父级）和有效分支规则列表均为空；Actions 已启用，但工作流列表为空。

## 生效设置

| 设置 | 值 |
| --- | --- |
| Require a pull request before merging | 启用 |
| Require status checks | GitHub Actions 的 test |
| Require branches to be up to date | 启用 |
| Required approving reviews | 0 |
| Require Code Owner reviews | 关闭 |
| Require approval of the most recent push | 关闭 |
| Include administrators | 启用 |
| Force pushes / branch deletion | 禁止 |

采用传统分支保护实现，无需增加重叠 Ruleset。保留仓库所有者权限，不更改协作者角色；已根据用户提供的用户名确认 Rae（`whyyt`）具备 `write` 权限。

**信心：★★★★★（核查基线）。** 依据实时 GitHub API 返回，不以本地缓存或网页按钮推断。

## 生效核验

2026-10-15 PUT 与回读确认：required_approving_review_count=0，require_code_owner_reviews=false，require_last_push_approval=false，required_status_checks.contexts=[test]，strict=true，enforce_admins.enabled=true；force push 和删除分支均为 false。Rulesets 仍为空。GitHub CLI 的 workflow 授权已由用户在官方页面完成。必需的 test 绑定 GitHub Actions（app_id=15368），防止同名的其他来源替代实际 CI。


## 合并与 CI 证据

[PR #1](https://github.com/BareerahBenjamin/Pop-up-City/pull/1) 已于 2026-10-15 20:35:46（Asia/Hong_Kong）正常 squash 合并；没有使用管理员绕过选项，API 返回 reviews=[]。合并提交为 `80fe20808f7057207a8aa4476596da0a3abeb17e`。

- [PR 的 Linux CI](https://github.com/BareerahBenjamin/Pop-up-City/actions/runs/38735568152)：62 项测试全部通过，发布自检 status=ok、sharp=ok，Node v22.23.1。
- [main 首轮 CI](https://github.com/BareerahBenjamin/Pop-up-City/actions/runs/38735852098)：合并后的 test 与发布自检均成功。
- 最终回读：审批数 0、Code Owner=false、最近推送审批=false，test 必需、strict=true、enforce_admins=true；Rulesets 为空。

公开 PR 仅包含 CI、README 和协作决策记录。服务器内部部署／回退脚本保留在本地交接包，没有推送到公开 GitHub。此次没有部署网站、重启服务或扩大服务器权限。

**信心：★★★★★（生效与合并验证）。** GitHub API 回读、无审批记录的正常合并，以及 PR／main 两次实际 CI 结果一致。
