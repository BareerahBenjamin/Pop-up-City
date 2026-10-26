# Pop-up-City 协作边界

本交付基于 f76f379，禁止引入后续专用签到板/联合签到补丁。前端任务默认只修改 public/ 的页面、样式和浏览器脚本；不得为完成页面任务修改硬件接口、签名、字段、错误码、状态机、数据库结构或固件。

开始工作先阅读 docs/hardware-interface-boundary.zh-CN.md。hardware-interface/、hardware-cloud/、hardware.js、device-enrollment.js、hardware-cloud.js 是硬件区域。api.js、server.js、database.js、planet.js、planet-growth.js、profile.js、config.js、covers.js、migrations/、config/、vendor/、assets/fonts/ 等是硬件共享依赖，改动须由硬件负责人审查。

不得更新 hardware-interface/protected-files.json 的摘要来掩盖前端任务导致的变化；不得禁用校验、删测试、降低断言、跳过部署门禁或更改工作流。需要改变硬件契约时先提出明确的兼容性方案，用户批准后由硬件负责人更新实现、测试、契约文档及冻结摘要。

任何前端交付运行 npm test 和 npm run check:hardware。修改硬件相关代码另运行 npm run test:hardware，并记录真机尚未验证；测试通过不代表授权烧录或部署。README 的本地运行方式继续有效。不要提交密钥、令牌、个人数据库、设备初始化记录。

本版网站合并详情：docs/website-merge-20261022.zh-CN.md。附件只合入课件/活动发起人管理/日历改动，设备实现及绑定报名规则保持当前基线；本次用户授权的共享后端变更已记录验收。不得用附件旧硬件代码回填。
