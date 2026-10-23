[English](README.md)

# 换电脑烧录

0.2.0-rc19-websync 是首次实机验收候选版，尚未完成硬件验收，不是稳定发布。应用 ID 为 popcity，公开发布前还需主办方确认唯一性。

此目录是烧录工具模板。只有包含通过检查的 manifest.json、full.bin 和配套文件的正式发布 ZIP 才能烧录；请勿自行放入组件验证程序。

另一台电脑不需要 ESP-IDF。需要 Python 3.9 或更高版本、可联网安装依赖，以及 USB 数据线。解压整个 ZIP，保留同一目录内所有文件。首次安装依赖需要联网；安装完成后烧录无需联网。

Windows PowerShell：在解压目录运行 `powershell -ExecutionPolicy Bypass -File .\setup.ps1`。该参数仅作用于本次进程，不修改系统执行策略。然后运行：

```powershell
.\.venv\Scripts\python.exe flash.py --list
.\.venv\Scripts\python.exe flash.py --port COM4
```

将 COM4 改为实际设备端口。安装脚本优先使用 `py -3`，缺少 Launcher 时使用 `python`，并检查版本不低于 3.9；两个命令都不可用时先安装 Python，再重新打开终端。

macOS／Linux：在解压目录运行 `sh setup.sh`，然后：

```sh
.venv/bin/python flash.py --list
.venv/bin/python flash.py --port /dev/cu.usbmodem实际编号
```

Linux 通常使用 `/dev/ttyACM0`；请选择 `--list` 列出的实际端口。遇到权限错误时按操作系统的串口权限规则处理，不要直接把设备设为所有用户可写。烧录前关闭占用该端口的串口监视器。

`--list` 只枚举端口，不复位设备。`--verify` 只检查文件，不连接设备。指定 `--port` 才会复位并烧录板子；务必选对设备。

脚本默认分段写入 bootloader（0x0）、分区表（0x8000）和应用（0x10000），校验摘要、ESP32-C3／8MB 图像头、应用内 ELF 摘要与随包 ELF 的一致性、合并内容及空白间隙、固定分区及分区 MD5，并限制写入与扇区擦除范围不越过 0x690000。不提供全片擦除命令。默认分段烧录保留普通系统 NVS 和固定 event_save。首次升级只读导入旧程序自身 device_identity/planet_net 到 popcity；已有现代存档优先，损坏或写入失败停止、不擦除重建。不迁移其他程序命名空间。full.bin 供匹配归档及兼容活动刷机页使用；首次从旧程序迁移必须先使用随包分段工具，合并镜像覆盖空隙可能清除旧默认NVS，无法再导入。迁移后个人数据仅依赖event_save。

烧录成功不等于功能验收。首次在实机上验证屏幕、按键、联网绑定、双设备交友、签到、断网恢复及重复烧录保留存档。设备初始化凭据不能在多块板间复制；固件 ZIP 不应包含个人设备令牌。

本工具在 macOS 主机测试校验逻辑；Windows／Linux 操作与 USB 烧录仍需现场验证。保留 firmware.elf 与 firmware.map，便于匹配该版本排错，勿随意公开可能含配置的调试文件。

## 首次初始化设备

新板若尚无合法身份，需要先执行初始化工具；不会凭空产生身份。烧录不会自动完成新板登记。初始化完成后，再按屏幕引导连接 Wi-Fi、绑定网站账户。

网站须提供签名的 enrollment、runtime、交友及签到协议接口。本包不包含也不自动部署网站。管理员须在服务器环境中配置 `DEVICE_ENROLLMENT_KEY`（64 位小写十六进制）并重启网站服务。向管理员单独取得私有 `popcity-event-profile.json`，格式为 `{origin,enrollment_key}`。初始化需要电脑联网访问该网站。不要在聊天中粘贴密钥，不要把配置文件放入 Git、固件 ZIP 或公开共享目录。

关闭串口监视器，在解压目录执行以下命令。端口和私有文件路径替换为实际值。

Windows PowerShell：

```powershell
.\.venv\Scripts\python.exe initialize.py --port COM4 --event-profile "C:\private\popcity-event-profile.json" --identity-file "C:\private\board-COM4.json"
```

macOS：

```sh
.venv/bin/python initialize.py --port /dev/cu.usbmodem101 --event-profile "$HOME/private/popcity-event-profile.json" --identity-file "$HOME/private/board-101.json"
```

Linux：

```sh
.venv/bin/python initialize.py --port /dev/ttyACM0 --event-profile "$HOME/private/popcity-event-profile.json" --identity-file "$HOME/private/board-ACM0.json"
```

**每块实体板使用不同的身份文件**；以上用端口命名仅为示例。串口编号可能变化，请私下记录硬件编号与身份文件的对应关系。工具向网站登记设备，经过实体板确认后写入独立身份；跨板复用会被拒绝。生成的身份文件须私下保存，同一块板失败后用**原身份文件**重试，不要删除后重新生成。已初始化的板子无需重复执行；若提示设备不再请求初始化，不要为重做此步骤擦除设备。

未启用服务器登记服务可能返回 `403 ENROLLMENT_DISABLED`；网站地址、密钥不匹配或网站无法访问也会导致登记失败。先解决相应问题，再沿用同一身份文件重试。公开烧录包只包含工具，不包含私有活动配置或每板身份。

随包工具使用请求专属握手，忽略旧启动消息，请勿混用旧工具。

跨程序保档尚未真机验证；本版实机内存峰值、Windows/Linux USB 烧录也待验证。
