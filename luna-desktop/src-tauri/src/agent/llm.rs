use reqwest::Client;
use reqwest::header::{HeaderMap, HeaderValue, USER_AGENT};
use tokio_util::sync::CancellationToken;

use super::types::{LlmChatResult, NativeToolCall};

/// LLM API 客户端
/// 封装对 OpenAI 兼容 API 的 HTTP 调用
#[derive(Clone)]
pub struct LlmClient {
    client: Client,
}

impl LlmClient {
    pub fn new() -> Self {
        let mut headers = HeaderMap::new();
        headers.insert(USER_AGENT, HeaderValue::from_static("LunA/1.0"));
        Self {
            client: Client::builder()
                .timeout(std::time::Duration::from_secs(120))
                .http1_only()
                .default_headers(headers)
                .build()
                .expect("Failed to create HTTP client"),
        }
    }

    /// 发送聊天请求，返回模型原始文本响应
    /// cancel: 传入 CancellationToken 以支持用户中途停止生成
    pub async fn chat(
        &self,
        endpoint: &str,
        api_key: &str,
        model: &str,
        temperature: f64,
        max_tokens: u32,
        messages: Vec<serde_json::Value>,
        cancel: CancellationToken,
    ) -> Result<String, String> {
        let url = format!(
            "{}/chat/completions",
            endpoint.trim_end_matches('/')
        );

        let body = serde_json::json!({
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": false,
        });

        let response = tokio::select! {
            r = self
                .client
                .post(&url)
                .header("Content-Type", "application/json")
                .header("Authorization", format!("Bearer {}", api_key))
                .json(&body)
                .send() => {
                r.map_err(|e| format!("API 请求失败: {}", e))?
            }
            _ = cancel.cancelled() => {
                return Err("用户取消了生成".to_string());
            }
        };

        let status = response.status();
        if !status.is_success() {
            let text = response.text().await.unwrap_or_default();
            return Err(format!("API 错误 ({}): {}", status, text));
        }

        let data: serde_json::Value = response
            .json()
            .await
            .map_err(|e| format!("解析 API 响应失败: {}", e))?;

        let content = data["choices"][0]["message"]["content"]
            .as_str()
            .unwrap_or("")
            .to_string();

        if content.is_empty() {
            return Err("API 返回了空内容".to_string());
        }

        Ok(content)
    }

    /// 发送聊天请求（带 tools 参数），返回文本 + 原生 tool_calls
    /// 支持多轮工具调用：第一次调用可能返回 tool_calls，执行后把结果喂回来再调用
    /// force_tools: 如果为 true，则设置 tool_choice="required"（强制模型至少调用一个工具）
    pub async fn chat_with_tools(
        &self,
        endpoint: &str,
        api_key: &str,
        model: &str,
        temperature: f64,
        max_tokens: u32,
        messages: Vec<serde_json::Value>,
        tools: Vec<serde_json::Value>,
        cancel: CancellationToken,
        force_tools: bool,
    ) -> Result<LlmChatResult, String> {
        let url = format!(
            "{}/chat/completions",
            endpoint.trim_end_matches('/')
        );

        let mut body = serde_json::json!({
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": false,
        });

        if !tools.is_empty() {
            body["tools"] = serde_json::Value::Array(tools);
            // DeepSeek V4 thinking 模式不支持 "required"，始终用 "auto"
            body["tool_choice"] = serde_json::json!("auto");
        }

        let response = tokio::select! {
            r = self
                .client
                .post(&url)
                .header("Content-Type", "application/json")
                .header("Authorization", format!("Bearer {}", api_key))
                .json(&body)
                .send() => {
                r.map_err(|e| format!("API 请求失败: {}", e))?
            }
            _ = cancel.cancelled() => {
                return Err("用户取消了生成".to_string());
            }
        };

        let status = response.status();
        if !status.is_success() {
            let text = response.text().await.unwrap_or_default();
            eprintln!("[agent] API 错误: status={}, body={:?}", status, text);
            return Err(format!("API 错误 ({}): {}", status, text));
        }

        let data: serde_json::Value = response
            .json()
            .await
            .map_err(|e| format!("解析 API 响应失败: {}", e))?;

        let content = data["choices"][0]["message"]["content"]
            .as_str()
            .map(|s| s.to_string());

        // 解析原生 tool_calls
        let tool_calls: Vec<NativeToolCall> = data["choices"][0]["message"]["tool_calls"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|tc| {
                        let id = tc["id"].as_str()?.to_string();
                        let name = tc["function"]["name"].as_str()?.to_string();
                        let arguments = tc["function"]["arguments"].as_str()?.to_string();
                        Some(NativeToolCall { id, name, arguments })
                    })
                    .collect()
            })
            .unwrap_or_default();

        eprintln!(
            "[agent] response: finish={} has_content={} tool_calls={}",
            data["choices"][0]["finish_reason"].as_str().unwrap_or("?"),
            content.is_some(),
            tool_calls.len(),
        );

        // 解析 DeepSeek thinking 模式的 reasoning_content
        let reasoning_content = data["choices"][0]["message"]["reasoning_content"]
            .as_str()
            .map(|s| s.to_string());

        if reasoning_content.is_some() {
            eprintln!("[agent] reasoning_content: {} chars", reasoning_content.as_ref().unwrap().len());
        }

        Ok(LlmChatResult { content, reasoning_content, tool_calls })
    }

    /// 构建 OpenAI 兼容的 tools 参数定义
    pub fn build_tool_definitions() -> Vec<serde_json::Value> {
        vec![
            serde_json::json!({
                "type": "function",
                "function": {
                    "name": "write_memory",
                    "description": "记录用户（人类）的个人信息：名字/称呼、职业、年龄、喜欢的食物/饮料/音乐、习惯、经历、性格特征、身体状况、讨厌的东西。只记录用户自己说出的真实信息，不记录AI的猜测或对话情节。",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "content": {
                                "type": "string",
                                "description": "要记录的内容，用第三人称一句话概括用户的信息"
                            }
                        },
                        "required": ["content"]
                    }
                }
            }),
        ]
    }

    /// 测试 API 连接（带调试日志 → /tmp/luna_debug.log）
    pub async fn test_connection(
        &self,
        endpoint: &str,
        api_key: &str,
    ) -> Result<bool, String> {
        let api_key = api_key.trim();
        let endpoint = endpoint.trim();
        let mut log_lines: Vec<String> = vec![
            format!("endpoint={}", endpoint),
            format!("key_len={}", api_key.len()),
            format!("key_prefix={}...", &api_key.chars().take(12).collect::<String>()),
        ];

        // 先试 /v1/models（最快，不花钱）
        let models_url = format!("{}/models", endpoint.trim_end_matches('/'));
        log_lines.push(format!("GET {}", models_url));
        let resp = self
            .client
            .get(&models_url)
            .header("Authorization", format!("Bearer {}", api_key))
            .send()
            .await;

        match resp {
            Ok(r) if r.status().is_success() => {
                log_lines.push("models=200 OK".to_string());
                std::fs::write("/tmp/luna_debug.log", log_lines.join("\n")).ok();
                return Ok(true);
            }
            Ok(r) => {
                let models_status = r.status().as_u16();
                log_lines.push(format!("models=HTTP {}", models_status));
                let body_text = r.text().await.unwrap_or_default();
                log_lines.push(format!("models_body={}", &body_text[..body_text.len().min(200)]));

                // /models 失败了，试 /chat/completions 发一条最小探针
                let chat_url = format!("{}/chat/completions", endpoint.trim_end_matches('/'));
                log_lines.push(format!("POST {}", chat_url));
                let body = serde_json::json!({
                    "model": "gpt-3.5-turbo",
                    "messages": [{"role": "user", "content": "hi"}],
                    "max_tokens": 1,
                    "temperature": 0.0,
                });

                let chat_resp = self
                    .client
                    .post(&chat_url)
                    .header("Content-Type", "application/json")
                    .header("Authorization", format!("Bearer {}", api_key))
                    .json(&body)
                    .send()
                    .await;

                match chat_resp {
                    Ok(r) => {
                        let st = r.status().as_u16();
                        log_lines.push(format!("chat=HTTP {}", st));
                        // 2xx 或 4xx（非401/403）都说明认证通过、连接正常
                        if r.status().is_success() || (st >= 400 && st < 500 && st != 401 && st != 403) {
                            std::fs::write("/tmp/luna_debug.log", log_lines.join("\n")).ok();
                            return Ok(true);
                        }
                        let chat_body = r.text().await.unwrap_or_default();
                        let s: String = chat_body.chars().take(200).collect();
                        log_lines.push(format!("chat_body={}", &s));
                        std::fs::write("/tmp/luna_debug.log", log_lines.join("\n")).ok();
                        return Err(format!(
                            "HTTP {} — {}（/models 返回: {}）",
                            st, s, body_text.chars().take(100).collect::<String>()
                        ));
                    }
                    Err(e) => {
                        log_lines.push(format!("chat_error={}", e));
                        std::fs::write("/tmp/luna_debug.log", log_lines.join("\n")).ok();
                        return Err(format!("/models 返回 HTTP {}，/chat 网络错误: {}", models_status, e));
                    }
                }
            }
            Err(e) => {
                log_lines.push(format!("models_error={}", e));
                std::fs::write("/tmp/luna_debug.log", log_lines.join("\n")).ok();
                return Err(format!("网络错误: {}", e));
            }
        }
    }

    /// 获取可用模型列表
    pub async fn list_models(
        &self,
        endpoint: &str,
        api_key: &str,
    ) -> Result<Vec<String>, String> {
        let url = format!("{}/models", endpoint.trim_end_matches('/'));

        let response = self
            .client
            .get(&url)
            .header("Authorization", format!("Bearer {}", api_key))
            .send()
            .await
            .map_err(|e| format!("获取模型列表失败: {}", e))?;

        if !response.status().is_success() {
            return Err(format!("HTTP {}", response.status()));
        }

        let json: serde_json::Value = response
            .json()
            .await
            .map_err(|e| format!("解析响应失败: {}", e))?;

        let models = json["data"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|m| m["id"].as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default();

        Ok(models)
    }
}
