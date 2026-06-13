import { useEffect, useState, useRef } from "react";
import { useChatStore } from "../stores/chatStore";
import { getChats, deleteChat, updateChatTitle } from "../utils/db";

export default function HistoryPage({ onNavigateToChat }: { onNavigateToChat: (chatId: number) => void }) {
  const { chats, setChats } = useChatStore();
  const [filter, setFilter] = useState<"today" | "week" | "all">("all");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadChats();
  }, []);

  useEffect(() => {
    if (editingId !== null && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  async function loadChats() {
    const data = await getChats();
    setChats(data);
  }

  async function handleDelete(id: number) {
    await deleteChat(id);
    setDeleteConfirmId(null);
    await loadChats();
  }

  function startEdit(chat: { id: number; title: string }) {
    setEditingId(chat.id);
    setEditTitle(chat.title);
  }

  async function saveTitle(id: number) {
    if (editTitle.trim()) {
      await updateChatTitle(id, editTitle.trim());
      await loadChats();
    }
    setEditingId(null);
  }

  function handleKeyDown(e: React.KeyboardEvent, id: number) {
    if (e.key === "Enter") {
      saveTitle(id);
    } else if (e.key === "Escape") {
      setEditingId(null);
    }
  }

  const filteredChats = chats.filter((chat) => {
    if (filter === "all") return true;
    const date = new Date(chat.updated_at + 'Z');
    const now = new Date();
    if (filter === "today") {
      return date.toDateString() === now.toDateString();
    }
    if (filter === "week") {
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      return date >= weekAgo;
    }
    return true;
  });

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="px-6 py-4 border-b border-luna-border bg-luna-bg flex items-center gap-3 flex-shrink-0">
        <input
          type="text"
          placeholder="搜索聊天记录..."
          className="flex-1 py-2 px-3 bg-luna-bg-secondary border border-luna-border rounded-md text-sm text-luna-text outline-none focus:border-luna-accent placeholder:text-luna-text-tertiary"
        />
        <button
          onClick={() => setFilter("today")}
          className={`px-3 py-1.5 border border-luna-border rounded-md text-xs transition-colors ${
            filter === "today"
              ? "bg-luna-accent text-white border-luna-accent"
              : "bg-luna-bg text-luna-text-secondary hover:bg-luna-bg-secondary"
          }`}
        >
          今天
        </button>
        <button
          onClick={() => setFilter("week")}
          className={`px-3 py-1.5 border border-luna-border rounded-md text-xs transition-colors ${
            filter === "week"
              ? "bg-luna-accent text-white border-luna-accent"
              : "bg-luna-bg text-luna-text-secondary hover:bg-luna-bg-secondary"
          }`}
        >
          本周
        </button>
        <button
          onClick={() => setFilter("all")}
          className={`px-3 py-1.5 border border-luna-border rounded-md text-xs transition-colors ${
            filter === "all"
              ? "bg-luna-accent text-white border-luna-accent"
              : "bg-luna-bg text-luna-text-secondary hover:bg-luna-bg-secondary"
          }`}
        >
          全部
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 px-6 bg-luna-bg-tertiary">
        {filteredChats.map((chat) => (
          <div
            key={chat.id}
            className="group flex items-center gap-3.5 p-3.5 px-4 bg-luna-bg border border-luna-border rounded-lg mb-2 cursor-pointer transition-all hover:border-luna-accent hover:translate-x-1"
          >
            <div className="w-11 h-11 rounded-md bg-luna-accent-light flex items-center justify-center text-xl flex-shrink-0 overflow-hidden">
              
            </div>
            <div className="flex-1 min-w-0">
              {editingId === chat.id ? (
                <input
                  ref={editInputRef}
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  onBlur={() => saveTitle(chat.id)}
                  onKeyDown={(e) => handleKeyDown(e, chat.id)}
                  className="w-full text-sm font-medium text-luna-text bg-luna-bg-secondary border border-luna-accent rounded px-2 py-0.5 outline-none"
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <div
                  className="text-sm font-medium text-luna-text truncate"
                  onClick={() => startEdit(chat)}
                >
                  与 {chat.title} 的对话
                </div>
              )}
              <div className="text-xs text-luna-text-tertiary mt-0.5 flex items-center gap-3">
                <span>
                  {new Date(chat.updated_at + 'Z').toLocaleDateString("zh-CN", {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onNavigateToChat(chat.id);
                }}
                className="px-2.5 py-1.5 text-xs bg-luna-accent text-white rounded-md hover:bg-luna-accent/90 transition-colors whitespace-nowrap"
              >
                载入
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setDeleteConfirmId(chat.id);
                }}
                className="w-8 h-8 rounded-md border border-luna-border flex items-center justify-center text-luna-text-secondary hover:bg-red-50 hover:text-luna-red hover:border-luna-red transition-all opacity-0 group-hover:opacity-100"
                title="删除对话"
              >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M1 1L13 13M1 13L13 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
            </div>

            {/* 删除确认弹窗 */}
            {deleteConfirmId === chat.id && (
              <div className="absolute inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setDeleteConfirmId(null)}>
                <div className="bg-luna-bg rounded-xl p-5 shadow-lg max-w-xs w-full mx-4" onClick={(e) => e.stopPropagation()}>
                  <div className="text-sm font-medium text-luna-text mb-2">确认删除</div>
                  <div className="text-xs text-luna-text-secondary mb-4">
                    确定要删除「{chat.title}」吗？此操作不可恢复。
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button
                      onClick={() => setDeleteConfirmId(null)}
                      className="px-3 py-1.5 text-xs border border-luna-border rounded-md text-luna-text-secondary hover:bg-luna-bg-secondary transition-colors"
                    >
                      取消
                    </button>
                    <button
                      onClick={() => handleDelete(chat.id)}
                      className="px-3 py-1.5 text-xs bg-luna-red text-white rounded-md hover:bg-red-600 transition-colors"
                    >
                      删除
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
        {filteredChats.length === 0 && (
          <div className="text-center py-20 text-luna-text-tertiary">
            <div className="text-4xl mb-3"></div>
            <div className="text-sm">暂无聊天记录</div>
          </div>
        )}
      </div>
    </div>
  );
}
