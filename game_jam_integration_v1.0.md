# Game Jam 页面与后端接入

- **版本：** v1.0
- **负责人：** 网站／数据库／后台负责人
- **状态：** 集成与本地联调通过；支持在现有云端数据库上增量升级
- **最后更新：** 2026-10-06

## 页面与身份

主导航增加 `/#game-jam`，管理后台增加「Game Jam」审核页。原站为Next.js静态站，页面与预检逻辑来自 [Game Jam 仓库](https://github.com/Jiajia-Chen/herstory-popupcity-game-jam/tree/59c91e6a8c56cd1ce97977f661c051c326fb340d)。集成采用总网站的原生前端和Node.js服务，复用样式、HttpOnly会话及members.id；无需运行第二个Next.js服务。原始页面源码与版本记录保存在vendor/game-jam-reference，仅作参考，不参与运行。

画廊支持分类与关键词搜索，只展示数据库中已审核发布的真实作品，没有导入上游演示作品或虚构安装次数。未登录可浏览已发布作品；投稿、固件与manifest下载需要已导入且未停用的成员身份。待审核／退回作品仅作者和管理员可以查看文件；管理员可填写审核依据后发布、退回或下架。

首次邮箱登录（验证码或一次性链接）先进入个人资料表单，填写后设置头像，最终确认再进入星球。已确认头像不能重新生成，其他资料仍可编辑。

## 数据库

新增 [0011_game_jam.sql](migrations/0011_game_jam.sql)，不改写0001–0010或既有记录。

| 表 | 关键字段与职责 |
| --- | --- |
| game_jam_apps | app_id为PK，owner_id关联members.id，应用命名空间归属于首位投稿成员 |
| game_jam_projects | id、app_id、version、作品资料、manifest_json、firmware_name、firmware_bytes、firmware_sha256、firmware BLOB、cover BLOB、status、review_note和时间；app_id+version唯一 |
| game_jam_reviews | project_id、reviewer_id关联已有成员、published/rejected、审核说明与时间，追加保留审核记录 |

完整固件保存在SQLite BLOB中；封面验证并重编码成WebP，去掉原图元数据。元数据列表不读取固件内容；下载返回原始字节及X-Content-SHA256。旧版本不会被新投稿覆盖；同版本、相同内容重试返回原作品，不增加记录；内容改变应增加版本号。其他成员不能占用已归属的app_id。

本次已经一致性备份并迁移本机data/popup-city.sqlite，迁移数11；迁移前后原有全部业务表摘要一致。备份为data/backup-before-game-jam-20261006.sqlite。备份和真实业务库均不随源码或发布包提交。

## 文件检查范围

投稿使用multipart/form-data，文本字段title（80字）、author（60字）、description（180字）、category，以及manifest、firmware和可选cover。服务器独立复核，不能靠修改浏览器代码跳过：

- event-app.json不超过8KB，contract_version=herstory-event-v1。
- app_id为3–15位小写字母、数字、下划线，首位字母；version为完整版本形式，save_quota_bytes为1–2048整数。
- 固件名以-full.bin结束，大小严格小于0x690000（6881280）字节，首字节0xE9，SHA-256由服务器计算。
- 封面PNG/JPG/WebP不超过3MB；不接受动画、损坏图片或超大像素图。
- 整个请求有大小与并发限制；未登录、账号停用、跨来源请求或审核权限不符会被拒绝。

这是基础上传预检，不能凭首字节和长度证明固件内部分区表、擦除行为或真机兼容性。管理员审核页面要求记录检查依据，完成硬件验收后再发布；本地测试固件是模拟字节，不能烧写硬件。Game Jam投稿没有自动授予星球成长奖励。

## API

| 接口 | 权限／用途 |
| --- | --- |
| GET /api/game-jam/projects | 公开已发布作品；不返回邮箱、私有审核说明或文件BLOB |
| GET /api/game-jam/mine | 本人全部投稿及审核反馈 |
| POST /api/game-jam/projects | 成员multipart上传并原子保存，初始pending；重试去重 |
| GET /api/game-jam/projects/:id/firmware | 已登录成员下载已发布固件；私有稿件仅作者／管理员 |
| GET /api/game-jam/projects/:id/manifest | 与固件相同权限，下载event-app.json |
| GET /api/game-jam/projects/:id/cover | 已发布封面公开；私有封面仍鉴权 |
| GET /api/admin/game-jam/projects | 管理员查看投稿与审核说明 |
| POST /api/admin/game-jam/projects/:id/review | 管理员提交status（published/rejected）、note（1–1000字），追加审核记录 |

## 本地测试与运行

```sh
npm test
npm start
```

本机数据库已经迁移。其他尚未升级的本地数据库先备份，再执行npm run migrate；不能用新空库替换旧库。网站本地入口http://127.0.0.1:3300/#game-jam。真实SMTP配置的登录会实际发邮件；自动回归使用临时数据库和模拟邮件。

可选浏览器测试：提供PLAYWRIGHT_MODULE和CHROMIUM_PATH后运行node test/game-jam-browser.mjs、node test/login-browser.mjs及node test/planet-browser.mjs。截图位于../outputs/game_jam_local_20261006与../outputs/profile_first_20261006。

**信心：★★★★★（本地数据库、API与桌面／手机浏览器）；★★★☆☆（真实固件运行）。** 52项隔离回归通过，覆盖上传校验、审核权限、去重、持久化、文件下载及无损迁移；浏览器走通投稿→审核→画廊→下载。云端发布需先备份再应用0011；真机兼容性仍需单独验收。
