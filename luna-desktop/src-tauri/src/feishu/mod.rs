use axum::{routing::post, Json, Router};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::{Arc, LazyLock, Mutex as StdMutex};
use tokio::sync::Mutex;
use tauri::{AppHandle, Manager};

use crate::agent::{types::*, AgentCore};

const FEISHU_BASE: &str = "https://open.feishu.cn/open-apis";

/// 已处理的 message_id 去重缓存
static DEDUP: LazyLock<StdMutex<HashSet<String>>> =
    LazyLock::new(|| StdMutex::new(HashSet::new()));

/// 飞书 Bot 配置
#[derive(Clone)]
pub struct FeishuConfig {
    pub app_id: String,
    pub app_secret: String,
}

/// 飞书 Bot 运行状态
pub struct FeishuBot {
    config: FeishuConfig,
    client: Client,
    token: Mutex<FeishuToken>,
}

#[derive(Clone)]
struct FeishuToken {
    access_token: String,
    expires_at: chrono::DateTime<chrono::Utc>,
}

impl FeishuToken {
    fn expired(&self) -> bool {
        chrono::Utc::now() >= self.expires_at
    }
}

#[derive(Deserialize)]
struct TokenResponse {
    code: i64,
    #[serde(default)]
    msg: String,
    tenant_access_token: Option<String>,
    expire: Option<i64>,
}

#[derive(Serialize)]
struct TokenRequest {
    app_id: String,
    app_secret: String,
}

#[derive(Serialize)]
struct ReplyBody {
    content: String,
    msg_type: String,
}

impl FeishuBot {
    pub fn new(config: FeishuConfig) -> Self {
        Self {
            config,
            client: Client::new(),
            token: Mutex::new(FeishuToken {
                access_token: String::new(),
                expires_at: chrono::Utc::now(),
            }),
        }
    }

    pub async fn get_token(&self) -> Result<String, String> {
        let mut tok = self.token.lock().await;
        if !tok.access_token.is_empty() && !tok.expired() {
            return Ok(tok.access_token.clone());
        }
        let body = TokenRequest {
            app_id: self.config.app_id.clone(),
            app_secret: self.config.app_secret.clone(),
        };
        let resp: TokenResponse = self
            .client
            .post(format!("{}/auth/v3/tenant_access_token/internal", FEISHU_BASE))
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("请求 token 失败: {}", e))?
            .json()
            .await
            .map_err(|e| format!("解析 token 失败: {}", e))?;
        if resp.code != 0 {
            return Err(format!("获取 token 失败: code={} msg={}", resp.code, resp.msg));
        }
        let token_str = resp.tenant_access_token.unwrap_or_default();
        let expire_secs = resp.expire.unwrap_or(7200) as i64;
        tok.access_token = token_str.clone();
        tok.expires_at = chrono::Utc::now() + chrono::Duration::seconds(expire_secs - 60);
        Ok(token_str)
    }

    pub async fn reply_message(&self, message_id: &str, text: &str) -> Result<(), String> {
        let token = self.get_token().await?;
        let body = ReplyBody {
            content: serde_json::json!({"text": text}).to_string(),
            msg_type: "text".into(),
        };
        let url = format!("{}/im/v1/messages/{}/reply", FEISHU_BASE, message_id);
        let resp = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", token))
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("发送回复失败: {}", e))?;
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        if !status.is_success() {
            log::error!("回复飞书失败: HTTP {} body={}", status, text);
        }
        Ok(())
    }
}

/// 启动飞书 Webhook 服务
pub async fn start_server(config: FeishuConfig, app: AppHandle) {
    let bot = Arc::new(FeishuBot::new(config));
    let app_state = Arc::new(app);
    let router = Router::new()
        .route("/webhook/feishu", post(move |body| handle_webhook(bot.clone(), app_state.clone(), body)));
    let addr = "0.0.0.0:9090";
    log::info!("飞书 Bot 服务启动在 http://{}", addr);
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, router).await.unwrap();
}

/// 处理飞书 Webhook
async fn handle_webhook(
    bot: Arc<FeishuBot>,
    app: Arc<AppHandle>,
    Json(payload): Json<serde_json::Value>,
) -> Json<serde_json::Value> {
    // 挑战验证
    if let Some(challenge) = payload.get("challenge").and_then(|v| v.as_str()) {
        return Json(serde_json::json!({"challenge": challenge}));
    }

    // 飞书 v2 事件格式
    let event_type = payload
        .pointer("/header/event_type")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    if event_type != "im.message.receive_v1" {
        return Json(serde_json::json!({"code": 0}));
    }

    let content = payload
        .pointer("/event/message/content")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let message_id = payload
        .pointer("/event/message/message_id")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let chat_type = payload
        .pointer("/event/message/chat_type")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    if content.is_empty() || message_id.is_empty() {
        return Json(serde_json::json!({"code": 0}));
    }

    // 去重：5 秒内同一 message_id 只处理一次
    {
        let mut seen = DEDUP.lock().unwrap();
        if !seen.insert(message_id.to_owned()) {
            log::info!("[Feishu] 跳过重复事件: {}", message_id);
            return Json(serde_json::json!({"code": 0}));
        }
    }
    let mid = message_id.to_owned();
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(5)).await;
        if let Ok(mut seen) = DEDUP.lock() {
            seen.remove(&mid);
        }
    });

    // 解析消息文本
    let text = serde_json::from_str::<serde_json::Value>(content)
        .ok()
        .and_then(|v| v.get("text").and_then(|t| t.as_str()).map(|s| s.to_string()))
        .unwrap_or_else(|| content.to_string());

    log::info!("[Feishu] {}: {}", chat_type, text);

    // 先回包确认（防止飞书事件重试）
    let bot2 = bot.clone();
    let app2 = app.clone();
    let mid = message_id.to_owned();
    let txt = text.to_owned();
    tokio::spawn(async move {
        let reply = match app2.try_state::<AgentCore>() {
            Some(agent) => {
                let settings = load_api_settings(&*agent).await;
                let c = load_character_by_name(&*agent, "Luna").await;
                let info = c.as_ref().map(|c| CharacterInfo {
                    name: c.name.clone(), description: c.description.clone(),
                    personality: c.personality.clone(),
                    world_name: c.world_name.clone(), world_description: c.world_description.clone(),
                    personality_state_text: String::new(),
                    stat_values_json: String::new(),
                });
                match agent.process_message(&txt, None, None, info, settings, vec![], None).await {
                    Ok(r) => r.reply,
                    Err(e) => format!("出错了: {}", e),
                }
            }
            None => "AI 还没准备好~".into(),
        };
        let _ = bot2.reply_message(&mid, &reply).await;
    });
    Json(serde_json::json!({"code": 0}))
}

/// 从数据库按名称查找角色
async fn load_character_by_name(agent: &AgentCore, name: &str) -> Option<CharacterInfoWithId> {
    let db_path = agent.db_path();
    let db = rusqlite::Connection::open(db_path).ok()?;
    let mut stmt = db.prepare(
        "SELECT c.id, c.name, c.description, c.personality, c.world_id, w.name, w.description \
         FROM characters c LEFT JOIN worlds w ON c.world_id = w.id \
         WHERE c.name = ?1 AND c.is_active = 1 LIMIT 1"
    ).ok()?;
    let row = stmt.query_row([name], |row| {
        Ok(CharacterInfoWithId {
            id: row.get::<_, i32>(0)? as u32,
            name: row.get::<_, String>(1)?,
            description: row.get::<_, String>(2).unwrap_or_default(),
            personality: row.get::<_, String>(3).unwrap_or_default(),
            world_name: row.get::<_, String>(5).unwrap_or_default(),
            world_description: row.get::<_, String>(6).unwrap_or_default(),
        })
    }).ok()?;
    Some(row)
}

/// 角色信息（带 id）
struct CharacterInfoWithId {
    id: u32,
    name: String,
    description: String,
    personality: String,
    world_name: String,
    world_description: String,
}

/// 从 SQLite 读取当前 API 配置
async fn load_api_settings(agent: &AgentCore) -> ApiSettings {
    let fallback = ApiSettings {
        endpoint: "http://127.0.0.1:1234/v1".into(),
        api_key: "lm-studio".into(),
        model: "gpt-3.5-turbo".into(),
        temperature: 0.7,
        max_tokens: 2000,
        user_name: "你".into(),
        user_persona: String::new(),
        system_prompt: String::new(),
    };
    // AgentCore 内部存了 db_path，读 api_profiles 表取默认配置
    let db_path = agent.db_path();
    let db = match rusqlite::Connection::open(&db_path) {
        Ok(db) => db,
        Err(_) => return fallback,
    };
    // 优先用标记为 is_default 的配置
    if let Ok(mut stmt) = db.prepare(
        "SELECT endpoint, api_key, model, temperature, max_tokens, system_prompt \
         FROM api_profiles WHERE is_default = 1 LIMIT 1"
    ) {
        if let Ok(row) = stmt.query_row([], |row| {
            Ok(ApiSettings {
                endpoint: row.get::<_, String>(0)?,
                api_key: row.get::<_, String>(1)?,
                model: row.get::<_, String>(2)?,
                temperature: row.get::<_, f64>(3)?,
                max_tokens: row.get::<_, u32>(4)?,
                user_name: "你".into(),
                user_persona: String::new(),
                system_prompt: row.get::<_, String>(5).unwrap_or_default(),
            })
        }) {
            return row;
        }
    }
    // 退化到第一行
    if let Ok(mut stmt) = db.prepare(
        "SELECT endpoint, api_key, model, temperature, max_tokens, system_prompt \
         FROM api_profiles LIMIT 1"
    ) {
        if let Ok(row) = stmt.query_row([], |row| {
            Ok(ApiSettings {
                endpoint: row.get::<_, String>(0)?,
                api_key: row.get::<_, String>(1)?,
                model: row.get::<_, String>(2)?,
                temperature: row.get::<_, f64>(3)?,
                max_tokens: row.get::<_, u32>(4)?,
                user_name: "你".into(),
                user_persona: String::new(),
                system_prompt: row.get::<_, String>(5).unwrap_or_default(),
            })
        }) {
            return row;
        }
    }
    fallback
}
