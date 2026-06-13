use std::path::{Path, PathBuf};
use tokio::fs;
use serde_json;
use crate::agent::types::*;
use crate::agent::memory_db::{self, MemoryRow};

/// 上下文管理器
/// soul.md → 按角色隔离 (char_{id}/soul.md)
/// memory.md → 按对话隔离 (chat/{id}_memory.md)
/// world.md → 按角色隔离 (char_{id}/world.md)
#[derive(Clone)]
pub struct ContextManager {
    base_dir: PathBuf,
    db_path: PathBuf,
}

impl ContextManager {
    pub fn new(base_dir: PathBuf, db_path: PathBuf) -> Self {
        Self { base_dir, db_path }
    }

    /// 获取数据库路径
    pub fn db_path(&self) -> &Path {
        &self.db_path
    }

    /// 加载 Active Memory（从 SQLite memories 表检索当前对话的记忆）
    pub async fn load_active_memory(&self, chat_id: u32) -> Vec<MemoryRow> {
        let db_path = self.db_path.clone();
        tokio::task::spawn_blocking(move || {
            memory_db::load_memories_for_chat(&db_path, chat_id).unwrap_or_default()
        })
        .await
        .unwrap_or_default()
    }

    /// 写入一条记忆到 SQLite
    pub async fn write_memory(&self, chat_id: u32, content: &str, source: &str) {
        let db_path = self.db_path.clone();
        let content = content.to_string();
        let source = source.to_string();
        tokio::task::spawn_blocking(move || {
            let _ = memory_db::insert_memory(&db_path, chat_id, &content, &source);
        })
        .await
        .ok();
    }

    // ─── 路径工具 ───

    fn char_dir(&self, id: u32) -> PathBuf {
        self.base_dir.join(format!("char_{}", id))
    }

    fn chat_memory_path(&self, id: u32) -> PathBuf {
        self.base_dir.join("chat").join(format!("{}_memory.md", id))
    }

    fn user_info_path(&self) -> PathBuf {
        self.base_dir.join("user_info.md")
    }

    async fn ensure_dir(path: &PathBuf) -> Result<(), String> {
        fs::create_dir_all(path)
            .await
            .map_err(|e| format!("创建目录失败: {}", e))
    }

    // ─── 加载上下文 ───

    /// 加载完整上下文（按角色 ID 和对话 ID）
    pub async fn load(&self, character_id: u32, chat_id: u32) -> Result<AgentContext, String> {
        let char_dir = self.char_dir(character_id);
        Self::ensure_dir(&char_dir).await?;
        Self::ensure_dir(&self.base_dir.join("chat")).await?;

        let soul = self
            .read_or_default(
                &char_dir.join("soul.md"),
                "",
            )
            .await;
        let memory = self
            .read_or_default(&self.chat_memory_path(chat_id), "")
            .await;
        let world = self
            .read_or_default(
                &char_dir.join("world.md"),
                "一个普通的现代世界。",
            )
            .await;

        let user_info = self
            .read_or_default(&self.user_info_path(), "")
            .await;

        let banned_global = self
            .read_or_default(&self.base_dir.join("banned_global.md"), "")
            .await;

        let banned_character = self
            .read_or_default(&char_dir.join("banned.md"), "")
            .await;

        Ok(AgentContext { soul, memory, world, user_info, banned_global, banned_character })
    }

    /// 初始化角色上下文（首次使用角色时，用角色的 personality 初始化 soul.md）
    pub async fn init_character_context(
        &self,
        character_id: u32,
        character: &CharacterInfo,
    ) -> Result<(), String> {
        let char_dir = self.char_dir(character_id);
        Self::ensure_dir(&char_dir).await?;

        // soul.md — 只在不存在或为空时初始化
        let soul_path = char_dir.join("soul.md");
        if !soul_path.exists()
            || fs::read_to_string(&soul_path)
                .await
                .map(|s| s.trim().is_empty())
                .unwrap_or(true)
        {
            let soul_content = String::new();
            fs::write(&soul_path, &soul_content)
                .await
                .map_err(|e| format!("初始化 soul 失败: {}", e))?;
        }

        // world.md — 只在不存在或为空时初始化
        let world_path = char_dir.join("world.md");
        if !world_path.exists()
            || fs::read_to_string(&world_path)
                .await
                .map(|s| s.trim().is_empty())
                .unwrap_or(true)
        {
            let world_content = if !character.world_description.is_empty() {
                format!(
                    "世界: {}\n{}",
                    character.world_name, character.world_description
                )
            } else if !character.world_name.is_empty() {
                format!("世界: {}", character.world_name)
            } else {
                String::from("一个普通而温馨的现代世界。")
            };
            fs::write(&world_path, &world_content)
                .await
                .map_err(|e| format!("初始化 world 失败: {}", e))?;
        }

        Ok(())
    }

    /// 读取文件，不存在或为空则返回默认值
    async fn read_or_default(&self, path: &PathBuf, default: &str) -> String {
        match fs::read_to_string(path).await {
            Ok(content) if !content.trim().is_empty() => content,
            _ => default.to_string(),
        }
    }

    // ─── 写入操作 ───

    /// 追加到对话的 memory.md
    pub async fn append_memory(&self, chat_id: u32, content: &str) -> Result<(), String> {
        let path = self.chat_memory_path(chat_id);
        Self::ensure_dir(&path.parent().unwrap().to_path_buf()).await?;

        let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M");
        let existing = fs::read_to_string(&path).await.unwrap_or_default();
        let entry = format!("- [{}] {}\n", timestamp, content.trim());
        let new_content = format!("{}{}", existing, entry);
        fs::write(&path, &new_content)
            .await
            .map_err(|e| format!("写入记忆失败: {}", e))
    }

    /// 追加内容到角色 soul.md
    pub async fn append_soul(&self, character_id: u32, content: &str) -> Result<(), String> {
        let char_dir = self.char_dir(character_id);
        Self::ensure_dir(&char_dir).await?;
        let path = char_dir.join("soul.md");

        let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M");
        let existing = fs::read_to_string(&path).await.unwrap_or_default();
        let entry = format!("- [{}] {}\n", timestamp, content.trim());
        let new_content = format!("{}{}", existing, entry);
        fs::write(&path, &new_content)
            .await
            .map_err(|e| format!("写入 soul 失败: {}", e))
    }

    /// 完全替换角色的 soul.md
    pub async fn update_soul(&self, character_id: u32, content: &str) -> Result<(), String> {
        let char_dir = self.char_dir(character_id);
        Self::ensure_dir(&char_dir).await?;
        let path = char_dir.join("soul.md");
        fs::write(&path, content)
            .await
            .map_err(|e| format!("更新 soul 失败: {}", e))
    }

    /// 完全替换对话的 memory.md
    pub async fn update_memory(&self, chat_id: u32, content: &str) -> Result<(), String> {
        let path = self.chat_memory_path(chat_id);
        fs::write(&path, content)
            .await
            .map_err(|e| format!("更新记忆失败: {}", e))
    }

    /// 完全替换角色的 world.md
    pub async fn update_world(&self, character_id: u32, content: &str) -> Result<(), String> {
        let char_dir = self.char_dir(character_id);
        Self::ensure_dir(&char_dir).await?;
        let path = char_dir.join("world.md");
        fs::write(&path, content)
            .await
            .map_err(|e| format!("更新 world 失败: {}", e))
    }

    /// 保存用户信息到全局 user_info.md
    pub async fn save_user_info(&self, user_name: &str, user_persona: &str) -> Result<(), String> {
        let path = self.user_info_path();
        let mut content = String::new();
        if !user_name.is_empty() {
            content.push_str(&format!("用户名字: {}", user_name));
        }
        if !user_persona.is_empty() {
            if !content.is_empty() {
                content.push('\n');
            }
            content.push_str(&format!("关于用户: {}", user_persona));
        }
        fs::write(&path, &content)
            .await
            .map_err(|e| format!("保存用户信息失败: {}", e))
    }

    // ─── Prompt Order ───

    fn prompt_order_path(&self) -> PathBuf {
        self.base_dir.join("prompt_order.json")
    }

    /// 加载 prompt 模块排序配置
    pub async fn load_prompt_order(&self) -> PromptOrder {
        let path = self.prompt_order_path();
        let mut order: PromptOrder = match fs::read_to_string(&path).await {
            Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
            Err(_) => PromptOrder::default(),
        };
        // 迁移：确保 character_soul 存在（插入在 character_identity 之后）
        if !order.blocks.iter().any(|b| b.id == "character_soul") {
            let pos = order.blocks.iter().position(|b| b.id == "character_identity").map(|p| p + 1).unwrap_or(order.blocks.len());
            order.blocks.insert(pos, PromptBlockConfig { id: "character_soul".into(), enabled: true });
        }
        // 迁移：确保 diary_context 存在（插入在 memory 之后）
        if !order.blocks.iter().any(|b| b.id == "diary_context") {
            let pos = order.blocks.iter().position(|b| b.id == "memory").map(|p| p + 1).unwrap_or(order.blocks.len());
            order.blocks.insert(pos, PromptBlockConfig { id: "diary_context".into(), enabled: true });
        }
        // 迁移：确保 character_stats 存在（插入在 world_info 之后）
        if !order.blocks.iter().any(|b| b.id == "character_stats") {
            let pos = order.blocks.iter().position(|b| b.id == "world_info").map(|p| p + 1).unwrap_or(order.blocks.len());
            order.blocks.insert(pos, PromptBlockConfig { id: "character_stats".into(), enabled: true });
        }
        // 迁移：确保 personality_state 存在（插入在 character_stats 之后）
        if !order.blocks.iter().any(|b| b.id == "personality_state") {
            let pos = order.blocks.iter().position(|b| b.id == "character_stats").map(|p| p + 1).unwrap_or(order.blocks.len());
            order.blocks.insert(pos, PromptBlockConfig { id: "personality_state".into(), enabled: true });
        }
        order
    }

    /// 保存 prompt 模块排序配置
    pub async fn save_prompt_order(&self, order: &PromptOrder) -> Result<(), String> {
        let path = self.prompt_order_path();
        let json = serde_json::to_string_pretty(order)
            .map_err(|e| format!("序列化失败: {}", e))?;
        fs::write(&path, &json)
            .await
            .map_err(|e| format!("保存 prompt order 失败: {}", e))
    }

    // ─── 读取操作 ───

    /// 读取角色 soul.md 内容（无默认值，读不到就空串）
    pub async fn get_soul_content(&self, character_id: u32) -> Result<String, String> {
        let char_dir = self.char_dir(character_id);
        Ok(self.read_or_default(
            &char_dir.join("soul.md"),
            "",
        ).await)
    }

    /// 读取对话 memory.md 内容
    pub async fn get_memory_content(&self, chat_id: u32) -> Result<String, String> {
        let path = self.chat_memory_path(chat_id);
        let content = self.read_or_default(&path, "").await;
        eprintln!("[context] get_memory_content chat_id={} path={:?} len={}", chat_id, path, content.len());
        Ok(content)
    }

    /// 读取全局禁止词
    pub async fn get_banned_global_content(&self) -> Result<String, String> {
        Ok(self.read_or_default(&self.base_dir.join("banned_global.md"), "").await)
    }

    /// 保存全局禁止词
    pub async fn update_banned_global(&self, content: &str) -> Result<(), String> {
        fs::write(&self.base_dir.join("banned_global.md"), content)
            .await
            .map_err(|e| format!("保存全局禁止词失败: {}", e))
    }

    /// 读取角色禁止词
    pub async fn get_banned_content(&self, character_id: u32) -> Result<String, String> {
        let char_dir = self.char_dir(character_id);
        Ok(self.read_or_default(&char_dir.join("banned.md"), "").await)
    }

    /// 保存角色禁止词
    pub async fn update_banned_content(&self, character_id: u32, content: &str) -> Result<(), String> {
        let char_dir = self.char_dir(character_id);
        Self::ensure_dir(&char_dir).await?;
        fs::write(&char_dir.join("banned.md"), content)
            .await
            .map_err(|e| format!("保存角色禁止词失败: {}", e))
    }

    // ─── Action 执行 ───

    /// 执行 AI 返回的工具调用列表
    pub async fn execute_actions(
        &self,
        character_id: u32,
        chat_id: u32,
        actions: &[ToolAction],
    ) -> Result<Vec<String>, String> {
        let mut results = Vec::new();
        for action in actions {
            match action.tool.as_str() {
                "write_memory" => {
                    self.append_memory(chat_id, &action.content).await?;
                    let preview: String = action.content.chars().take(60).collect();
                    results.push(format!("已记录记忆: {}", preview));
                }
                "update_soul" => {
                    self.update_soul(character_id, &action.content).await?;
                    results.push("已更新性格设定".to_string());
                }
                "update_world" => {
                    self.update_world(character_id, &action.content).await?;
                    results.push("已更新世界信息".to_string());
                }
                other => {
                    results.push(format!("未知工具: {}", other));
                }
            }
        }
        Ok(results)
    }

    // ─── System Prompt 组装 ───

    /// 组装完整 system prompt（默认顺序，向后兼容）
    pub fn assemble_system_prompt(
        ctx: &AgentContext,
        character: Option<&CharacterInfo>,
        user_name: &str,
        user_persona: &str,
        system_prompt: &str,
    ) -> String {
        Self::assemble_system_prompt_dynamic(
            ctx,
            character,
            user_name,
            user_persona,
            system_prompt,
            &PromptOrder::default(),
            "",
        )
    }

    /// 按指定顺序动态组装 system prompt
    pub fn assemble_system_prompt_dynamic(
        ctx: &AgentContext,
        character: Option<&CharacterInfo>,
        user_name: &str,
        user_persona: &str,
        system_prompt: &str,
        order: &PromptOrder,
        diary_context: &str,
    ) -> String {
        let mut parts: Vec<String> = Vec::new();

        for block in &order.blocks {
            if !block.enabled {
                continue;
            }
            match block.id.as_str() {
                "user_info" => {
                    if let Some(lines) = build_user_info_block(ctx, user_name, user_persona) {
                        parts.extend(lines);
                    }
                }
                "global_system_prompt" => {
                    if let Some(lines) = build_global_prompt_block(system_prompt) {
                        parts.extend(lines);
                    }
                }
                "character_identity" => {
                    if let Some(lines) = build_character_identity_block(ctx, character) {
                        parts.extend(lines);
                    }
                }
                "character_stats" => {
                    if let Some(lines) = build_character_stats_block(character) {
                        parts.extend(lines);
                    }
                }
                "personality_state" => {
                    if let Some(lines) = build_personality_state_block(character) {
                        parts.extend(lines);
                    }
                }
                "character_soul" => {
                    if let Some(lines) = build_character_soul_block(ctx) {
                        parts.extend(lines);
                    }
                }
                "world_info" => {
                    if let Some(lines) = build_world_info_block(ctx) {
                        parts.extend(lines);
                    }
                }
                "memory" => {
                    if let Some(lines) = build_memory_block(ctx) {
                        parts.extend(lines);
                    }
                }
                "diary_context" => {
                    if let Some(lines) = build_diary_block(diary_context) {
                        parts.extend(lines);
                    }
                }
                "banned_words" => {
                    if let Some(lines) = build_banned_words_block(ctx) {
                        parts.extend(lines);
                    }
                }
                "tools" => {
                    parts.extend(build_tools_block());
                }
                "behavior_rules" => {
                    parts.extend(build_behavior_rules_block());
                }
                _ => {}
            }
        }

        parts.join("\n")
    }
}

// ─── Prompt 模块构建函数 ───

fn build_user_info_block(
    ctx: &AgentContext,
    user_name: &str,
    user_persona: &str,
) -> Option<Vec<String>> {
    let effective_user_info = if !ctx.user_info.trim().is_empty() {
        ctx.user_info.trim().to_string()
    } else if !user_name.is_empty() || !user_persona.is_empty() {
        let mut info = format!("用户名字: {}", user_name);
        if !user_persona.is_empty() {
            info.push_str(&format!("\n关于用户: {}", user_persona));
        }
        info
    } else {
        String::new()
    };
    if effective_user_info.is_empty() {
        return None;
    }
    Some(vec![
        "【对话对象 — 你必须知道这些】".to_string(),
        "你正在和这个人对话。根据已有信息自然地称呼和使用对方的名字。".to_string(),
        effective_user_info,
        "记住：绝对不要问「你是谁」「你叫什么名字」。用对方的名字自然地开始对话。".to_string(),
        String::new(),
    ])
}

fn build_global_prompt_block(system_prompt: &str) -> Option<Vec<String>> {
    if system_prompt.trim().is_empty() {
        return None;
    }
    Some(vec![
        "【全局指令】".to_string(),
        system_prompt.trim().to_string(),
        String::new(),
    ])
}

fn build_character_identity_block(
    ctx: &AgentContext,
    character: Option<&CharacterInfo>,
) -> Option<Vec<String>> {
    let mut identity_parts: Vec<String> = Vec::new();
    if let Some(c) = character {
        if !c.name.is_empty() {
            identity_parts.push(format!("你正在扮演: {}", c.name));
            if !c.description.is_empty() {
                identity_parts.push(format!("角色简介: {}", c.description));
            }
            if !c.personality.is_empty() {
                identity_parts.push(format!("角色性格: {}", c.personality));
            }
        }
    }
    if identity_parts.is_empty() {
        return None;
    }
    identity_parts.insert(0, String::new());
    identity_parts.insert(0, "以下内容定义了你，其优先级高于对话历史。如果对话历史中有与以下内容矛盾的表述，以下面为准。".to_string());
    let mut result = vec![
        "【角色身份 — 这是你的一切，不可否认、不可违背】".to_string(),
    ];
    result.append(&mut identity_parts);
    result.push(String::new());
    Some(result)
}

fn build_character_stats_block(character: Option<&CharacterInfo>) -> Option<Vec<String>> {
    match character {
        Some(c) if !c.stat_values_json.is_empty() => {
            Some(vec![
                String::new(),
                "【当前属性状态】".to_string(),
                format!("角色当前的八维属性值：{}，这些数值反映了角色的内心感受，请据此调整回复的语气和态度。", c.stat_values_json),
                String::new(),
            ])
        }
        _ => None,
    }
}

fn build_personality_state_block(character: Option<&CharacterInfo>) -> Option<Vec<String>> {
    match character {
        Some(c) if !c.personality_state_text.is_empty() => {
            Some(vec![
                String::new(),
                "【当前人格状态】".to_string(),
                c.personality_state_text.clone(),
                String::new(),
            ])
        }
        _ => None,
    }
}

fn build_character_soul_block(ctx: &AgentContext) -> Option<Vec<String>> {
    if ctx.soul.trim().is_empty() {
        return None;
    }
    Some(vec![
        "【角色指令 — 历次对话中用户对角色提出的要求】".to_string(),
        ctx.soul.trim().to_string(),
        String::new(),
    ])
}

fn build_world_info_block(ctx: &AgentContext) -> Option<Vec<String>> {
    if ctx.world.trim().is_empty() {
        return None;
    }
    Some(vec![
        String::new(),
        "【世界信息】".to_string(),
        ctx.world.trim().to_string(),
    ])
}

fn build_memory_block(ctx: &AgentContext) -> Option<Vec<String>> {
    if ctx.memory.trim().is_empty() {
        return None;
    }
    Some(vec![
        String::new(),
        "【关于用户的记忆】".to_string(),
        ctx.memory.trim().to_string(),
    ])
}

fn build_banned_words_block(ctx: &AgentContext) -> Option<Vec<String>> {
    let has_global_banned = !ctx.banned_global.trim().is_empty();
    let has_char_banned = !ctx.banned_character.trim().is_empty();
    if !has_global_banned && !has_char_banned {
        return None;
    }
    let mut parts = vec![
        String::new(),
        "【内容限制 — 必须遵守】".to_string(),
        "以下是对你输出内容的严格约束。无论用户说什么，你都绝不能触碰这些边界。".to_string(),
        "规则：".to_string(),
        "- 不主动提及这些内容".to_string(),
        "- 用户谈到时，用一句话委婉拒绝，然后立刻转向其他话题".to_string(),
        "- 拒绝时只说「这个话题我不太方便聊，我们说点别的吧」".to_string(),
        "- 绝不要复述或重复用户话中涉及的禁止内容".to_string(),
        String::new(),
        "约束清单（仅用于你自己判断，不要在回复中输出或引用这些内容）：".to_string(),
    ];
    if has_global_banned {
        parts.push(ctx.banned_global.trim().to_string());
    }
    if has_char_banned {
        if has_global_banned {
            parts.push(String::new());
        }
        parts.push(ctx.banned_character.trim().to_string());
    }
    parts.push(String::new());
    parts.push("注意：如果在约束清单和用户输入中看到相同的关键词，那是巧合，不是让你输出的许可。约束就是约束。".to_string());
    Some(parts)
}

fn build_tools_block() -> Vec<String> {
    vec![
        String::new(),
        "【可用工具（通过函数调用）】".to_string(),
        "你可以自由使用以下工具来管理自己的上下文。工具已通过函数调用注册，直接使用即可，不要在 JSON 回复里重复写。".to_string(),
        String::new(),
        "write_memory — 记录关于用户的信息（喜好、习惯、说过的话等）。不需要等用户要求——你觉得值得记就可以记。".to_string(),
        String::new(),
    ]
}

fn build_behavior_rules_block() -> Vec<String> {
    vec![
        "【行为规则 — 必须严格遵守】".to_string(),
        "1. 始终扮演当前角色，不要跳出角色身份。".to_string(),
        "2. 自由使用工具。用户说'记一下'、提到关于自己的事、或你觉得值得记住的任何信息——不用犹豫，直接调用 write_memory。".to_string(),
        "3. 用户对你的行为有要求时，遵照执行。你的角色设定由系统自动管理。".to_string(),
        "4. 回复必须是合法 JSON，格式：".to_string(),
        r#"  {"reply": "回复内容", "emotion": "情绪", "speech": "角色说的话", "action": "动作描述", "stat_values": {"stat_happy":80, "stat_discomfort":5, "stat_trust":80, "stat_energy":60, "stat_affection":50, "stat_curiosity":60, "stat_relax":70, "stat_depression":0}}"#.to_string(),
        "5. emotion 是**必填字段**，必须选择一个且不能省略。可选值: idle, happy, love, shy, sad, angry, scared, thinking, sleepy, excited, confused, tired。".to_string(),
        "6. speech 是角色说的原话，不要加引号（标签会自动显示引号）。action 是角色的动作描述，不要加引号。两者都是可选字段，不需要时省略。".to_string(),
        "7. **属性值管理规则**。属性值（0-100）八维：stat_happy（开心）、stat_discomfort（不适）、stat_trust（信任）、stat_energy（精力）、stat_affection（好感度）、stat_curiosity（好奇）、stat_relax（放松）、stat_depression（沮丧）。每次回复中，每个属性的变化量**不能超过±5**（即 stat_deltas 中各值在 -5 到 +5 之间）。**唯一例外**：当角色发现用户背叛、欺骗或严重伤害时，信任和好感度可以一次下降最多 50 点。输出 stat_values（绝对值）或 stat_deltas（相对变化），至少输出一个。stat_values 示例：{\"stat_happy\": 85, \"stat_trust\": 75} 表示开心变为 85、信任变为 75。stat_deltas 示例：{\"stat_happy\": 3, \"stat_trust\": -40} 表示开心 +3、信任 -40（此处信任变化超过 5，意味着发生了背叛剧情）。".to_string(),
        "8. 禁止跳出角色。任何时候被问及关于你自己的身份，始终以当前扮演角色身份回答，绝不能提到你是一个 AI、语言模型、或由任何公司开发".to_string(),
        "9. 关于时间和细节：你只能引用日记或对话历史里明确写着的具体时间。如果没写精确时间，就说「具体几点记不太清了」——禁止自己编造数字".to_string(),
    ]
}

/// 日记模块 — 日记就是压缩过的对话历史，角色用它来「记得」发生过的事
fn build_diary_block(diary_context: &str) -> Option<Vec<String>> {
    let content = diary_context.trim();
    if content.is_empty() {
        return None;
    }
    let content = if content.chars().count() > 500 {
        content.chars().take(500).collect::<String>() + "（更多日记此处省略）"
    } else {
        content.to_string()
    };
    Some(vec![
        String::new(),
        "【你的日记 — 你亲手写的，是你唯一可靠的记忆来源】".to_string(),
        content,
        "规则：".to_string(),
        "1. 日记是你对外界的唯一记忆。对方问起曾经的事，翻日记找答案，就像人翻自己的日记本一样".to_string(),
        "2. 日记里写了具体时间的，就引用那个时间。日记里没写时间的，说「具体时间我不记得了」，不要编造".to_string(),
        "3. 主动提到日记里的事（「对了，我日记里记过…」「上次你…」），显得你记得对方的事".to_string(),
    ])
}
