# 云服务器部署流程：活动网站、成长及硬件画面

- **版本：** v1.0
- **负责人：** 网站／数据库／后台负责人
- **状态：** 发布包和本地检查已准备；尚未登录云服务器执行
- **最后更新：** 2026-10-06

## 交付内容与适用环境

准备的 `herstory-popup-city-20261006-cloud.tar.gz` 是可部署源码，含主网站、内嵌3D、成长规则、RGB565渲染／存储／下载、10个增量迁移、依赖锁文件、配置模板、自检脚本和本文。配套 `.sha256` 校验上传完整性。

适用于项目现有方案：Ubuntu/Debian Linux、systemd、Caddy 2、单个Node进程和SQLite持久磁盘。服务器可以已有其他网站。默认新网站域名沿用 `kunyuan.site`；如实际使用别的域名，在配置与Caddy片段中同步替换。不适用于无持久磁盘的临时容器或多台服务器同时共享SQLite。

发布包不含本机 `.env`、成员数据库、SMTP密码、设备令牌、SSH密钥、node_modules或Mac运行时。Node与依赖在Linux服务器安装。源码部署不会自动搬迁本机成员、已确认头像或星球数据。

**信心：★★★★★（本地源码／存储自检）；★★★☆☆（目标主机）。** 后端及持久帧测试通过，systemd/Caddy模板仍须按目标主机校验，不能视为已经上线。

## 1. 准备信息与连接

需要服务器IP、SSH登录用户与本机密钥路径、可用域名、SMTP服务配置和首位管理员邮箱。密码仅填写服务器受保护配置文件，不放进发布包。

云安全组允许网站80/443；SSH端口按已有设置并限制管理来源。Node的3300只绑定127.0.0.1，不对公网开放。硬件连2.4GHz Wi-Fi，以网站HTTPS域名访问API。

Mac终端中先修改以下变量，然后在同一个终端按步骤执行。SSH用户例用ubuntu，请按服务器实际账号修改。

```sh
DEPLOY_IP='YOUR_SERVER_IP'
DEPLOY_USER='ubuntu'
DEPLOY_KEY="$HOME/.ssh/YOUR_SERVER_KEY"
DEPLOY_PACKAGE_DIR='/Users/bareerah/Documents/popup/02_Execution/outputs/cloud_deployment_20261006_v1.2'
DEPLOY_PACKAGE='herstory-popup-city-20261006-cloud.tar.gz'

cd "$DEPLOY_PACKAGE_DIR"
shasum -a 256 -c "$DEPLOY_PACKAGE.sha256"
scp -i "$DEPLOY_KEY" -o IdentitiesOnly=yes \
  "$DEPLOY_PACKAGE" "$DEPLOY_PACKAGE.sha256" \
  "$DEPLOY_USER@$DEPLOY_IP:/tmp/"
ssh -i "$DEPLOY_KEY" -o IdentitiesOnly=yes "$DEPLOY_USER@$DEPLOY_IP"
```

后面代码在服务器终端执行。首次连接核对SSH主机指纹。如果需要sudo，使用该服务器现有管理账号。

## 2. 校验、解压与只读检查

```sh
set -eu
cd /tmp
sha256sum -c herstory-popup-city-20261006-cloud.tar.gz.sha256
DEPLOY_RELEASE='20261006-cloud'
DEPLOY_STAGE=$(mktemp -d /tmp/herstory-popup-city.XXXXXX)
tar -xzf /tmp/herstory-popup-city-20261006-cloud.tar.gz -C "$DEPLOY_STAGE"
cd "$DEPLOY_STAGE"
sh deploy/preflight.sh
```

在同一SSH终端执行后续步骤；set -eu使失败时停止，不能跳过失败继续启动。预检展示架构、内存、磁盘、所需工具、3300占用、项目专用路径和Caddy版本，不修改服务。若3300由其他应用占用，选择新端口并同步修改配置/Caddy，不能结束其他进程。若已有本项目目录或数据，转到本文「已有云端数据库升级」，不要继续新建流程。

若缺少curl、xz、ss等工具，只安装确实缺少的工具；不要全局升级系统、Node、Python或执行 `pm2 restart all`。Caddy尚未安装的主机先按 [官方Linux安装说明](https://caddyserver.com/docs/install) 安装；已有Caddy不要重装。

## 3. 新建独立服务目录（仅首次）

确认下列专用名称没有被其他项目使用后执行：

```sh
sudo useradd --system --user-group --home-dir /var/lib/herstory-popup-city \
  --no-create-home --shell /usr/sbin/nologin herstory-popup-city
sudo install -d -m 0755 /opt/herstory-popup-city/releases
sudo install -d -m 0700 -o herstory-popup-city -g herstory-popup-city /var/lib/herstory-popup-city
sudo install -d -m 0750 -o root -g herstory-popup-city /etc/herstory-popup-city
sudo install -d -m 0755 "/opt/herstory-popup-city/releases/$DEPLOY_RELEASE"
sudo tar --no-same-owner -xzf /tmp/herstory-popup-city-20261006-cloud.tar.gz \
  -C "/opt/herstory-popup-city/releases/$DEPLOY_RELEASE"
```

代码归root所有；服务只读代码，只写专属数据目录。不要对 `/opt` 或 `/var/lib` 共享父目录递归改权限。

## 4. 安装本服务独立Node运行时

本项目已在Node **v22.22.3** 验证。下方固定这个版本以匹配验收环境；不是「永远最新」的承诺。同主版本更新应先重新自检和回归。[官方发行包及校验入口](https://nodejs.org/en/download/archive/v22.22.3)

```sh
DEPLOY_NODE_VERSION='v22.22.3'
case "$(uname -m)" in
  x86_64) DEPLOY_NODE_ARCH='x64' ;;
  aarch64|arm64) DEPLOY_NODE_ARCH='arm64' ;;
  *) echo '该CPU架构未按本手册验证'; exit 1 ;;
esac
DEPLOY_NODE_WORK=$(mktemp -d /tmp/herstory-node.XXXXXX)
cd "$DEPLOY_NODE_WORK"
DEPLOY_NODE_FILE="node-$DEPLOY_NODE_VERSION-linux-$DEPLOY_NODE_ARCH.tar.xz"
curl -fLO "https://nodejs.org/dist/$DEPLOY_NODE_VERSION/$DEPLOY_NODE_FILE"
curl -fLO "https://nodejs.org/dist/$DEPLOY_NODE_VERSION/SHASUMS256.txt"
awk -v f="$DEPLOY_NODE_FILE" '$2==f {print}' SHASUMS256.txt > CHECKSUM
[ -s CHECKSUM ]
sha256sum -c CHECKSUM
sudo install -d -m 0755 /opt/herstory-popup-city/runtime
sudo tar --no-same-owner --strip-components=1 -xJf "$DEPLOY_NODE_FILE" \
  -C /opt/herstory-popup-city/runtime
/opt/herstory-popup-city/runtime/bin/node --version
```

这里不替换全局Node或旧站运行时。只有首次且runtime目录新建时复制；已有部署升级不能直接覆盖运行中的runtime。

## 5. 安装Linux依赖与发布自检

```sh
cd "/opt/herstory-popup-city/releases/$DEPLOY_RELEASE"
sudo /opt/herstory-popup-city/runtime/bin/node \
  /opt/herstory-popup-city/runtime/lib/node_modules/npm/bin/npm-cli.js \
  ci --omit=dev --include=optional --ignore-scripts
sudo /opt/herstory-popup-city/runtime/bin/node scripts/check-release.mjs
```

期待输出 `status:ok`、10个迁移、240×320/RGB565/153600、SQLite BLOB和sharp:ok。检查只用内存库，不创建或改写生产数据。

sharp使用Linux对应可选二进制；不能从Mac复制node_modules，不能加 `--omit=optional`。如果自检失败，先修复缺失依赖／架构／模型摘要问题，不启动服务。已打包构建好的H5，无需在服务器重新冻结模型清单。

## 6. 创建生产配置

```sh
cd "/opt/herstory-popup-city/releases/$DEPLOY_RELEASE"
sudo install -m 0640 -o root -g herstory-popup-city \
  deploy/server.env.example /etc/herstory-popup-city/server.env
sudoedit /etc/herstory-popup-city/server.env
```

填写：

| 配置 | 正式值 |
| --- | --- |
| NODE_ENV | production |
| HOST / PORT | 127.0.0.1 / 3300，或已经确认的新端口 |
| PUBLIC_ORIGIN | https://kunyuan.site，须与实际域名相同 |
| DATABASE_PATH | /var/lib/herstory-popup-city/popup-city.sqlite |
| AUTH_PEPPER | 随机64位hex，一经使用保持稳定 |
| MAIL_MODE | 配置好邮件后smtp；准备阶段可disabled |
| FROM_EMAIL | 项目发件邮箱info@0xherstory.cn，须获得SMTP允许 |
| SMTP_HOST/PORT/SECURE/USER/PASS | 邮件供应商真实参数；PASS用授权码或密码 |

生成AUTH_PEPPER，可在服务器本地执行下列命令并填入配置，不复制到聊天或截图：

```sh
/opt/herstory-popup-city/runtime/bin/node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

值有空格、#或引号时按dotenv格式正确引用。不要直接 `source server.env` 执行配置文件。MAIL_MODE=disabled时公开页能运行，但无法完成邮箱登录；不能当作成员网站完全上线。

## 7. 初始化空数据库与管理员（仅首次）

```sh
cd "/opt/herstory-popup-city/releases/$DEPLOY_RELEASE"
sudo -u herstory-popup-city /opt/herstory-popup-city/runtime/bin/node \
  --env-file=/etc/herstory-popup-city/server.env manage.js migrate
sudo -u herstory-popup-city /opt/herstory-popup-city/runtime/bin/node \
  --env-file=/etc/herstory-popup-city/server.env manage.js admin \
  'YOUR_ADMIN_EMAIL' '你的昵称'
sudo ln -s "/opt/herstory-popup-city/releases/$DEPLOY_RELEASE" /opt/herstory-popup-city/current
```

首位管理员为超级管理员。首个管理员邮箱需要替换；管理命令不会覆盖或提权已有邮箱。服务启动只校验迁移，不自动创建表。

这一步创建云端新库，不带入本机已有成员/头像。若需保留本机数据，另行迁移一致性SQLite备份，放入受保护持久目录并设置专用用户权限；不可把开发.env或本机库默认混入部署包。

## 8. 启动systemd服务

```sh
cd "/opt/herstory-popup-city/releases/$DEPLOY_RELEASE"
sudo install -m 0644 deploy/herstory-popup-city.service \
  /etc/systemd/system/herstory-popup-city.service
sudo systemd-analyze verify /etc/systemd/system/herstory-popup-city.service
sudo systemctl daemon-reload
sudo systemctl enable --now herstory-popup-city
sudo systemctl status herstory-popup-city --no-pager
curl -fsS http://127.0.0.1:3300/healthz
```

期待健康JSON `status:ok`；mail_configured只说明配置存在，不证明投递成功。SQLite ExperimentalWarning本身不表示启动失败。模板使用专用运行时、用户、目录和资源上限；只新增此服务，不重启PM2、旧Node/Python或其他网站。

## 9. 域名与HTTPS

在域名管理台确认kunyuan.site没有现存业务冲突后，将根域名A记录指向服务器IP。检查AAAA，避免IPv6指向另一台服务器；保留邮件MX/TXT及其他站点记录。云防火墙和主机防火墙需允许80/443。

先查看已有Caddy启动配置：

```sh
sudo systemctl cat caddy
```

若已有站点，只将本包 `deploy/Caddyfile.snippet` 添加到现有import文件或完整Caddyfile中，**不拿片段覆盖原文件**。这段配置对设备API不启用压缩，直接转发二进制画面和206响应。修改域名／端口时同步server.env。匹配器压缩设置依据 [Caddy encode文档](https://caddyserver.com/docs/caddyfile/directives/encode)。

以下例子仅适用于实际配置文件正是 `/etc/caddy/Caddyfile` 的主机；自定义路径应使用实际路径和服务reload配置。

```sh
DEPLOY_CADDY_BACKUP="/etc/caddy/Caddyfile.before-herstory-$(date +%Y%m%d-%H%M%S)"
sudo test ! -e "$DEPLOY_CADDY_BACKUP"
sudo cp -a /etc/caddy/Caddyfile "$DEPLOY_CADDY_BACKUP"
sudoedit /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo systemctl reload caddy
curl -fsS https://kunyuan.site/healthz
```

首次且Caddyfile不存在时，用 `sudoedit` 新建，只粘贴本项目站点；此时不存在旧文件备份步骤。已有备份名称时选择新名称，不覆盖上次备份。validate失败时不reload。reload方式需与现有Caddy服务一致；同时核对旧域名仍能访问。[Caddy validate/reload官方说明](https://caddyserver.com/docs/command-line)

## 10. 网站和硬件验收

1. 在HTTPS网站完成管理员邮箱登录；验证真实邮件送达。导入成员，创建/发布活动。
2. 管理后台「星球成长」启用规则，逐一绑定真实活动。头像只能首次确认，普通资料仍可编辑。
3. 绑定用户板／签到板，在管理员硬件API配置device_kind、签到板活动权限和确认好的RGB565字节序；目前板类型／字节序／站权限配置使用API，详见 [硬件API](hardware_api_v1.0.md)。
4. 将HTTPS地址、专属设备ID和令牌写入相应固件；用户板连接2.4GHz Wi-Fi，TLS证书校验保持开启。
5. 签名签到、报名/权限校验、回执验证、去重通过后，网页个人3D成长更新；交友可离线缓存后补传。
6. 用户板查询画面版本，按4096字节下载固定版本各块，总量153600字节并验证SHA256；完成后确认已显示。版本不变时不重复下载。
7. 重启本服务后再次查询，画面内容和数据库状态保持；旧站仍正常。

画像存储详情见 [RGB565存储契约](rgb565_storage_v1.0.md)。现有2D美术只含B已实现的像素规则，不保证完整3D奖励已全部有2D形象；真机联调须单独验收。

## 已有云端数据库升级

不再执行首次建用户、重建配置、生成AUTH_PEPPER或创建管理员。保持旧.env配置、运行时和独立数据目录。按第1–2步校验上传包，再为新发布选择尚不存在的版本目录：

```sh
DEPLOY_RELEASE='20261006-cloud-r2'
[ ! -e "/opt/herstory-popup-city/releases/$DEPLOY_RELEASE" ]
sudo install -d -m 0755 "/opt/herstory-popup-city/releases/$DEPLOY_RELEASE"
sudo tar --no-same-owner -xzf /tmp/herstory-popup-city-20261006-cloud.tar.gz \
  -C "/opt/herstory-popup-city/releases/$DEPLOY_RELEASE"
cd "/opt/herstory-popup-city/releases/$DEPLOY_RELEASE"
sudo /opt/herstory-popup-city/runtime/bin/node \
  /opt/herstory-popup-city/runtime/lib/node_modules/npm/bin/npm-cli.js \
  ci --omit=dev --include=optional --ignore-scripts
sudo /opt/herstory-popup-city/runtime/bin/node scripts/check-release.mjs
```

新版本自检通过后，先检查原云库与新代码兼容性。

以下例子假设当前版本、本项目服务已存在，当前终端中DEPLOY_RELEASE为新的版本号：

```sh
cd /opt/herstory-popup-city/current
DEPLOY_BACKUP="backup-before-$(date +%Y%m%d-%H%M%S).sqlite"
sudo -u herstory-popup-city /opt/herstory-popup-city/runtime/bin/node \
  --env-file=/etc/herstory-popup-city/server.env backup.js "$DEPLOY_BACKUP"
DEPLOY_PREVIOUS=$(readlink -f /opt/herstory-popup-city/current)
sudo systemctl stop herstory-popup-city
cd "/opt/herstory-popup-city/releases/$DEPLOY_RELEASE"
sudo -u herstory-popup-city /opt/herstory-popup-city/runtime/bin/node \
  --env-file=/etc/herstory-popup-city/server.env manage.js migrate
sudo ln -s "/opt/herstory-popup-city/releases/$DEPLOY_RELEASE" /opt/herstory-popup-city/current.next
sudo mv -T /opt/herstory-popup-city/current.next /opt/herstory-popup-city/current
sudo systemctl start herstory-popup-city
curl -fsS http://127.0.0.1:3300/healthz
```

首次发布已有云库且backup.js不存在时，使用该SQLite服务的在线备份方式，不能在运行时只复制主.sqlite。迁移或检查失败立即停止本流程，保持原current和数据；兼容性确认后才能恢复旧代码服务。不同版本目录使用新的名称，不覆盖已有发布。

升级时若现有服务模板与此发布不同，先对比并验证新模板，再单独替换此服务定义和daemon-reload；不得覆盖其他服务。Caddy设备压缩排除规则也需按第9节合并校验，不能只升级Node代码。

升级的短暂停机仅影响本项目。0010以后已启用的规则／模型文件摘要不能随意覆盖，当前fixed模型清单随包发布，不在服务器重新freeze。代码回退只切current并重启本服务，但必须先确认旧代码接受现有迁移／触发器；不可盲目恢复旧数据库而丢掉新签到和好友。

## 维护与排错

| 情况 | 检查／处理 |
| --- | --- |
| 启动提示待迁移 | 用正确env和专用用户执行manage.js migrate，不删除schema_migrations |
| SQLite权限错误 | 检查数据库目录属于专用用户，文件及WAL可写；不放代码只读目录 |
| sharp加载失败 | CPU架构和Linux可选依赖，重新npm ci --include=optional，不复制Mac依赖 |
| 502 | 检查本服务状态、3300监听和Caddy上游，勿重启所有旧应用 |
| 邮箱登录503 | SMTP参数/发件人权限/网络，MAIL_MODE是否smtp；配置不等于真实送达 |
| BYTE_ORDER_REQUIRED | 管理员配置该用户板big或little，不凭SPI参数猜测 |
| 二进制显示错误 | 分辨率、153600长度、SHA256、字节序、RGB/BGR、扫描方向、HTTPS压缩 |
| 磁盘增长 | 历史帧与备份都占空间，当前不自动删帧；按存储契约估算与监测 |

日志：`sudo journalctl -u herstory-popup-city -n 80 --no-pager`。分享排错日志前剔除邮件地址、令牌和配置值。当前代码日志不主动输出这些敏感值。

定期在current目录执行第「升级」节的backup.js命令，备份落在持久目录；保存到另一受控位置并验证可恢复。不要在服务运行时直接cp单个.sqlite。当前未自动创建cron或删除历史备份。
