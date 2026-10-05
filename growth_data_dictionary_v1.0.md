# 成长系统数据字典

- **版本：** v1.0
- **负责人：** 技术实施
- **状态：** 与 0004_growth_system.sql 的实测 SQLite schema 同步
- **最后更新：** 2026-10-01

字段及外键由临时数据库应用迁移后导出。SQL 为执行源；全部时间采用 Unix 秒，业务 ID 使用 TEXT。PK 顺序表示复合主键中的位置。CHECK、触发器及业务唯一键详见 [架构与约束说明](growth_architecture_v1.0.md)。

## programs · 期数

|字段|SQLite 类型|必填|PK 顺序|默认值|用途|
|---|---|---|---|---|---|
|`id`|TEXT|是|1|—|稳定 ID（TEXT）；不能复用给另一业务对象|
|`name`|TEXT|是|—|—|展示名称|
|`starts_at`|INTEGER|是|—|—|开始时刻，Unix 秒|
|`ends_at`|INTEGER|是|—|—|结束时刻，Unix 秒，晚于开始|
|`timezone`|TEXT|是|—|`'Asia/Shanghai'`|期数时区标识，默认 Asia/Shanghai|
|`status`|TEXT|是|—|`'draft'`|生命周期或审核状态，枚举见迁移 SQL|
|`created_at`|INTEGER|是|—|—|创建时刻，Unix 秒|
|`updated_at`|INTEGER|是|—|—|最近变更时刻，Unix 秒|

## activity_types · 活动类型

|字段|SQLite 类型|必填|PK 顺序|默认值|用途|
|---|---|---|---|---|---|
|`id`|TEXT|是|1|—|稳定 ID（TEXT）；不能复用给另一业务对象|
|`name`|TEXT|是|—|—|展示名称|
|`category`|TEXT|是|—|—|稳定大类代码，不依赖 events.category 自由文本|
|`world_area`|TEXT|是|—|—|成长世界区域代码|
|`enabled`|INTEGER|是|—|`1`|1 启用、0 停用|
|`created_at`|INTEGER|是|—|—|创建时刻，Unix 秒|

## growth_rules · 版本化规则

|字段|SQLite 类型|必填|PK 顺序|默认值|用途|
|---|---|---|---|---|---|
|`rule_id`|TEXT|是|1|—|稳定规则标识，与版本构成复合引用|
|`rule_version`|INTEGER|是|2|—|正整数规则版本，写入账本后不追溯改变|
|`type_id`|TEXT|是|—|—|引用活动类型；正式 ACT 目录尚未灌入|
|`event_kind`|TEXT|是|—|—|activity / long_term_project / opening / closing|
|`name`|TEXT|是|—|—|展示名称|
|`definition_json`|TEXT|是|—|—|规则定义 JSON 对象；正式 schema 与内容待产品定稿|
|`created_by`|TEXT|是|—|—|服务端记录的管理员成员 ID，不能信任前端自报|
|`created_at`|INTEGER|是|—|—|创建时刻，Unix 秒|

外键（相同编号属于一个复合外键；所有外键均不级联删除）：

|组|当前字段|目标表.字段|
|---|---|---|
|0|`created_by`|`members.id`|
|1|`type_id`|`activity_types.id`|

## event_growth_config · 活动成长配置

|字段|SQLite 类型|必填|PK 顺序|默认值|用途|
|---|---|---|---|---|---|
|`event_id`|TEXT|是|1|—|现有 events.id；等价外部 session_id|
|`program_id`|TEXT|是|—|—|期数 ID，用于隔离每期积分与资产|
|`type_id`|TEXT|是|—|—|引用活动类型；正式 ACT 目录尚未灌入|
|`event_kind`|TEXT|是|—|—|activity / long_term_project / opening / closing|
|`rule_id`|TEXT|是|—|—|稳定规则标识，与版本构成复合引用|
|`rule_version`|INTEGER|是|—|—|正整数规则版本，写入账本后不追溯改变|
|`configured_by`|TEXT|是|—|—|配置该活动映射的管理员 ID|
|`created_at`|INTEGER|是|—|—|创建时刻，Unix 秒|

外键（相同编号属于一个复合外键；所有外键均不级联删除）：

|组|当前字段|目标表.字段|
|---|---|---|
|0|`rule_id`|`growth_rules.rule_id`|
|0|`rule_version`|`growth_rules.rule_version`|
|0|`type_id`|`growth_rules.type_id`|
|0|`event_kind`|`growth_rules.event_kind`|
|1|`configured_by`|`members.id`|
|2|`type_id`|`activity_types.id`|
|3|`program_id`|`programs.id`|
|4|`event_id`|`events.id`|

## host_completions · 发起完成核验

|字段|SQLite 类型|必填|PK 顺序|默认值|用途|
|---|---|---|---|---|---|
|`id`|TEXT|是|1|—|稳定 ID（TEXT）；不能复用给另一业务对象|
|`event_id`|TEXT|是|—|—|现有 events.id；等价外部 session_id|
|`member_id`|TEXT|是|—|—|现有 members.id；等价外部 user_id|
|`evidence_json`|TEXT|是|—|`'{}'`|内部核验或贡献证据 JSON 对象|
|`status`|TEXT|是|—|`'pending'`|生命周期或审核状态，枚举见迁移 SQL|
|`verified_by`|TEXT|否|—|—|非被核验本人的管理员 ID|
|`verified_at`|INTEGER|否|—|—|审核时刻，Unix 秒；pending 时为空|
|`review_note`|TEXT|是|—|`''`|审核或撤销理由|
|`created_at`|INTEGER|是|—|—|创建时刻，Unix 秒|
|`updated_at`|INTEGER|是|—|—|最近变更时刻，Unix 秒|

外键（相同编号属于一个复合外键；所有外键均不级联删除）：

|组|当前字段|目标表.字段|
|---|---|---|
|0|`verified_by`|`members.id`|
|1|`member_id`|`members.id`|
|2|`event_id`|`event_growth_config.event_id`|

## volunteer_completions · 志愿履约核验

|字段|SQLite 类型|必填|PK 顺序|默认值|用途|
|---|---|---|---|---|---|
|`id`|TEXT|是|1|—|稳定 ID（TEXT）；不能复用给另一业务对象|
|`event_id`|TEXT|是|—|—|现有 events.id；等价外部 session_id|
|`member_id`|TEXT|是|—|—|现有 members.id；等价外部 user_id|
|`evidence_json`|TEXT|是|—|`'{}'`|内部核验或贡献证据 JSON 对象|
|`status`|TEXT|是|—|`'pending'`|生命周期或审核状态，枚举见迁移 SQL|
|`verified_by`|TEXT|否|—|—|非被核验本人的管理员 ID|
|`verified_at`|INTEGER|否|—|—|审核时刻，Unix 秒；pending 时为空|
|`review_note`|TEXT|是|—|`''`|审核或撤销理由|
|`created_at`|INTEGER|是|—|—|创建时刻，Unix 秒|
|`updated_at`|INTEGER|是|—|—|最近变更时刻，Unix 秒|

外键（相同编号属于一个复合外键；所有外键均不级联删除）：

|组|当前字段|目标表.字段|
|---|---|---|
|0|`verified_by`|`members.id`|
|1|`member_id`|`members.id`|
|2|`event_id`|`event_growth_config.event_id`|

## project_submissions · 长期项目贡献

|字段|SQLite 类型|必填|PK 顺序|默认值|用途|
|---|---|---|---|---|---|
|`id`|TEXT|是|1|—|稳定 ID（TEXT）；不能复用给另一业务对象|
|`event_id`|TEXT|是|—|—|现有 events.id；等价外部 session_id|
|`member_id`|TEXT|是|—|—|现有 members.id；等价外部 user_id|
|`contribution_key`|TEXT|是|—|—|稳定交付件／里程碑去重键，不是随机重试 key|
|`title`|TEXT|是|—|—|贡献标题|
|`evidence_json`|TEXT|是|—|`'{}'`|内部核验或贡献证据 JSON 对象|
|`status`|TEXT|是|—|`'pending'`|生命周期或审核状态，枚举见迁移 SQL|
|`verified_by`|TEXT|否|—|—|非被核验本人的管理员 ID|
|`verified_at`|INTEGER|否|—|—|审核时刻，Unix 秒；pending 时为空|
|`review_note`|TEXT|是|—|`''`|审核或撤销理由|
|`created_at`|INTEGER|是|—|—|创建时刻，Unix 秒|
|`updated_at`|INTEGER|是|—|—|最近变更时刻，Unix 秒|

外键（相同编号属于一个复合外键；所有外键均不级联删除）：

|组|当前字段|目标表.字段|
|---|---|---|
|0|`verified_by`|`members.id`|
|1|`member_id`|`members.id`|
|2|`event_id`|`event_growth_config.event_id`|

## asset_definitions · 资产定义

|字段|SQLite 类型|必填|PK 顺序|默认值|用途|
|---|---|---|---|---|---|
|`id`|TEXT|是|1|—|稳定 ID（TEXT）；不能复用给另一业务对象|
|`name`|TEXT|是|—|—|展示名称|
|`asset_kind`|TEXT|是|—|—|资产类别代码，例如建筑／伙伴；正式目录未灌入|
|`slot_key`|TEXT|是|—|—|资产槽位代码；不等于已装备位置|
|`metadata_json`|TEXT|是|—|`'{}'`|资产展示元数据 JSON 对象，不应含秘密|
|`created_at`|INTEGER|是|—|—|创建时刻，Unix 秒|

## reward_ledger · 奖励账本

|字段|SQLite 类型|必填|PK 顺序|默认值|用途|
|---|---|---|---|---|---|
|`id`|TEXT|是|1|—|稳定 ID（TEXT）；不能复用给另一业务对象|
|`member_id`|TEXT|是|—|—|现有 members.id；等价外部 user_id|
|`event_id`|TEXT|是|—|—|现有 events.id；等价外部 session_id|
|`program_id`|TEXT|是|—|—|期数 ID，用于隔离每期积分与资产|
|`rule_id`|TEXT|是|—|—|稳定规则标识，与版本构成复合引用|
|`rule_version`|INTEGER|是|—|—|正整数规则版本，写入账本后不追溯改变|
|`source_kind`|TEXT|是|—|—|checkin / host / volunteer / project 四选一|
|`checkin_event_id`|TEXT|否|—|—|签到来源的活动 ID，与 event_id 相同，并与 member_id 共同外键关联签到|
|`host_completion_id`|TEXT|否|—|—|发起完成核验来源 ID|
|`volunteer_completion_id`|TEXT|否|—|—|志愿履约核验来源 ID|
|`project_submission_id`|TEXT|否|—|—|长期贡献来源 ID|
|`metric`|TEXT|否|—|—|P / H / V / M；资产发放行必须为空|
|`asset_id`|TEXT|否|—|—|资产定义 ID；指标奖励行必须为空|
|`asset_level`|INTEGER|否|—|—|正整数资产等级；指标奖励行必须为空|
|`amount`|INTEGER|是|—|—|指标增量；资产发放 +1、冲正 -1；无现金含义|
|`reversal_of`|TEXT|否|—|—|被冲正的原正向账本 ID；全表唯一，一次完整冲正|
|`idempotency_key`|TEXT|是|—|—|服务端生成或验证的唯一请求效果键；还受独立业务唯一键约束|
|`reason`|TEXT|是|—|—|结算／冲正原因，不允许空白|
|`calculation_json`|TEXT|是|—|—|服务端计算输入与结果摘要 JSON，避免存敏感全文|
|`created_by`|TEXT|是|—|—|服务端记录的管理员成员 ID，不能信任前端自报|
|`created_at`|INTEGER|是|—|—|创建时刻，Unix 秒|

外键（相同编号属于一个复合外键；所有外键均不级联删除）：

|组|当前字段|目标表.字段|
|---|---|---|
|0|`project_submission_id`|`project_submissions.id`|
|0|`event_id`|`project_submissions.event_id`|
|0|`member_id`|`project_submissions.member_id`|
|1|`volunteer_completion_id`|`volunteer_completions.id`|
|1|`event_id`|`volunteer_completions.event_id`|
|1|`member_id`|`volunteer_completions.member_id`|
|2|`host_completion_id`|`host_completions.id`|
|2|`event_id`|`host_completions.event_id`|
|2|`member_id`|`host_completions.member_id`|
|3|`checkin_event_id`|`checkins.event_id`|
|3|`member_id`|`checkins.member_id`|
|4|`event_id`|`event_growth_config.event_id`|
|4|`program_id`|`event_growth_config.program_id`|
|4|`rule_id`|`event_growth_config.rule_id`|
|4|`rule_version`|`event_growth_config.rule_version`|
|5|`created_by`|`members.id`|
|6|`reversal_of`|`reward_ledger.id`|
|7|`asset_id`|`asset_definitions.id`|
|8|`member_id`|`members.id`|

## user_assets · 最终资产投影

|字段|SQLite 类型|必填|PK 顺序|默认值|用途|
|---|---|---|---|---|---|
|`member_id`|TEXT|是|1|—|现有 members.id；等价外部 user_id|
|`program_id`|TEXT|是|2|—|期数 ID，用于隔离每期积分与资产|
|`asset_id`|TEXT|是|3|—|资产定义 ID；指标奖励行必须为空|
|`asset_level`|INTEGER|是|—|—|正整数资产等级；指标奖励行必须为空|
|`source_ledger_id`|TEXT|是|—|—|支撑当前等级的未冲正资产发放账本 ID|
|`updated_at`|INTEGER|是|—|—|最近变更时刻，Unix 秒|

外键（相同编号属于一个复合外键；所有外键均不级联删除）：

|组|当前字段|目标表.字段|
|---|---|---|
|0|`source_ledger_id`|`reward_ledger.id`|
|0|`member_id`|`reward_ledger.member_id`|
|0|`program_id`|`reward_ledger.program_id`|
|0|`asset_id`|`reward_ledger.asset_id`|
|0|`asset_level`|`reward_ledger.asset_level`|

## member_growth_totals · 汇总视图

|字段|含义|
|---|---|
|member_id|成员 ID|
|program_id|期数 ID|
|metric|P/H/V/M|
|total|SUM(amount)，已含冲正；无行不等于不存在该成员，API 可补零|

**信心：★★★★★。** 字段列表来自实际 SQLite PRAGMA，未把接口提案当成已实现路由。
