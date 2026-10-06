# AI Passport 硬件与星球接口

- **版本：** v1.0
- **负责人：** 网站／后台负责人；固件与星球团队共同联调
- **状态：** A 后端本地实现并测试；新增确认凭据为联调契约，固件尚未接入
- **最后更新：** 2026-10-06

## 边界与当前能力

A 是主活动后台，持有统一 User ID、设备绑定、报名、签到和好友事实。B 的固定提交渲染代码在 A 进程内调用，未另部署 HTTP 渲染服务。网站只显示 3D；2D 像素状态与 RGB565 画面只由设备接口提供。附图中“更新网页 2D”的描述由用户最新要求覆盖。

**Confidence：★★★★★。** 后端隔离测试与浏览器验证通过；不等于 BLE、Wi-Fi、屏幕和真机完成验收。

签到成功表示服务器已保存签到；已启用规则并绑定的活动在同一事务内结算3D成长，回执 `growth_status:settled`。`pending_rules` 表示该活动尚未绑定奖励，任务会保留待补结算。已映射活动的硬件 AI 树／娱乐湖采用 B 的现有像素规则；网页3D按本人资产清单展示，真实好友会点亮。

## 身份、确认与字段约定

所有设备请求使用 HTTPS 和 `Authorization: Bearer <64位小写十六进制令牌>`。管理员沿用网站登录 Cookie 与同源 Origin。设备绑定后禁止转移归属或修改令牌；换板时撤销旧设备并绑定新 Device ID。已撤销或所属账号停用的设备不能提交，包括旧事件补传。

设备、用户、活动、交互 ID 均为小写 UUID。时间是 Unix 秒，服务器保存 `received_at`；设备 `occurred_at` 是声明时间，不能当作可信历史签到时间。交友可离线补传，关系建立时间采用服务器首次接收时间。签到必须在线，确认在 300 秒内，活动窗口沿用现有政策：`starts_at-3600 <= 服务器时间 < starts_at`，同时满足签到板授权窗口。

四位码用于人眼比对。仅有 `confirmed:true` 不能让 A 验证另一块用户板是否同意，因此新版增加以下凭据，硬件团队需实现后联调：

- 每块用户板从自己的令牌派生 `K = SHA256(令牌的 ASCII 字节)`，使用原始 32 字节摘要作 HMAC 密钥。
- `nonce` 为每次碰一碰生成的 16 随机字节，编码为 32 位小写 hex；确认码是四字符字符串，保留前导零。
- 各板按下 OK 后计算 `HMAC-SHA256(K, UTF8(JSON.stringify(规范数组)))`，结果为 64 位小写 hex。数组无空白，布尔值为 JSON true，时间为整数；不得改变元素顺序。
- BLE 只交换设备身份、显示名称、规范事件字段与证明。不得交换令牌或 K。A 中已有 token_hash 相当于确认验证密钥，数据库保持机密。
- 显示名称来自 BLE 仅供当地展示。服务器从绑定和已保存个人资料解析名字，不采信上传 User ID 或昵称。

## 签到板提交

`POST /api/device/checkin-events`，Bearer 必须对应 `station_device_id` 且该设备类型为 checkin。

```json
{
  "interaction_id": "11111111-1111-4111-8111-111111111111",
  "activity_id": "22222222-2222-4222-8222-222222222222",
  "station_device_id": "33333333-3333-4333-8333-333333333333",
  "user_device_id": "44444444-4444-4444-8444-444444444444",
  "occurred_at": 1792350000,
  "nonce": "00112233445566778899aabbccddeeff",
  "confirmation_code": "0007",
  "user_confirmed": true,
  "user_proof": "<用户板计算的64位hex证明>"
}
```

证明规范数组：

```js
["herstory-hardware-v1", "checkin", interaction_id, station_device_id,
 user_device_id, activity_id, nonce, confirmation_code, occurred_at, true]
```

A 校验设备、证明、活动、签到板权限、报名和窗口；在同一事务中保存签到、来源、待结算任务、星球快照版本和回执。相同交互 ID／业务内容重传返回原回执，包括活动关闭后的重传；修改业务内容返回 409 `EVENT_ID_CONFLICT`。同一用户同一活动换交互 ID 再次签到返回 `duplicate:true`，不会再新增签到或结算任务。

成功回执字段：`receipt_id, interaction_id, status:"checked_in", user_id, activity_id, checked_at, duplicate, planet_revision, growth_status:"settled"或"pending_rules", user_receipt_proof`。签到板通过 BLE 原样转发。用户板验证回执属于当前 interaction_id／activity_id，并验证以下规范数组的 HMAC 后才显示“签到成功”：

```js
["herstory-receipt-v1", receipt_id, interaction_id, status, user_id,
 activity_id, checked_at, duplicate, planet_revision, growth_status]
```

任何 HTTP 错误、超时或证明失败只能显示失败／待重试。回执丢失时使用原事件重试，不能新建交互 ID 当作已成功签到。

## 用户板交友补传

`POST /api/device/friend-events`。先将两个 Device ID 按字符串升序排序成 a、b，双方使用同一交互 UUID、nonce、四位码和时间，分别签名：

```js
["herstory-hardware-v1", "friend", interaction_id, device_a_id,
 device_b_id, nonce, confirmation_code, occurred_at, true, true]
```

JSON 字段：`interaction_id, device_a_id, device_b_id, occurred_at, nonce, confirmation_code, a_confirmed:true, b_confirmed:true, a_proof, b_proof`。任一参与板可携带双方证明上传；其他用户板和签到板均被拒绝。两块设备必须属于不同用户。

首次返回 `status:"connected", friendship_id, established_at, duplicate:false, planets:[{user_id,revision},...]` 及回执 ID。原事件双方重复上传返回同一回执；同一用户对的新交互事件只返回现有好友关系 `duplicate:true`。Friendship 以排序后的两个 User ID 唯一，设备更换不会创建第二条关系。网页和个人记录都可读到双方关系。

固件 `event_save` 须保存完整事件与双方证明，上传成功后标记已同步。没联网时只显示“本地交友成功”；不得把它显示成服务器已同步。网络／5xx 错误保留事件并退避重试；400／403／409 需要提示失败原因，不能无限新建事件。签到板不代理交友上传。

## 硬件画面同步

1. `GET /api/device/planet/version`：认证后只读取自己的星球。返回 `version, planet_revision, state_version, width:240, height:320, format:"RGB565", byte_order, sha256, byte_length:153600, chunk_size:4096, frame_url, render_version`。
2. 未配置 byte_order 返回 409 `BYTE_ORDER_REQUIRED`。支持 little／big；不能仅依据 RGB565 名称猜字节序。本地 BSP 的 LVGL 与直接 SPI 路径不同，需要固件确认最终接收路径。
3. A 在版本查询时读取一致事实，调用 B 的像素规则和渲染函数，保存不可变整帧，再返回该帧的真实 SHA256。不是先发布一个尚未渲染完成的哈希。
4. 本地已显示版本一致时不请求二进制。变化时用 metadata 中固定 `frame_url` 下载：`GET /api/device/planet/frames/7?offset=0&length=4096`。
5. 每块返回 HTTP 206、原始 RGB565 字节、Content-Range、X-Frame-Version、X-Frame-SHA256 和 X-RGB565-Byte-Order。偏移和长度必须偶数；每次最多 16384 字节；最后一块自动缩短。服务端用 SQLite substr 读取一块，无需为每次请求加载整帧。
6. 下载中星球更新也继续使用原版本 URL，绝不混入新画面。版本属于本人；另一用户的版本无法读取。格式、字节序或内容变化会生成更高版本；原帧保留用于重试。
7. 固件边收边计算整帧 SHA256。全部 153600 字节校验通过后才保存本地已显示版本。失败保留旧版本号，重试整帧；如果直接写屏，部分画面已经可见，校验本身无法避免临时花屏。需用持久缓存／刷新提示决定真机显示策略。
8. 可选 `POST /api/device/planet/displayed`，JSON `{ "version": 7, "sha256": "<metadata中的哈希>" }` 记录设备确认。错误哈希和回退版本返回 409。

## 管理员配置

先使用已有 `POST /api/admin/members/:user_id/devices` 绑定并写入设备令牌，然后配置：

| 接口 | JSON／结果 |
| --- | --- |
| `PUT /api/admin/devices/:device_id/hardware` | `{device_kind:"user",rgb565_byte_order:"little"}` 或 `{device_kind:"checkin"}`；类型配置后不可变 |
| `PUT /api/admin/checkin-stations/activities` | `{station_device_id,activity_id,opens_at,closes_at,revoked:false}`；revoked:true 撤销 |
| `GET /api/admin/planet/activity-mappings` | 返回 B 的目录 ID／标题／类型与已配置映射 |
| `PUT /api/admin/planet/activity-mappings` | `{catalog_activity_id:"a2",activity_id:"网站活动UUID"}`；必须使用真实活动，不能按标题猜测 |

未配置类型的原有板默认为 user，旧接口保持兼容；已经作为用户板留下交互记录的设备不能改成签到板。签到板拒绝所有个人接口。管理员配置现在由 API 提供，尚未增加网页配置表单。

## 新增数据表与尚待接入

0009 增加 `device_hardware_profiles`、`checkin_station_activities`、`hardware_interactions`、`hardware_checkin_sources`、`friendships`、`planet_activity_catalog_map`、`planet_settlement_tasks`、`hardware_pixel_states`、`hardware_planet_frames`、`device_planet_displays`。原 devices、checkins 列结构保留，历史数据不重写。好友和签到事实、回执、版本同事务提交，异常全部回滚。

硬件像素状态存储：`paletteId, aiCheckinCount, aiStage, lakeUnlocked, ruleVersion, friendIds, stateVersion`。规则来自固定提交：AI 活动按统一网站活动 ID 去重、树阶段最多 6；娱乐有效签到解锁湖。取消／未发布活动不参与像素成长。状态在设备查询时投影保存，不是独立身份来源。friendIds 已预留；当前 B 像素渲染器尚未绘制好友人偶，因此只会刷新版本，不能宣称硬件已出现好友组件。

尚待硬件团队实现新确认凭据和补传、配置实际活动目录、确定字节序并真机验收。3D稳定单元清单、规则计算、个人资产账本及签到纠正已在0010接入。B仍需提供完整3D资产对应的硬件像素形象和好友人偶渲染，历史报告未开放。当前像素成长由有效签到事实投影，不代表原P/H/V/M reward_ledger指标结算已完成。

**Confidence：★★★★☆。** 3D成长、数据和接口可测试；新凭据仍需固件确认，完整硬件像素表现与真机验收仍需联调。


## 2026-10-06 成长结算更新

网站管理员在「星球成长」启用固定规则并绑定活动后，签到事务立即结算个人3D资产并增加版本；回执 growth_status 使用该签到任务的实际 settled/pending_rules 状态。重复交互仍返回原签名回执；已保存回执不会因之后的成长或纠正改写。当前状态通过版本接口读取。未绑定活动保留签到，后续绑定可补结算。签到纠正和取消活动也影响硬件像素状态。完整规则、管理接口、资产单元及像素表现边界见 [成长说明](planet_growth_v1.0.md)。


240×320／RGB565规范、完整BLOB持久化、逐行像素布局及云端部署见 [画面存储契约](rgb565_storage_v1.0.md) 与 [部署流程](cloud_deployment_v1.0.md)。
