[English](storage.md)

# 个人存档实现

本地开发标识为popcity，正式发布前仍须核对组织方分配与唯一性。event-app.json和event_app_identity.h已保持一致；未使用app_a模板身份。

## 数据与配额

main/event_save_model提供1536字节的固定小端线格式，不直接保存C结构体，因此主机与ESP32编译器的对齐差异不会改变存档布局。配额2048字节，剩余512字节不作为媒体资源空间。

记录包含magic、schema=2、16字节app_id字段、业务字段及FNV-1a校验和。校验和用于检测意外损坏，不是加密或身份认证。业务字段覆盖Hello标记、设备/成员身份与令牌、服务器地址、最多5组Wi-Fi、最多3个未决操作及其活动/重试编号、通知会话/最大消费编号、配色及星球版本。

UUID、令牌长度、字符串终止、计数、操作类型及重复操作编号都会校验。序列化清零保留空间，不复制C结构体填充和字符串后的旧内存。

## event_storage与提交顺序

main/event_storage只初始化event_save，通过nvs_open_from_partition打开本应用命名空间，使用原有record键并提交NVS。不擦除分区。读取/保存其他应用身份会拒绝，任何错误都不自动覆盖原存档。

main/personal_store使用上述event_storage作为唯一落盘入口。只有真实NOT_FOUND视为空的新存档；损坏、未知版本、初始化或其他读取错误会禁用写入。保存成功后才更新内存副本。

- pc_store_skip_hello成功后，调用pc_hello_saved(true)才能退出Hello。
- pc_store_pending_begin成功后，才能发出对应交友/单签/批签请求。未决槽不能被另一个操作覆盖，也不能用新操作编号假装重试。
- 批量结果经验证为可重试后，先pc_store_pending_retry持久化重试编号，再发POST。超时仍查询原编号；不能把未明结果当成失败。
- 只有验证过权威结果并匹配原操作编号，才能调用pc_store_pending_clear。保存失败继续保留待核对项。
- feedback消费者绑定pc_store_feedback_save，先落盘消费游标，成功后才返回允许亮起。恢复后相同编号只补ACK。

以上接口已经实现，应用主循环与网络/UI的调用组合仍待接入。不要在按键/计时器回调中运行这些阻塞存储操作。完整任务栈/RAM预算仍须ESP32目标构建及实机检查。

## 升降级

支持校验通过、app_id一致的32字节Starter schema=1示例记录读取，原primary/secondary/launches保留到schema=2的legacy字段，不擅自解释为Hello或签到。读取不自动回写，下一次明确成功保存才写入schema=2。

未知高版本、损坏或其他程序的记录拒绝且保留。没有自动降级覆写。更早产品固件的其他存档格式不属于这项示例迁移，需另外识别。

## 验证与限制

运行sh firmware/tools/validate.sh：79条产品核心断言、1603条存储断言通过；其中1536条为逐字节翻转损坏检测。还覆盖满长Wi-Fi字段往返、命名空间隔离、未决操作恢复/拒绝覆盖、批量重试编号、持久通知去重、写入/提交/读取/初始化错误以及版本迁移。

使用真实存储适配源代码与NVS主机替身测试，没有写入真实板子；故障注入不等于真实断电试验。上游原版validate_event_app.py源码契约检查通过，脚本保持字节一致。没有最终build-dir，镜像范围检查尚未执行。

Build：NOT RUN；Host tests：PASS；Device tests：NOT RUN。
未验证：ESP-IDF编译、真实NVS写入/断电、最终烧录器范围，以及A→控制程序B→A的实机存档恢复。未操作设备、未更改正式数据或分区。
