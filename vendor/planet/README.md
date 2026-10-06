# 星球源码来源与本地适配

- **版本：** v1.0
- **负责人：** 网站技术维护者；上游星球团队维护美术与模型
- **状态：** 按固定提交引入的最小 H5 构建源码
- **最后更新：** 2026-10-06

来源：[herstory-pop-city-3d-planet](https://github.com/fang2544/herstory-pop-city-3d-planet)，提交 `2a1ed5e8f5315b9a22fc1f002a01f057e0df1e37`。保留模型、Three.js 与其版权许可、页面源码、活动配置；未引入测试截图、开发依赖、DAY14 演示入口或真实业务数据。

额外引入 `backend/pixel-planet/service.cjs`／`rules.json`，像素渲染器仅在 A 后端生成硬件 RGB565 帧；不在网站载入。

本地变更：启动前由主服务注入身份；严格检查快照归属；仅初始 3D 状态；网页 2D 入口与像素导出移除；报告待开放；照片中性标记；iframe 自适应布局；会话失效清除；画面不在视区时暂停绘制。对应 `host-integration.js/css`、身份／快照模块及构建脚本。

从网站目录运行 `npm run build:planet` 重建 `frontend/ui-design/Herstory-星域-H5.html`。此目录不由静态文件服务器开放；通过鉴权 `/planet` 返回加入真实快照后的 HTML。

来源文件保留项目方素材的原授权范围；第三方许可见 [THIRD-PARTY-NOTICES](THIRD-PARTY-NOTICES.md) 和 [Three.js 许可](frontend/vendor/licenses/THREE-LICENSE.txt)。

**Confidence：★★★★★。** 固定提交来源与构建路径可复核。


## 个人资产授权增量（2026-10-06）

主网站构建增加源模型路径注册表与固定单元manifest，将后台个人授权映射到原几何可见性。日期动画中的车厢、飞艇和出租车可见性改由资产控制；布局、造型与运动轨迹保留。信号灯别名使用显式railSignals数组，铁路基础不包含两次专属灯奖励。构建检查世界与注册表摘要；未来重新冻结清单仅用于新版本发布，不覆盖已启用版本。细节见主仓库 [成长说明](../../planet_growth_v1.0.md)。
