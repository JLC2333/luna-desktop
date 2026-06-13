use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use super::types::*;

/// 旁白 + 主动消息队列持久化管理
///
/// 每个对话独立文件存储，路径格式：`{narration_dir}/chat_{chat_id}.json`
/// 绝对时间匹配：每个 item 存 scheduled_at (ISO 8601)，
/// get_due_items 比较 scheduled_at <= Utc::now() 决定到期与否。
pub struct NarrationManager {
    narration_dir: PathBuf,
    /// 缓存：最近加载过的队列（key=chat_id）
    cache: Mutex<HashMap<u32, NarrationQueue>>,
}

impl NarrationManager {
    pub fn new(narration_dir: PathBuf) -> Self {
        Self {
            narration_dir,
            cache: Mutex::new(HashMap::new()),
        }
    }

    // ─── 公开 API ───

    /// 保存新生成的队列到文件
    /// 将每个 item 的 delay_seconds 转换为绝对时间 scheduled_at
    pub fn save_queue(&self, queue: &NarrationQueue) -> Result<(), String> {
        let now = chrono::Utc::now();
        let mut items = queue.items.clone();
        for item in &mut items {
            if item.scheduled_at.is_empty() {
                let scheduled = now + chrono::Duration::seconds(item.delay_seconds as i64);
                item.scheduled_at = scheduled.to_rfc3339();
            }
        }
        let q = NarrationQueue {
            chat_id: queue.chat_id,
            created_at: now.to_rfc3339(),
            items,
        };
        eprintln!("[narration] save_queue: chat={}, {} items", q.chat_id, q.items.len());
        for item in &q.items {
            eprintln!("[narration]   item id={} type={} delay={}s scheduled={} text={}",
                item.id, item.narration_type, item.delay_seconds, item.scheduled_at,
                item.text.chars().take(30).collect::<String>());
        }
        let json = serde_json::to_string_pretty(&q)
            .map_err(|e| format!("序列化旁白队列失败: {}", e))?;
        std::fs::create_dir_all(&self.narration_dir)
            .map_err(|e| format!("创建旁白目录失败: {}", e))?;
        std::fs::write(self.queue_path(q.chat_id), &json)
            .map_err(|e| format!("保存旁白队列失败: {}", e))?;
        // 更新缓存
        if let Ok(mut c) = self.cache.lock() {
            c.insert(q.chat_id, q);
        }
        Ok(())
    }

    /// 返回当前到期未投递的 items（按 scheduled_at 排序）
    pub fn get_due_items(&self, chat_id: u32) -> Result<Vec<NarrationItem>, String> {
        let queue = self.load_queue(chat_id)?;
        if queue.chat_id != chat_id {
            eprintln!("[narration] get_due_items: chat={} 无队列", chat_id);
            return Ok(vec![]);
        }
        let now = chrono::Utc::now();
        let mut due: Vec<NarrationItem> = queue
            .items
            .iter()
            .filter(|item| !item.delivered)
            .filter(|item| {
                chrono::DateTime::parse_from_rfc3339(&item.scheduled_at)
                    .map(|t| t.with_timezone(&chrono::Utc) <= now)
                    .unwrap_or(false)
            })
            .cloned()
            .collect();
        due.sort_by(|a, b| a.scheduled_at.cmp(&b.scheduled_at));
        eprintln!("[narration] get_due_items: chat={} total={} undelivered={} due={}",
            chat_id, queue.items.len(),
            queue.items.iter().filter(|i| !i.delivered).count(),
            due.len());
        Ok(due)
    }

    /// 标记指定 items 为已投递，全部投递完自动清空文件
    pub fn mark_delivered(&self, chat_id: u32, item_ids: &[u32]) -> Result<(), String> {
        let mut queue = self.load_queue(chat_id)?;
        let id_set: std::collections::HashSet<u32> = item_ids.iter().cloned().collect();
        for item in &mut queue.items {
            if id_set.contains(&item.id) {
                item.delivered = true;
            }
        }
        if queue.items.iter().all(|i| i.delivered) {
            eprintln!("[narration] mark_delivered: 全部投递，清空文件");
            self.clear_queue_internal(chat_id);
            Ok(())
        } else {
            let remaining = queue.items.iter().filter(|i| !i.delivered).count();
            eprintln!("[narration] mark_delivered: 仍有 {} 条未投递", remaining);
            self.save_queue_internal(chat_id, &queue)
        }
    }

    /// 清空指定对话的队列（用户回复时调用）
    pub fn clear_queue(&self, chat_id: u32) -> Result<(), String> {
        eprintln!("[narration] clear_queue: chat={} 清空", chat_id);
        self.clear_queue_internal(chat_id);
        Ok(())
    }

    /// 获取全部 items（不分是否到期，纯读取）
    pub fn get_all_items(&self, chat_id: u32) -> Result<Vec<NarrationItem>, String> {
        let queue = self.load_queue(chat_id)?;
        if queue.chat_id != chat_id {
            return Ok(vec![]);
        }
        Ok(queue.items)
    }

    /// 检查队列是否存在且有未投递 items
    pub fn has_pending(&self, chat_id: u32) -> bool {
        let result = match self.load_queue(chat_id) {
            Ok(q) => q.chat_id == chat_id && q.items.iter().any(|i| !i.delivered),
            Err(_) => false,
        };
        eprintln!("[narration] has_pending: chat={} -> {}", chat_id, result);
        result
    }

    // ─── 内部 ───

    fn queue_path(&self, chat_id: u32) -> PathBuf {
        self.narration_dir.join(format!("chat_{}.json", chat_id))
    }

    fn load_queue(&self, chat_id: u32) -> Result<NarrationQueue, String> {
        // 先查缓存
        {
            let guard = self.cache.lock().map_err(|e| e.to_string())?;
            if let Some(q) = guard.get(&chat_id) {
                return Ok(q.clone());
            }
        }
        // 缓存未命中，读文件
        let path = self.queue_path(chat_id);
        if !path.exists() {
            return Ok(NarrationQueue {
                chat_id: 0,
                created_at: String::new(),
                items: vec![],
            });
        }
        let json =
            std::fs::read_to_string(&path).map_err(|e| format!("读取旁白队列失败: {}", e))?;
        let queue: NarrationQueue =
            serde_json::from_str(&json).map_err(|e| format!("解析旁白队列失败: {}", e))?;
        // 写入缓存
        if let Ok(mut c) = self.cache.lock() {
            c.insert(chat_id, queue.clone());
        }
        Ok(queue)
    }

    fn save_queue_internal(&self, chat_id: u32, queue: &NarrationQueue) -> Result<(), String> {
        let json = serde_json::to_string_pretty(queue)
            .map_err(|e| format!("序列化旁白队列失败: {}", e))?;
        std::fs::write(self.queue_path(chat_id), &json)
            .map_err(|e| format!("保存旁白队列失败: {}", e))?;
        if let Ok(mut c) = self.cache.lock() {
            c.insert(chat_id, queue.clone());
        }
        Ok(())
    }

    fn clear_queue_internal(&self, chat_id: u32) {
        let _ = std::fs::remove_file(self.queue_path(chat_id));
        if let Ok(mut c) = self.cache.lock() {
            c.remove(&chat_id);
        }
    }
}
