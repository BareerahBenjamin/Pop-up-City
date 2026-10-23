# 硬件与官网接口协作边界

基线：用户于2026-10-21确认已恢复的 f76f379。硬件负责人：@whyyt。此次只重构入口与增加协作校验；没有改变页面、协议、活动规则、数据库结构或RC40，没有加入专用板/联合签到例外。

## 封装职责

- hardware-interface/gateway.mjs：设备路由、Bearer鉴权、独立16,000字节JSON输入校验、设备相关管理员模块分发。api.js只分发设备请求，不再内嵌设备鉴权和业务路由；设备解析不依赖前端表单的解析函数。
- hardware-cloud/、device-enrollment.js、hardware.js、hardware-cloud.js：原实现逐字节保持f76f379。
- api.js、server.js、数据库迁移、星球成长、资源：共享后端依赖，改动统一要求@whyyt审查。
- 前端默认只改public/下页面、样式和浏览器脚本；既有绑定接口调用的路径/字段/交互语义如需改变，也要先请硬件负责人审查。后端CODEOWNERS不自动审查所有前端UX变化。

## 对外协议

保持 /api/device/*、/api/device-enrollment/*、/local/* 原方法、路径、鉴权和响应。RC40不需要更新域名或固件。管理员设备操作继续原/api/admin/*路径及Cookie、Origin、管理员校验，不给浏览器设备令牌权限。

保留真实设备令牌、HMAC签名、近距离证明、时效、幂等、撤销和原签到资格规则。字段、大小写、错误码、位图、重试均属于协议；不得用假成功、公共令牌、去证书校验或放宽校验来修页面。原接口文档见 hardware_api_v1.0.md、hardware_cloud_setup.zh_CN.md、hardware_self_binding_v1.0.md、device_claim_setup.zh_CN.md。

## 自动校验

- npm run check:hardware：受保护文件摘要，拒绝修改、删除、新增和符号链接；public改动不触发摘要错误。
- npm run test:hardware：硬件相关接口回归。
- npm test：先冻结检查再完整回归；现有deploy.sh执行npm test，因此部署也拦截未审阅的保护区变更。
- .github/workflows/hardware-contract.yml：PR/push运行上述检查。
- hardware-interface/protected-files.json：已审阅实现摘要。前端不得更新摘要来绕过失败。

摘要防误改，不是访问控制：可改整个仓库的人也可替换检查器和摘要。必须启用下列规则才有强制审查。

## GitHub需由管理员设置

合入实际仓库后，在 Settings → Rules → Rulesets 为发布分支配置：
1. Require a pull request before merging；Require review from Code Owners，至少1个批准。
2. Dismiss stale approvals；Require approval of most recent reviewable push。
3. Require status checks to pass，选择工作流实际跑出的hardware-contract job，建议要求分支最新。
4. 禁止强推、删除和直接推送绕过；按团队需求限制管理员/机器人bypass。
5. 确认@whyyt对仓库有写权限，否则CODEOWNERS不生效。若PR作者就是唯一Owner whyyt，不能自我批准，需再指定一位可信审查者。
6. 基础分支必须先有CODEOWNERS和工作流；.github、校验器、摘要和共享后端的改动同样需要硬件负责人审批。
套餐/可见性是否支持以GitHub实际设置为准。本次未操作远端设置、提交或推送。

## 协议升级与验收

硬件负责人确需更新时：先写具体变更与兼容性，经用户批准后改实现、用例、契约和摘要，再审查；不能仅刷新摘要。固件改动另需分区协议校验及用户授权的真机验收。

本地检查不等于已上线或真机通过。本次未部署、未刷机，不迁移或重置数据库及存档。
