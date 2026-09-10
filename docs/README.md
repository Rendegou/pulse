# PULSE 学习与开发入口

版本：协作路线 v3 · 更新：2026-09-10 · 已提交基线：`cb28b32`，另有本轮重构工作区改动。

采用 **AI 完成功能包，你练一个关键点**。常规实现、接线与测试脚手架交给 AI；学习状态与产品完成状态分别记录。

## 当前从这里开始

1. [07 当前开发路线与 agent 提示词](07-ai-assisted-roadmap.md)：详细实施边界、数据与协议、验收、首轮和后续交接文本。**G0 已提交，下一包是 G1 稳定身份与个人岛。**
2. [05 进度与验证](05-progress-and-validation.md)：已有实现、历史检查、本轮复核与未验证事项。先读事实，再按路线做下一包。
3. [16 前后端架构与开发入口](16-frontend-foundation.md)：Vue 外壳、引擎、连接、Go 职责与构建命令。
4. [guide 每轮协作方式](guide.md)：AI 怎么加速、用户如何抓住一个关键点。

下一版本的目标是：**关掉页面再回来，我的岛还在；朋友打开链接，到的确实是我的岛；他能浇水，却不能改乱我的布置。**

顺序：**G0 保存一致性 → G1 稳定身份与个人岛 → G2 真实拜访 → G3 少量布置保存。** 暂时固定现有潮汐视觉；只修使用障碍，不开启新一轮风格重做。

## 当前已经有什么

花园、指针与 G0 保存一致性已提交于 `cb28b32`。本轮将界面迁到 frontend/src 的 Vue 3 + Vite，保留独立粒子引擎；Go 按职责拆文件，生产内嵌 static/dist。

当前仍是三座固定示例岛，连接身份临时生成。稳定用户、owner 关系、个人岛存储、真实邀请路由和主人编辑权限尚未实现。“打开访客窗口”是 Demo 测试入口，G2 将以真实邀请和来访流程替代。

本轮已运行前端测试、Go 测试/vet、构建与真实浏览器交互检查，证据和未验证范围见 05。未提交、推送或部署；旧工具只作历史参考。

## 产品方向与视觉参考

- [14 自己的小世界，真实的相遇](14-personal-worlds-direction.md)：概念方向，核心是个人空间、来访与共同痕迹；文章是可选内容。
- [15 一起浇一捧水](15-tidal-garden-demo.md)：独立互动 Demo 的设计、实现与验证记录。原型后来已接进正式产品，具体当前状态看 05。
- [潮汐视觉 HTML](../outputs/pulse-tidal-islands.html)与[花园互动 HTML](../outputs/pulse-tidal-garden.html)：保留作参考，不是第二套生产服务；不要把 Demo 的 Node/SSE 再迁回 Go 产品。
- [13 粒子纵深](13-particle-depth-direction.md)、[10 抽象空间与性能](10-abstract-space-and-performance.md)：历史视觉与性能探索，按需查阅，不决定当前实施顺序。
- [08 旧书房方案](08-ui-redesign-brief-for-kimi.md)、[09 粒子世界](09-particle-world-experience.md)、[11 文章岛](11-publication-islands.md)、[12 横版岛](12-floating-isles-stele-forest.md)：历史方案，其中多个方向已被后续决定替代。

## 教材与协作规范

- [01 早期项目方案](01-project-plan.md)：早期协议与资源预算背景；与现行路线冲突时以当前源码和 07 为准。
- [02 运行机制教材](02-runtime-guide.md)：已有 Go 与 JavaScript 调用链。
- [03 课程库](03-handwritten-lessons.md)：按需练习，不逐课解锁产品。L1–L3、脉冲和可靠连接已有实现，不从头重做。
- [04 代码规范](04-code-conventions.md)：注释、职责与交付约定。
- [06 原型到产品](06-prototype-to-product.md)：早期专题背景。
- [中文注释 Skill](../.agents/skills/comment-convention/SKILL.md)与[手写陪练 Skill](../.agents/skills/handwrite-coach/SKILL.md)：提示方式继续适用；AI 与用户分工以根目录 AGENTS.md、当前 07 为准。
- [2026-09-07 路线归档](07-ai-assisted-roadmap-2026-09-07-archive.md)：保留旧 A/B 功能包和协作来历，不执行其中旧提示词。

## 文档维护规则

当前执行顺序只维护在 07；实际证据只维护在 05；README 指向二者，不在多个文档里各写一套“下一步”。

每轮 agent 先读 AGENTS.md、README、05，再核对工作区、源码与对应功能包。发现文档落后就更新事实，不能覆盖用户现有修改。历史 Demo、references 和原型验证不能代替正式接口与真实页面的验证。

每轮交付区分：有实现、有验证、用户已读懂、能独立迁移。提交、推送、部署按当次授权；main push 会触发自动部署。
