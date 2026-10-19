# 第二步：设备运行状态与断网后回执查询

日期：2026-10-19。状态：本地实现及回归测试完成；未部署、未修改正式数据、未构建或烧录固件。

## 新增接口

### GET /api/device/runtime

使用现有设备Bearer认证，响应沿用{payload,signature}，签名payload含recipient_device_id，Cache-Control: no-store。未绑定/撤销/成员停用返回401，专用旧签到板返回403。

- protocol_version=1；server_time为UTC Unix秒；poll_after_ms=5000是首版建议轮询参数。
- identity：设备/成员编号、昵称、绑定版本、名字版本及user类型。不返回邮箱、令牌、原始头像。
- planet：复用现有星球身份、配色、revision、state_version、ai_stage、house_unlocked、lake_unlocked。不编码/下载整帧，不返回完整好友名单。首次必要时复用现有星球初始化/结算逻辑。
- host：当前已发布且开始<=服务器时间<结束的本人发起活动、未来7日近期活动（最多16条并提供truncated）。活动含名称、起止时间、状态、人数、签到数、名单版本和内容版本。
- 同一活动兼报参与者/志愿者时人数按成员去重。名单仅计算版本和统计，不在runtime返回全员身份。
- 历史数据若存在多个当前活动，schedule_conflict=true、can_check_in=false、active_activity_id=null，避免替设备随机选择。
- registrations：当前成员未来/进行中的活动报名与本人成员签到结果，最多32条，截断明示。
- 可传known_activity_id：本人发起或确已报名的已知活动，补查修改、结束、取消状态；未知或无权访问均返回null，不泄露他人活动。参与者不获得他人的名单统计和版本。
- facts_version不包含server_time，只在事实变化时变化。活动起止时间跨界即使数据库没写入，也会改变返回事实。
- recovery：先查未决操作再新提交；历史签到不触发成功亮起；给出回执查询URL模板。

设备把这些事实与本地页面状态结合：断网优先配网；重连先同步和核对；活动结束/取消不恢复过期签到。接口不替固件决定Hello/动画/OK停留。

### GET /api/device/operations/{interaction_id}

使用同样设备鉴权、接收设备签名和no-store。查询现有hardware_interactions、hardware_host_receipts的持久回执，不受短会话90秒清理期限影响。

- state=saved：仅实际交友双方、签到发起者或对应参与者可读取自己的回执；返回原receipt，不重复写业务事实。
- state=unknown：没有可授权读取的持久回执；may_retry_as_new=false。不能据此宣称失败或直接换新操作ID重交。
- feedback=none：恢复历史回执不补播成功亮起。
- 只支持现有friend、checkin、host_checkin；批量批次持久化查询及实时通知/ACK游标在后续步骤实现，不伪装已有。
- 非GET返回405，错误UUID返回400；他人已存在和不存在操作统一unknown，避免泄漏存在性。

## 事务与权限

快照读取、身份复核和必要星球版本更新在同一无await事务内。即使认证后设备被撤销，事务内再次复核，不能继续查询。host.can_check_in只是状态提示，不代替提交时重新授权与活动时间校验。

## 验证

新增10项测试通过；全量npm test：95项通过，0失败。覆盖签名/接收者、稳定版本、时间边界、活动修改取消、报名签到版本、隐私、越权、撤销/停用、旧重叠活动、列表截断、超过会话期限回执恢复和unknown不误判失败。

node --check、git diff --check通过。未新增数据库迁移；未执行浏览器或设备验收。

## 下一步

发起者报名总名单分页接口、单人签到共享服务及持久化批次；批量<=16人一批、>16每子批最多10人，含离线报名成员；实时通知与消费游标后续独立接入。
