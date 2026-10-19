[English](build-check.md)

# ESP32-C3 组件编译检查

2026-10-19：独立恢复ESP-IDF 5.5.3 Python环境及官方推荐esp-14.2.0_20251107编译器；编译器使用本地归档，SHA256与IDF工具清单的macos-arm64条目一致。未改系统Python、用户shell配置或原先残缺的环境。

本机临时环境入口：/private/tmp/pop-city-idf-env.sh。构建目录：/private/tmp/pop-city-target-build。环境和输出位于临时目录，若被清理需要重新准备，不能视为永久安装。报告：/private/tmp/pop-city-target-check-result.json，记录镜像和匹配ELF哈希。

源码入口target-check是专门的组件编译/链接工程，使用产品核心和真实event_storage/personal_store实现、ESP-IDF真实NVS头文件与库；没有产品网络任务、屏幕或交互流程。app_main只初始化本地状态并尝试读取存档，不执行保存、联网或自动重置。该镜像不能当作产品交付或用来替代正常程序。

目标编译发现并修复了4处GCC的misleading-indentation警告，未关闭或降低警告要求。再次构建及主机回归通过。

- 组件Build：PASS，ESP32-C3，ESP-IDF v5.5.3。
- Host tests：PASS，79条核心及1603条存储断言。
- 上游原版源码及build-dir契约检查：PASS。
- 原版verify_firmware.py分区/镜像检查：PASS。应用161536字节，合并镜像227072字节，均在固定保护区之前。
- 完整产品Build：NOT RUN；完整产品门禁：NOT RUN。
- Device tests：NOT RUN；没有连接端口、烧录或写入真实存档。

当前SDK缓存缺少ROM调试ELF，生成GDB辅助文件时有提示，不影响此次编译通过；真实调试前仍需补齐。产品级BSP、LVGL、Wi-Fi/BLE组合与RAM/栈预算尚未验证。

复查需激活上述临时环境，以target-check为项目、单独指定SDKCONFIG和构建目录运行idf.py build及merge-bin，再执行tools/validate_event_app.py --build-dir和上游verify_firmware.py。沿用上游要求的FoloToy-AI-Passport工程名称，版本明确为0.1.0-component-check，不修改验证器来接受其他文件名。此检查不替代后续完整产品构建与A→B→A存档实机验收。
