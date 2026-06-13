# v1.0.3-hotfix8 — 对话对象识别修复

## 问题
连续4轮改造（init_chat_memory → user_info.md → settings 兜底 → 双重保险）后角色仍不认识用户。

## 根因
**不是代码 bug，是 prompt 排布问题。** System prompt 共7段，用户信息在第4位，
9B 模型的注意力峰值在首尾，第4位衰减严重，模型扫不到用户名字。

LM Studio 里好用是因为 prompt 短且用户信息靠前。

## 修复
把【对话对象】段从第4位提到第1位（在身份设定之前），用命令式语言：
- 你现在正在和这个人对话
- 绝对不要问「你是谁」「你叫什么名字」

## 架构（最终版）
```
context/
├── user_info.md          ← 全局用户信息（Settings 改即更新）
├── char_{id}/soul.md     ← 角色性格
├── char_{id}/world.md    ← 世界观
└── chat/{id}_memory.md   ← 对话记忆（AI write_memory 写入）
```
