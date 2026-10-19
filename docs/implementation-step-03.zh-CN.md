# 第三步：报名名单分页与持久化批量签到

日期：2026-10-19。状态：本地实现及测试完成；未部署、未修改正式数据库、未构建或烧录固件。

## 已实现的业务逻辑

- 发起者自己的有效成员板才能操作自己的活动；提交时重新检查设备、成员、活动归属与服务器时间。
- 名单按报名时间、成员编号排序，同一成员兼报参与者和志愿者只出现一次。只读查询不会签到。
- 一键签到由后台取全部报名成员，不接受板子任意指定成员。设备离线或关机不影响纳入；实际提交时仍需有效绑定。创建后固定成员快照，新报名者不悄悄加入原批次；已取消报名者尚未提交时返回失败。
- 总人数不超过16，一组处理；超过16，每组最多10人。例如17人为10+7，23人为10+10+3。子组自动推进，无须重复按键；每名成员独立事务提交，避免整组回滚或长事务。
- 创建批次即落库，后台定时推进；服务重启后从数据库继续处理。每个活动同时仅一个运行批次。
- 已签到成员保留原签到时间，记为already_signed，不产生重复签到或新成功反馈。
- 单人签到与批量签到共用原子保存服务，签到事实、成长结算任务和回执保持一致。
- 单人成果失败时回滚该成员写入，其他成功保留。重试只重置失败项，成功项不重交。重试请求自身也有持久化编号防重。
- 活动结束、取消或发起者设备失效后，停止剩余成员，保留已提交成果；未处理成员仍记pending，不能误计为失败或成功。
- 所有查询反馈feedback=none，历史同步不补播亮起。实时通知与ACK消费游标仍属下一步。

## 固件接口约定

沿用设备Bearer鉴权。成功响应为{payload,signature}，payload为原始JSON字符串，包含recipient_device_id；使用现有设备签名验证方式，Cache-Control为no-store。请求编号均为小写UUID。

### GET /api/device/host/roster?activity_id=UUID&offset=0&limit=6

limit范围1–30，offset非负。返回活动信息、total、checked_count、roster_version、range_start/range_end、has_more与items。items只含成员编号、昵称、报名角色、SIGNED/PENDING及签到时间，不返回邮箱和令牌。

名单版本变化后，固件重新获取当前页并根据range校正位置；空名单范围0–0。该接口允许发起者查看自己已结束活动的名单。

### POST /api/device/host/batches

请求：batch_id、activity_id、host_confirmed:true、host_proof。

host_proof对以下数组紧凑JSON使用既有签名算法：

`["herstory-host-batch-v1",batch_id,host_device_id,activity_id,true]`

重复发送相同编号与内容返回原批次现状；同编号不同内容拒绝。活动已有运行批次返回BATCH_IN_PROGRESS。长按UP确认后，固件应先持久化batch_id再发送请求；断网不得换新编号重交。

### GET /api/device/host/batches/{batch_id}

仅原发起设备可读。用于处理进度及重连恢复，无副作用。返回：

- state：queued、running、completed、partial、failed、stopped。
- total、processed、signed、newly_signed、already_signed、failed、pending；signed包含新签与已签，processed包含成功与失败，pending是未处理人数。
- groups：子组序号、人数、已处理人数；group_size、current_group。
- attempt、stop_reason、can_retry、updated_at、feedback:none。

unknown固定0表示后台保存的成员状态没有悬空提交；网络请求结果未知仍须查询原batch_id，不表示设备可直接认为失败。stopped时应同步活动事实并返回星球；不要把pending当成可以继续签到的失败人数。

### POST /api/device/host/batches/{batch_id}/retry

请求：request_id、host_confirmed:true、host_proof。

签名数组：`["herstory-host-batch-retry-v1",request_id,batch_id,host_device_id,true]`。

仅partial/failed且活动仍进行中可重试。同request_id重发只查询同次重试，不开启新一轮；新的主动重试使用新request_id。其他批次运行时拒绝重试。

## 服务与迁移

新增0014_host_batches.sql，保存批次、成员任务和重试编号。服务监听后每200ms调度，单轮最多推进4个批次各一名成员；关闭服务时清理定时器。后台任务不依赖模拟器或浏览器保持打开。

旧local/host/batch接口为兼容既有设备保留，新固件应使用以上持久化批次接口。正式发布须先备份数据库、执行迁移，再启动新版服务；本步骤未执行这些正式操作。

## 验证与剩余工作

新增21项测试，覆盖0/1/10/16/17/20/23人分组、离线设备、名单去重、签名与越权、请求防重、已有签到、设备撤销、成员取消报名、保存故障原子回滚、部分重试、活动中途结束/取消、数据库重开恢复、迁移保留历史数据和HTTP后台自动推进。

全量npm test：116项通过，0失败。发布自检通过（14项迁移、名字位图、星球RGB565输出），git diff --check通过。

下一步：接入实时签到通知、ACK与恢复游标，保证在线成员亮起1秒、重复通知不重复亮、离线历史结果不补播；之后才进行网站联调、固件接入和实机验收。
