# Wi-Fi 首屏到网站交接：代码核查与实施

依据：本轮用户需求、桌面设计 ZIP 及已同步副本、当前工作区源代码。范围只到联网后交接；不更改图稿、生成资源、分区、协议或业务功能。本文不是线上部署或真机验收证明。

## 1. 职责与当前事实

| 责任方 | 工作 | 本轮核查结果 |
|---|---|---|
| 设备 | 扫描2.4GHz AP；接收安全凭证；关联/DHCP；保存网络；DNS/校时/HTTPS；身份及绑定核查 | 已有模块，下面列出缺口，不能直接判定完整 |
| 手机 | FoloToy 蓝牙配网小程序发现设备、安全协商、请求设备扫描、选择SSID/输入密码、发送连接指令、查看BLUFI结果 | 用户确认入口及两个完整蓝牙名可见；握手/扫描/连接尚未本轮验证 |
| 网站 | 登记设备公有身份摘要；Bearer鉴权；返回签名绑定状态及个人运行事实 | 代码路由存在；本轮未部署、未用生产凭据请求，不宣称线上已匹配 |

手机操作：板端短按 UP → 小程序选择对应 BLUFI_HS_xxxxxxxx → 完成安全协商 → 请求设备 Wi-Fi 列表（最多16项，设备扫描，不依赖手机当前Wi-Fi列表）→ 选择2.4GHz网络，必要时手输隐藏SSID → 输入密码并发送 → 等待设备报告连接结果。密码仅经BLUFI到板，不传网站。小程序必须启用BLUFI凭证加密；不以能看见名字代替安全兼容验收。

本轮USB只读枚举：4C11AE2F7C14、98C377F58BA8；初始化记录预期名为 BLUFI_HS_661649ba、BLUFI_HS_7fc67b7a，用户已确认小程序可见相同名称。未打开串口、重置或烧录。

### 修改前核查（真实代码）

| 位置 | 已有 | 缺口 / 本轮处理目标 |
|---|---|---|
| `firmware/main/terminal_wifi.c` | 单次驱动初始化、RAM Wi-Fi配置、GOT_IP/LOST_IP事件 | DISCONNECTED事件直接无限connect；无AP/IP/error分层；无凭证时用虚构SSID启动 |
| `firmware/main/network_setup.c` | 5组轮询、15秒旧网尝试、90秒手机连接、5分钟配网会话、成功后promote | 自动候选无限循环；保存失败可绕过/高频写；重复CONNECT可覆盖进行中请求；页面靠字符串猜状态 |
| `firmware/main/network_worker.c` | 单个12288B网络任务、命令队列和快照；HTTPS不占用UI任务 | UP重复停止再启动配网；IP即视为online，后端尚未验证可能提前进入已绑定流程 |
| `firmware/main/network_blufi.c`、`blufi_security.c` | 同一NimBLE主机、DH/AES/CRC、512B有界GATT、锁保护 | 需核实线上小程序加密帧兼容；仅security_ready不等于所有凭证帧均加密 |
| `network_radio_scan.c`、`network_scan_model.c` | 非阻塞扫描、16项、SSID去重/信号排序、扫描资源释放 | 无网络/扫描失败不能伪称扫描成功；隐藏SSID需手机手输 |
| `app_services.c`、`personal_store.c`、`event_storage.c` | 整条记录复制后只改Wi-Fi字段；NVS commit成功才发布RAM；event_save独立命名空间 | 复用，不改schema或清库；写失败应保留原记录并阻止“已保存”交接 |
| `cloud_idf.c`、`cloud_protocol.c`、`startup.c` | CA证书、主机名校验、禁重定向、10s单请求截止、HMAC/recipient核查、真实绑定路由 | 初始HTTPS需先等系统时间可用，失败分层、退避；未知响应不能进入下一页 |

根目录与firmware下未找到本项目AGENTS或要求的开发指南；未找到用户提及的Starter ZIP原文件，先以工作区冻结contract/validator核查，不声称已重新比对压缩包。修改前 `python3 firmware/tools/validate_event_app.py` 已PASS。

## 2. 状态转换和显示映射

不新增页面、文案或图标。内部状态不等于显示文本。

| 内部状态 | 触发 / 动作 | 下一状态 | 原稿显示 |
|---|---|---|---|
| BOOT_LOAD | 验证event_save记录及身份；不可写/归属错不擦库 | IDENTITY_REQUIRED / WIFI_IDLE / AUTO_CONNECT | 原有配网页；身份故障走已有服务不可用状态，USB初始化解决 |
| AUTO_CONNECT | 最近成功网络优先，最多5组，每组最多15s，本轮逐一尝试 | AP_ASSOCIATED / WIFI_FAILED | 正在连接；整轮失败连接失败，UP开始手机配网 |
| WIFI_IDLE | 无凭证，不连接假SSID | PROVISIONING（短UP） | “按UP连接Wi-Fi”原稿 |
| PROVISIONING | 开BLUFI广播、手机握手/扫描；重复UP忽略 | WIFI_CONNECTING | 原配网页；最新用户授权在引导下方显示本板真实蓝牙名 |
| WIFI_CONNECTING | 安全凭证入4项队列，停止扫描，只执行一项连接 | AP_ASSOCIATED / WIFI_FAILED | 原CONNECTING... |
| AP_ASSOCIATED | AP关联成功，尚无IP；继续等待DHCP | IP_READY / WIFI_FAILED | 原CONNECTING... |
| IP_READY | 收到GOT_IP且SSID是目标；将网络提升至首位并持久提交 | WIFI_SAVED / SAVE_FAILED | 成功交接前不假报完成 |
| WIFI_SAVED | 结束配网并释放BTC加密/扫描资源；保留成功Wi-Fi | TIME_WAIT | 按已有过渡进入网站服务状态 |
| TIME_WAIT | SNTP异步校时；时间不合理不发HTTPS | SITE_VERIFY / SITE_UNAVAILABLE | 原官网暂不可用，不要求重输密码 |
| SITE_VERIFY | 串行调用真实绑定状态；bound再调用runtime | BIND_HANDOFF / BOOT_HANDOFF | 使用已有服务状态，不显示假码/假星球 |
| BIND_HANDOFF | 验签的unbound/pending及有效码 | 既有绑定流程 | 原绑定页，不重设计 |
| BOOT_HANDOFF | 验签bound且runtime有效、本人事实完整 | 既有开机流程 | 沿用既有Hello/星球及恢复路由，不扩展本次业务 |
| SITE_UNAVAILABLE | DNS/TLS/HTTP/签名/身份错误；Wi-Fi保留 | 按退避重试SITE_VERIFY | 原官网暂不可用；真正丢IP才回配网 |
| WIFI_FAILED | 错密码/无AP/DHCP超时/配网超时 | UP开始或手机更正后重试 | 原连接失败 |
| SAVE_FAILED | event_save提交失败，旧配置保持 | 有界重试保存；仍失败停留 | 映射原连接失败，不增加“保存成功”假提示 |

网络事件只更新原子快照；worker驱动扫描/连接/保存/HTTPS；UI只取快照。关联成功≠取得IP≠正式后端签名响应有效。后端200且协议/身份正确才允许交接。

## 3. 失败和恢复规则

| 原因 | 内部分类 | 恢复 |
|---|---|---|
| 密码/握手拒绝 | AUTH | 结束本次连接；保留旧配置，手机更正；不要断言所有握手超时必是密码错 |
| 无目标AP | NO_AP | 不写新配置；旧网候选继续一轮，手动配网可扫描/输入隐藏SSID |
| 已关联未得IP | DHCP_TIMEOUT | 到连接预算截止才失败；本轮90秒配置预算/15秒旧网预算，不无限等待 |
| 普通无线断开 | LINK_LOST | 清关联/IP事实；旧网按最近成功顺序有限尝试，不在事件回调无限connect |
| 手机断开（尚未发凭证） | PHONE_LOST | 擦除临时输入/密钥，继续剩余5分钟广播窗口；不清成功网络 |
| 手机断开（已发连接） | PHONE_LOST | 已入队连接继续；成功照常保存，失败等重连；不取消已成功配置 |
| 同时/重复CONNECT、UP | BUSY | 不启动第二任务、不重置进行中尝试，不让第二组凭证覆盖第一组 |
| 扫描失败/空列表 | SCAN | 返回真实空/失败；原页不变，可重试，不伪造AP |
| 保存失败 | STORAGE | RAM旧成功记录和Flash旧记录都保持；保存退避且有次数上限，不进行网站交接 |
| DNS/出口断网/路由器无公网 | DNS_OR_TRANSPORT | 保留Wi-Fi；失败按2/4/8/16秒退避；最多5个失败轮次（每轮最多status+runtime两次串行请求），耗尽后原页面UP重开一轮；同一时刻至多一个HTTPS |
| 系统时间不可用 | CLOCK | SNTP继续异步；不跳过证书有效期校验；无可信时间不HTTPS |
| 证书错误/域名错误 | TLS | 保留Wi-Fi和身份，不降级HTTP，不关闭证书校验；管理员修复证书/配置 |
| 401/403 | IDENTITY_AUTH | 不生成新身份，不清存档、不改成Wi-Fi失败；核查初始化库存及撤销状态 |
| 404/405 | ROUTE_VERSION | 核查真正部署版本/完整路径/代理，不当“暂无绑定/活动” |
| 429/5xx | SITE | 有界频率退避、保留网络；不显示成功；服务恢复后原身份再查询 |
| HMAC/recipient/协议字段不合法 | PROTOCOL | 不接收任何成功事实；保留网络和原绑定，等待修复/重试 |
| 默认NVS或event_save损坏 | STORAGE_INIT | 停止，禁止自动擦除重建；交由受控修复，普通重试不擦区 |

每次启动/断网重连一轮最多5个成功记录；轮次耗尽留原失败页，UP可重开手动流程。网站接入连续5个失败轮次后停止自动尝试，原有服务页UP可重新查询。成功接管后的正常状态轮询不是错误重试。网站故障绝不触发重输Wi-Fi密码。

## 4. 当前真实接口（本轮不新增云端路由）

统一origin取本机event_save的server_origin，例如 `https://herstory.net.cn`，下列为该origin上的完整路径。

| 方法/路径 | 时机、鉴权 | 请求 | 响应/交接 |
|---|---|---|---|
| POST `/api/device-enrollment/register` | 仅首次USB初始化电脑；Enrollment初始化密钥 | device_id（唯一UUID）,token_hash（token的SHA256） | 签名登记状态；同身份重试可重放，冲突409禁止换公共token；不传Wi-Fi密码 |
| GET `/api/device-enrollment/status` | IP/校时成功后、网站状态轮询；Bearer每板独立token | 无body | payload字符串+signature；recipient_device_id；state=unbound/pending/bound/revoked；unbound/pending含4位claim_code、expires_at/server_time，pending含request_id/member_label/member_hint/bitmap；bound含member_id/member_name/device_kind/bitmap |
| GET `/api/device/runtime?view=board` | 已绑定状态核实后；同Bearer | 无body；恢复可有known_activity_id | protocol_version=1,server_time,identity,planet.palette_id/revision/组件,host/registrations/recovery；本人身份、签名及字段有效才交接已绑定开机流程 |
| POST `/api/device-enrollment/confirm` | 既有绑定流程接管后，非本次重设计；同Bearer | request_id,decision=accept或reject | 签名最新状态；不知道结果仍查询原申请，不能自称绑定成功 |

服务端实现在 `device-enrollment.js`、`api.js`、`hardware-cloud/runtime.mjs`；客户端在 `cloud_idf.c`、`cloud_protocol.c`、`startup.c`。GET status并不是新配网接口。

响应签名：使用SHA256(token)的32字节摘要为HMAC-SHA256密钥，签原始payload UTF-8字符串；先验签、核对recipient，再接收业务字段。HTTP200本身不足。现有单请求10秒总预算，每次底层等待不超8秒，关闭重定向；DNS解析经lwIP系统解析器。DNS库调用是否严格受总截止限制需目标机黑洞DNS实测，不夸大保证。

本次不改网站数据或部署。旧记录有过runtime 404，不能据此断言当前线上仍404或已解决；要用真实已绑定设备授权请求分别核查服务器本机与公网，healthz 200不能替代设备路由验收。

## 5. 配置与存档

| 配置 | 位置 / 责任 |
|---|---|
| 2.4GHz SSID/密码（最多5组） | 手机经安全BLUFI发送；event_storage保存于本应用event_save记录，不进网站或日志 |
| HTTPS origin、每板UUID/token | 初始化私有profile+每板身份文件，USB经nonce和MAC核对后写event_save；不提供公共token |
| DEVICE_ENROLLMENT_KEY | 服务器私有env、初始化电脑私有profile；不编译进程序、不装入公开烧录包 |
| PUBLIC_ORIGIN、数据库、SMTP等 | `/etc/herstory-popup-city/server.env`；配置模板 `deploy/server.env.example`；后端手工部署 |
| 根证书/HTTPS | ESP-IDF证书bundle，`cloud_idf.c` attach；域名证书由站点提供 |
| 时间 | `network_setup.c`异步SNTP；取得合理UTC后才HTTPS，再采纳签名server_time用于业务 |
| 蓝牙名 | `network_blufi.c`：BLUFI_HS_+本板device_id前8位；手机系统/权限按FoloToy小程序实际要求验证 |
| app_id | event-app.json与main/event_app_identity.h均为popcity；源码注明组织方唯一分配尚未确认。本轮不随意换ID，正式发布前须组织方确认 |

存档：schema3、1536字节（默认配额2048），包含魔数/版本/app_id/CRC，兼容旧格式迁移；只更新Wi-Fi字段，保留身份、绑定、星球和待决操作。最近一次DHCP成功且持久提交成功的网络提升至第一，去同SSID，最多5组，新增第6组淘汰最久未成功者。密码不同的同SSID更新仅在新连接成功后发生。

断电语义：收到凭证但尚未保存则下次使用原成功记录；保存失败不会发布新RAM成功记录；NVS commit成功后重启恢复最新完整记录。真实掉电原子性还需断电实验，不把内存stub测试说成掉电验收。

冻结分区：factory 0x10000+0x680000；event_save 0x690000+0x170000。镜像和按4096字节向上取整后的实际擦除末端均必须≤0x690000（末字节<0x690000）；不打包event_save，不整片擦除，不修改validator或contract。日常优先经校验的分段程序区更新。本轮不烧录。

## 6. 最小实施与验收

1. 保留原素材和三键外观，仅添加内部结构化状态/错误；去掉假SSID、驱动断开无限connect；五组自动尝试有终点。
2. 配网CONNECT入队互斥，重复UP不重启；保存成功才交接，失败有限退避，旧数据不变。
3. 原网络worker串行校时/状态验证/必要runtime握手；网站失败不回配网、不清身份；UI只使用已有状态资源。
4. 增加针对实际network_setup编排的主机测试及失败/保存边界测试；运行完整host gate、分区validator和C3构建，检查实际镜像/flash_args/擦除范围。
5. 部署和烧录另行确认。实机验收：两板分别UP→手机安全握手→扫描→密码→AP/IP/HTTPS分层成功；错密码/无AP/DHCP阻断/手机断开/无公网/DNS黑洞/错证书/后端401/404/503；重启恢复5组优先级、存储写失败、反复配网与TLS内存峰值/最大连续块/栈水位；真实绑定与已绑定分流。
6. 组织方正式刷机页面 A存可辨数据→B保存B数据→A精确恢复→B精确恢复，单列验收。**跨程序保档尚未真机验证**。

## 7. 当前交付状态

本节在实现完成后追加实际测试结果。本轮尚未部署、烧录或完成手机安全握手与真机连接验证；不能把之前RC13素材烧录当成本次Wi-Fi验收。

## 8. 本轮实现结果（RC14 Wi-Fi候选）

| 代码位置 | 已完成的本地变更 |
|---|---|
| firmware/main/terminal_wifi.c:50、:74、:178 | 区分关联/IP/断开reason；移除事件回调无限重连；无配置启动空闲STA，无假SSID |
| firmware/main/network_setup.c:66、:79、:129、:152、:164 | 5组最近成功顺序；有限候选轮换；CONNECT互斥；保存成功才发布ready；写失败1/2秒退避、最多3次，UP可重试；5分钟会话关闭；手机断开不取消已排队连接 |
| firmware/main/blufi_input.c、network_blufi.c:31 | 凭证帧须在DH协商后加密；GATT长度校验；SDK分片重组申请限制1024字节，检查后仍交SDK做序号/CRC/组包；不加第二套蓝牙栈 |
| firmware/main/network_handoff.c | status→bound时runtime→ready；2/4/8/16秒退避；5失败轮次停止；时间戳回绕测试 |
| firmware/main/network_worker.c:90–120、:286 | 单个现有worker串行交接，BTC资源未释放或UTC尚不可用不启动HTTPS；验签状态有效后分流，已绑定还需有效本人runtime；IP有效而网站异常只走已有服务状态，不要求重新配网 |
| firmware/main/cloud_idf.c | 保留CA/域名/时间检查与延迟缓冲；内部区分DNS、TLS、超时、内存和IO错误，不记录凭证；快照保留HTTP状态便于区分401/404/5xx |
| firmware/main/app_main.c | 只改状态门槛和已有素材选择，不修改文案、布局、颜色、动画或素材文件 |
| firmware/tests/test_network_setup.c、test_network_handoff.c | 实际编排模块的SDK边界测试，以及后端门槛/退避/加密帧边界测试；均为主机测试，不是生产成功数据 |

本轮测试：完整主机gate通过（core259、storage1604、cloud184断言及初始化/便携包/扫描/字库等既有回归；新增真实配网编排9种场景、后端交接与帧检查）；ESP-IDF5.5.3、ESP32-C3全新独立build通过。135张PNG/168欢迎帧仍与批准副本一致。本轮没有写设计素材。

镜像：应用4593040字节；合并4658576字节；合并镜像按4KiB向上取整后的擦除结束地址0x472000（不含），小于0x690000。实际flash_args组件范围单列在验证JSON；包内没有event_save镜像。partitions.csv、event-contract.json、validate_event_app.py与HEAD逐字节一致；修改前和交付前validator均PASS。schema3、1536/2048字节不变，app_id保持popcity。

候选包：output/Pop-up-City-Firmware-0.2.0-rc14-wifi-candidate.zip。记录：output/wifi-first-page-20261019/validation.json、host-tests.log、build.log。这个包未授权部署或烧录，不是完成实机验收的版本。后续确认烧录时优先核对已装分区再只写application到0x10000，并计算实际擦除末端，不使用整片擦除。

### 还未验证 / 必须保留的限制

- 本轮未部署、未对生产设备接口发起鉴权验收、未烧板。当前两板仍是上轮程序。不能称网站与新固件已真实联通。
- 手机仅确认发现名称；还未验证FoloToy小程序对本轮加密帧/分片约束的兼容性、扫描列表、连接及手机断开恢复。
- DNS解析沿用SDK同步解析器；现有HTTP总预算在调用前后检查10秒，但DNS阻塞调用可能超出该预算后才返回。因此**严格DNS黑洞10秒硬截止尚未实现**；不能把现有时间检查说成可中断同步DNS。须在真机验收中量测；若要求这一硬截止，需补异步DNS/连接策略并再次验证域名/SNI和证书。
- 时间门槛仅判断RTC/SNTP系统UTC不早于2024，不把它当作精确校时证明。NTP服务的DNS及UDP123必须可达；无合理时间只保留Wi-Fi等待，不禁用证书检查，也不以未验证HTTP获取时间。
- Wi-Fi/BLE/TLS/LCD同时运行的动态heap、最大连续块与栈水位，反复切网和物理掉电的写原子性未进行本轮真机验证；静态构建通过不代表这部分PASS。
- **跨程序保档尚未真机验证**。需组织方正式刷机页完成A→B→A→B，包括B也保存并精确恢复自己的数据。

### 还需要用户提供什么

目前无需发送密码、令牌或SSH。手机入口和两板蓝牙名已确认。真机阶段需要你在小程序内输入可用2.4GHz网络；新设备若缺身份，需要私有初始化profile在本地初始化（不贴到聊天）。组织方正式app_id分配记录和受控程序B仍待确认，用于正式跨程序验收，不影响本轮本地Wi-Fi实现。

## RC15：已批准的首屏蓝牙名显示

用户确认短按UP开启配网后显示本板完整BLUFI编码。新增原设计副本状态“配网蓝牙已开启”，原引导文字/图标不移动，在y=290加入实际广播名（17字符、202px宽）。尚未按UP时不显示，开始连接路由器后仍使用原CONNECTING页面。桌面ZIP、manifest、HTML和文字逻辑已同步，原151项素材未改。RC15已于本轮授权烧入98C377F58BA8，程序和保护区校验通过；真实屏幕和完整手机配网仍待验收。

持续约定：之后所有页面与逻辑变更必须同步整理进桌面《全部页面设计与逻辑.zip》（设计图、文字逻辑和汇总表）；视觉变更先获用户同意。
