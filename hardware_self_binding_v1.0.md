# C 硬件自行绑定与联调

- **版本：** v1.0
- **负责人：** A 后端负责人／获授权的硬件开发人员
- **状态：** 已切换 herstory.net.cn 并验证公网接口；设备由开发人员绑定，真机待验收
- **最后更新：** 2026-10-12（Asia/Hong_Kong）

## 范围与入口

正式服务器：`https://herstory.net.cn`，API 前缀 `https://herstory.net.cn/api`。2026-10-12 按用户要求迁移域名，继续使用同一 Node.js 服务、数据库与设备身份。固件需要更新 base URL；已绑定设备不需重新绑定或更换 token。

旧 `herstory.net.cn/hardware-test` 环境及旧联调包已作废：路由撤销、服务停用移除、三块预建测试板凭证撤销，原 Caddy 配置已恢复。正式 Node.js 数据库未改动。

**信心：★★★★★（公网基础连接）；★★★☆☆（真机完整链路）。** 2026-10-12 新域名公网 HTTPS 健康接口为 200，设备元数据接口无凭证为预期 401；尚未使用真实设备令牌执行端到端联调。开发人员从所在网络访问 `GET /healthz` 确认连接后，使用自己已绑定的设备继续测试。详情见 [域名迁移记录](domain_migration_v1.0.md)。

## 开发人员自行绑定

目前自行绑定使用已有管理员权限，不新增角色、不自动给任何开发人员提权。账号须已被导入，并获得网站管理员权限；普通成员目前不能调用管理员绑定接口。如需普通开发人员的专用绑定权限，应单独明确范围后实现，不能直接开放管理员接口。

1. 开发人员在 herstory.net.cn 用自己的获授权账号登录。
2. 进入「后台 → 成员管理」，选择预期归属成员，点击「绑定设备」。后台返回 A 生成的 device_id 和一次性 token，开发人员自行保存并写入对应板子。
3. 分别绑定一块签到板、两块用户板。两块用户板必须属于两个不同成员。签到板也必须归属一个有效成员；不要求该成员是管理员。
4. 用下列现有接口配置设备类型和用户板字节序，再授权签到板的实际活动。
5. 由两位成员分别报名实际测试活动（attendee）。本次不代替开发人员创建成员、活动、报名、设备或授权。

管理员接口使用网站登录 Cookie `popup_city_session` 和同源 `Origin: https://herstory.net.cn`，不能用设备 token 替代。开发人员在该网站自己的浏览器登录会话中调用即可；不要把管理员 Cookie 发给 A 或写进硬件。

### 设备创建

`POST /api/admin/members/<user_id>/devices`

HTTP 201：

```json
{
  "device_id": "<A本次生成的UUID>",
  "token": "<本次生成的64位小写hex设备令牌>",
  "message": "令牌仅显示一次，请安全写入设备"
}
```

网页「绑定设备」调用的就是此接口。已经在网页绑定后不要再 POST 一次，否则会创建另一台设备。令牌丢失时不能从数据库还原；撤销旧设备，再由开发人员重新绑定。

### 硬件类型和字节序

`PUT /api/admin/devices/<device_id>/hardware`

签到板 body：`{"device_kind":"checkin"}`。

用户板 body：`{"device_kind":"user","rgb565_byte_order":"little"}`，或采用双方确认的 `big`。

成功返回 `{"status":"configured"}`。类型一旦配置不可改变；先配置类型再开展业务交互。未配置的旧设备默认 user，但下载星球画面前仍须配置字节序。

### 签到板活动授权

`PUT /api/admin/checkin-stations/activities`

```json
{
  "station_device_id": "<自行绑定的签到板UUID>",
  "activity_id": "<实际活动UUID>",
  "opens_at": 1791446400,
  "closes_at": 1791450000,
  "revoked": false
}
```

上面的时间仅是格式示例，不是已生效的授权。换成实际活动的开始前一小时和开始时间，Unix 秒整数。成功返回 `{"status":"authorized"}`。当前没有签到板可调用的授权活动列表 GET 接口，开发人员需要把选定的 activity_id 配置给签到板。

### 在自己的登录浏览器会话中配置

以下辅助函数供开发人员在 herstory.net.cn 的开发者控制台运行，只复用本人的现有会话，不导出管理员 Cookie：

```js
async function configureHardware(path, data) {
  if (location.origin !== 'https://herstory.net.cn') throw new Error('只允许在 herstory.net.cn 操作');
  const r = await fetch(path, {
    method: 'PUT', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  const result = await r.json();
  if (!r.ok) throw new Error(result.error || `HTTP ${r.status}`);
  return result;
}
// 将 device_id 替换为自己刚绑定的 ID，再按需执行：
// await configureHardware('/api/admin/devices/<device_id>/hardware',
//   {device_kind:'user',rgb565_byte_order:'little'});
// await configureHardware('/api/admin/devices/<device_id>/hardware',
//   {device_kind:'checkin'});
```

不要把设备 token 放进此配置请求；token 只供设备调用 `/api/device/*` 与本地派生签名密钥。

## 联调接口

| 场景 | 完整地址 | 使用的身份 |
| --- | --- | --- |
| 签到 | `POST https://herstory.net.cn/api/device/checkin-events` | 签到板 Bearer，报文带用户板证明 |
| 交友补传 | `POST https://herstory.net.cn/api/device/friend-events` | 任一参与用户板 Bearer，带双方证明 |
| 星球元数据 | `GET https://herstory.net.cn/api/device/planet/version` | 用户板 Bearer |
| 画面下载 | `GET https://herstory.net.cn` + metadata.frame_url + 分块参数 | 同一用户板 Bearer |
| 显示确认 | `POST https://herstory.net.cn/api/device/planet/displayed` | 用户板 Bearer |

详细字段、完整请求／响应及 HMAC 固定测试向量放在交付包的 `api_reference.md` 和 `sample_vectors.json`。其中身份均为合成向量，不能当作可用凭证；实际调用只使用开发人员绑定后获得的数据。

C 流程保持：用户板 BLE → 签到板 Wi-Fi → A → 签到板 BLE → 用户板；用户板之间交友并由参与用户板联网补传；签到板不参与交友。

## 多天测试的时间规则

新签到必须同时满足：

- 活动已发布，且 `starts_at - 3600 <= 服务器时间 < starts_at`。
- 签到板授权未撤销，且 `opens_at <= 服务器时间 < closes_at`。
- `abs(服务器时间 - occurred_at) <= 300`，成员已以 attendee 报名。

活动开始时即关闭；ends_at 不参与签到开放规则。单纯延长签到板授权不能延长活动自身的窗口。当前 Node.js 项目没有之前独立测试环境的 `/test/open-window` 接口，请勿调用它。

连续多天测试由开发人员按每天实际测试时间创建／安排对应活动、报名并授权。不要为方便联调修改正式签到规则；测试活动时间结束后改用下一场活动。好友以成员对去重，同一对成员跨天重测也会返回 duplicate:true，这不是失败。

## 身份与待交付信息

device_id 由 A API 使用 crypto.randomUUID() 生成并写入 devices.id。板子的 MAC／芯片序列号不代替 device_id；物理标识可在 C 命名为 hardware_id，但当前 A 没有 hardware_id 字段或绑定映射接口。

开发人员自行绑定后保存：三块板各自的 device_id／token、两位成员 user_id、activity_id、授权窗口和字节序。不要继续使用旧包中的身份、凭证或域名。
