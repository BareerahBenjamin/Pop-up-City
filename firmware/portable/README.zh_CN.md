[English](README.md)

# 换电脑烧录

0.2.0-rc2 是首次实机验收候选版，尚未完成硬件验收，不是稳定发布。应用 ID 为 popcity，公开发布前还需主办方确认唯一性。

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

脚本固定以 0x0 写入完整镜像，校验摘要、ESP32-C3／8MB 图像头、应用内 ELF 摘要与随包 ELF 的一致性、合并内容及空白间隙、固定分区及分区 MD5，并限制写入与扇区擦除范围不越过 0x690000。不提供全片擦除命令。普通系统 NVS 位于镜像覆盖区域，可能被重置；个人存档必须位于固定 event_save 分区。旧程序使用其他分区保存的数据不因此自动兼容，需先确认迁移方案。

烧录成功不等于功能验收。首次在实机上验证屏幕、按键、联网绑定、双设备交友、签到、断网恢复及重复烧录保留存档。设备初始化凭据不能在多块板间复制；固件 ZIP 不应包含个人设备令牌。

本工具在 macOS 主机测试校验逻辑；Windows／Linux 操作与 USB 烧录仍需现场验证。保留 firmware.elf 与 firmware.map，便于匹配该版本排错，勿随意公开可能含配置的调试文件。

首次空板初始化：烧录后运行 `.venv/bin/python initialize.py --port 实际端口 --event-profile 私有活动配置.json --identity-file 此板专用身份.json`（Windows 使用 `.venv\Scripts\python.exe`）。活动配置沿用 `{origin,enrollment_key}` 私有格式，不放入公开 ZIP。身份文件与板子硬件编号绑定，跨板复用会被拒绝；保留此私有文件供同一板子的失败重试。已初始化设备无需重复执行。此工具会向正式网站注册一块设备，并在板子确认后保存独立身份。

空板登记前，管理员须在服务器 server.env 配置 `DEVICE_ENROLLMENT_KEY`（64 位小写十六进制）并重启网站服务；私有活动配置的 origin、enrollment_key 必须与服务器一致。未配置时登记返回 `403 ENROLLMENT_DISABLED`。先部署本次网站 r4 包，再初始化空板；私有活动配置和每板身份文件不得放进公开 ZIP。
