use std::collections::HashMap;
use serde::{Deserialize, Serialize};

/// AI 回复中引用的消息（角色自主引用历史对话）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuoteInfo {
    /// 被引用的消息原文
    pub content: String,
    /// 说话者：角色名字或用户名字
    pub speaker: String,
    /// 可选的时间描述，如 "早上 8:34"
    #[serde(default)]
    pub time: Option<String>,
}

/// AI 回复的完整响应结构
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentResponse {
    pub reply: String,
    pub emotion: String,
    #[serde(default)]
    pub speech: String,
    #[serde(default)]
    pub action: String,
    #[serde(default)]
    pub actions: Vec<ToolAction>,
    /// DeepSeek thinking 模式的推理过程
    #[serde(default)]
    pub reasoning_content: Option<String>,
    /// LLM 直接指定的属性值变化（覆盖 emotion 映射），格式: {"stat_trust": 20, "stat_affection": 15}
    #[serde(default)]
    pub stat_deltas: HashMap<String, i32>,
    #[serde(default)]
    pub stat_values: HashMap<String, i32>,
    /// 角色自主引用的历史消息（可选）
    #[serde(default)]
    pub quote: Option<QuoteInfo>,
}

/// AI 发起的工具调用
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolAction {
    pub tool: String,
    pub content: String,
}

/// 聊天消息（用于历史记录）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
    /// DeepSeek thinking 模式的推理过程（需要回传给 API）
    #[serde(default)]
    pub reasoning_content: Option<String>,
}

/// API 配置（含用户信息，用于拼 prompt）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiSettings {
    pub endpoint: String,
    pub api_key: String,
    pub model: String,
    pub temperature: f64,
    pub max_tokens: u32,
    #[serde(default)]
    pub user_name: String,
    #[serde(default)]
    pub user_persona: String,
    #[serde(default)]
    pub system_prompt: String,
}

/// 角色信息（从数据库传入）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CharacterInfo {
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub personality: String,
    #[serde(default)]
    pub world_name: String,
    #[serde(default)]
    pub world_description: String,
    /// 陪伴卡当前人格状态描述文本（待注入 system prompt）
    #[serde(default)]
    pub personality_state_text: String,
    /// 当前属性值 JSON，如 {"stat_happy":80,"stat_trust":70}
    #[serde(default)]
    pub stat_values_json: String,
}

/// System Prompt 可排序模块配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PromptBlockConfig {
    pub id: String,
    pub enabled: bool,
}

/// System Prompt 模块排序配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PromptOrder {
    pub blocks: Vec<PromptBlockConfig>,
}

impl Default for PromptOrder {
    fn default() -> Self {
        Self {
            blocks: vec![
                PromptBlockConfig { id: "user_info".into(), enabled: true },
                PromptBlockConfig { id: "global_system_prompt".into(), enabled: true },
                PromptBlockConfig { id: "character_identity".into(), enabled: true },
                PromptBlockConfig { id: "character_soul".into(), enabled: true },
                PromptBlockConfig { id: "character_stats".into(), enabled: true },
                PromptBlockConfig { id: "personality_state".into(), enabled: true },
                PromptBlockConfig { id: "memory".into(), enabled: true },
                PromptBlockConfig { id: "diary_context".into(), enabled: true },
                PromptBlockConfig { id: "banned_words".into(), enabled: true },
                PromptBlockConfig { id: "tools".into(), enabled: true },
                PromptBlockConfig { id: "behavior_rules".into(), enabled: true },
                PromptBlockConfig { id: "world_info".into(), enabled: true },
            ],
        }
    }
}

/// 旁白/主动消息队列的单条记录
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NarrationItem {
    pub id: u32,
    /// LLM 输出的相对延迟（秒），保存时转为 absolute scheduled_at
    pub delay_seconds: u32,
    /// ISO 8601 绝对发送时间（由 save_queue 从 delay_seconds 计算）
    #[serde(default)]
    pub scheduled_at: String,
    /// "action" 或 "dialogue"
    pub narration_type: String,
    pub text: String,
    pub delivered: bool,
}

/// 旁白/主动消息队列（一次 API 调用生成的整组）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NarrationQueue {
    pub chat_id: u32,
    pub created_at: String,
    pub items: Vec<NarrationItem>,
}

/// LLM 原生 tool call 结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NativeToolCall {
    pub id: String,
    pub name: String,
    pub arguments: String,
}

/// 带 tools 参数的 LLM 调用结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmChatResult {
    /// 文本内容（tool_call 时可能为 None）
    pub content: Option<String>,
    /// DeepSeek thinking 模式的推理过程
    #[serde(default)]
    pub reasoning_content: Option<String>,
    /// 原生工具调用
    pub tool_calls: Vec<NativeToolCall>,
}

/// Agent 上下文（soul/memory/world 三文件）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentContext {
    pub soul: String,
    pub memory: String,
    pub world: String,
    #[serde(default)]
    pub user_info: String,
    #[serde(default)]
    pub banned_global: String,
    #[serde(default)]
    pub banned_character: String,
}
