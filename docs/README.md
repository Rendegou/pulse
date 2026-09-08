# PULSE 学习与开发入口

版本：协作计划 v2 · 更新：2026-09-07 · 核对源码：`4946e28`

现在采用 **AI 完成功能包，你练一个关键点**。基础页面、接线、重复代码与测试脚手架交给 AI；你练契约、状态、所有权、反例和关键改动。学习状态与产品进度分别记录。

## 现在看这三处

**2026-09-09 最新产品方向：[14 自己的小世界，真实的相遇](14-personal-worlds-direction.md)。** 每个人有自己的岛，核心是拜访、陪伴和共同留下痕迹；文章是可选内容。用户认可 [潮汐群岛 HTML](../outputs/pulse-tidal-islands.html) 的整体视觉，文章陈列仍待调整。

同日实现：潮汐群岛视觉已迁入正式前端（`static/world.js` 三层画布 + `static/islands.js` 岛屿数据），后端加入权威岛屿列表与访客在场（cursor v=3、`presence` 广播）。证据与限制见 [进度与验证](05-progress-and-validation.md) 顶部；**画面是否好看仍由用户实际操作后评价**。

此前视觉探索：[13 粒子纵深](13-particle-depth-direction.md)（复盘 + §9 实现记录），保存俯瞰粒子地表、镜头纵深与三篇文章标签的尝试。该文包含不同轮次的原型和产品改动记录，具体实现以源码为准；三篇文章的摆放不能作为新方向的强制要求。

2026-09-08 先前记录：[11 文章岛](11-publication-islands.md) 曾是正式前端视觉实现（纵深不足）；[12 横版多层岛](12-floating-isles-stele-forest.md) 是被否定的实验（原型与截图已清理）；[10 抽象空间与性能](10-abstract-space-and-performance.md) 记录此前缓存修复与性能对照。

历史 UI 背景见 [09 粒子地表世界](09-particle-world-experience.md) 与 [当时的 Demo](../outputs/pulse-particle-world-demo.html)，用于理解巨大曲面和连续靠近的初衷，不作为当前验收目标。[08 旧书房方案](08-ui-redesign-brief-for-kimi.md) 保留主题、双语等背景。当前执行先读 13；下列课程进度仍需结合最新源码判断。

1. [新执行路线与 agent 交接文本](07-ai-assisted-roadmap.md)：当前下一包是点击脉冲，不再从 L1 重来。
2. [进度与验证](05-progress-and-validation.md)：确认已有实现、实际检查和仍缺的证据。
3. [每轮协作方式](guide.md)：怎样让 AI 加速，又保留独立理解和修改能力。

推荐顺序：**点击互动 → 可靠连接 → 固定二维博客街区**。先补直接可复用的基础，再做两间房、两篇文章、两个真实访客一起逛。Host Radar 保留为独立方向，不作为博客世界的必修前置。

## 按问题查资料

- [项目落地方案](01-project-plan.md)：产品边界、协议、资源预算和发布条件。
- [运行机制教材](02-runtime-guide.md)：实际事件、消息、锁、时间与绘制调用链。
- [课程库 L0–L10](03-handwritten-lessons.md)：需要练某个概念时选一张卡，不必逐课通关。
- [代码与注释规范](04-code-conventions.md)：AI 和手写代码共同执行的要求。
- [原型到产品](06-prototype-to-product.md)：原始 PULSE、Host Radar 和性能愿景的专题材料。
- [World Notes](ideas/2026-09-05-world-notes.md)：二维博客构想及独立 Demo；原型不等于真实多人服务。
- [注释 Skill](../.agents/skills/comment-convention/SKILL.md) 与 [陪练 Skill](../.agents/skills/handwrite-coach/SKILL.md)：继续执行注释、提示与能力验收；实现分工以根目录 AGENTS.md 和新路线为准。

## 文档使用规则

执行顺序以新路线为准，已完成事实以进度加当前源码为准；课程里的拟定函数名不是强制架构。出现冲突先核对源码，不把旧题目重新当待办。

当前 L1 已接通；L2 有 Hermite、段冻结和练习记录；L3a–c 已实现。不能由此推定每个概念都已独立掌握，也不要求为补齐学习记录重写整个功能。

归档的 Demo、概念文档和历史对话用于理解产品意图；真实行为以程序为准。`docs/references/` 保持原样，不让历史材料覆盖最新排期。
