import { useState, useEffect } from "react";
import {
  getWorlds,
  createWorld,
  updateWorld,
  deleteWorld,
  type World,
} from "../utils/db";

export default function WorldsPage() {
  const [worlds, setWorlds] = useState<World[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);

  // 删除确认键盘监听（Enter=确认，Escape=取消）
  useEffect(() => {
    if (deleteConfirmId === null) return;
    const id = deleteConfirmId;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Enter") {
        e.preventDefault();
        setDeleteConfirmId(null);
        deleteWorld(id).then(() => loadData());
      } else if (e.key === "Escape") {
        setDeleteConfirmId(null);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deleteConfirmId]);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formData, setFormData] = useState({ name: "", description: "" });

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const data = await getWorlds();
      setWorlds(data);
    } catch (err) {
      console.error("加载世界数据失败:", err);
    }
    setLoading(false);
  }

  function openCreate() {
    setEditingId(null);
    setFormData({ name: "", description: "" });
    setShowModal(true);
  }

  function openEdit(world: World) {
    setEditingId(world.id);
    setFormData({ name: world.name, description: world.description });
    setShowModal(true);
  }

  async function handleSubmit() {
    if (!formData.name.trim()) return;

    try {
      if (editingId) {
        await updateWorld(editingId, formData.name.trim(), formData.description);
      } else {
        await createWorld(formData.name.trim(), formData.description);
      }
      await loadData();
      setShowModal(false);
    } catch (err) {
      console.error("保存世界失败:", err);
    }
  }

  function handleDelete(id: number) {
    setDeleteConfirmId(id);
  }

  function formatDate(dateStr: string) {
    const date = new Date(dateStr);
    return date.toLocaleDateString("zh-CN", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="px-6 py-5 border-b border-luna-border bg-luna-bg flex items-center justify-between flex-shrink-0">
        <h1 className="text-lg font-semibold text-luna-text">世界</h1>
        <button
          onClick={openCreate}
          className="px-4 py-2.5 bg-luna-accent text-white rounded-md text-sm font-medium hover:bg-[#3C3489] transition-colors"
        >
          + 新建世界
        </button>
      </div>

      {deleteConfirmId !== null && (
        <div className="flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs mx-4 mb-3">
          <span className="text-red-600">删除「{worlds.find(w => w.id === deleteConfirmId)?.name || '此'}」世界？</span>
          <button onClick={() => setDeleteConfirmId(null)} className="text-luna-text-tertiary hover:text-luna-text ml-auto transition-colors">取消</button>
          <button onClick={async () => { const id = deleteConfirmId; setDeleteConfirmId(null); await deleteWorld(id); await loadData(); }} className="text-red-500 hover:text-red-700 font-medium transition-colors">确认删除</button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-6 bg-luna-bg-tertiary">
        {loading ? (
          <div className="text-center text-luna-text-secondary py-20">加载中...</div>
        ) : worlds.length === 0 ? (
          <div className="text-center text-luna-text-secondary py-20">
            暂无世界，点击右上角创建
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-5">
            {worlds.map((world) => (
              <div
                key={world.id}
                className="bg-luna-bg border border-luna-border rounded-xl overflow-hidden transition-all hover:-translate-y-1 hover:shadow-lg hover:border-luna-accent cursor-pointer group/world"
              >
                <div className="h-20 bg-gradient-to-br from-[#667eea22] to-[#764ba222] relative">
                  <div className="absolute top-3 right-3 flex gap-1.5 opacity-0 group-hover/world:opacity-100 transition-opacity z-10">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        openEdit(world);
                      }}
                      className="h-7 px-2.5 rounded-full bg-luna-bg/90 border-0 flex items-center justify-center text-luna-text-secondary text-xs hover:bg-luna-bg hover:text-luna-accent shadow-sm"
                    >
                      详细信息
                    </button>
                    <button
                      onClick={() => handleDelete(world.id)}
                      className="w-7 h-7 rounded-full bg-luna-bg/90 border-0 flex items-center justify-center text-luna-text-secondary text-xs hover:bg-luna-bg hover:text-luna-red shadow-sm"
                    >
                      <svg width="12" height="12" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M1 1L13 13M1 13L13 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                      </svg>
                    </button>
                  </div>
                </div>
                <div className="px-4 pb-4 pt-3">
                  <div className="text-[15px] font-semibold text-luna-text mb-1">
                    {world.name}
                  </div>
                  <div className="text-sm text-luna-text-secondary leading-relaxed line-clamp-3 min-h-[60px]">
                    {world.description || "暂无描述"}
                  </div>
                  <div className="mt-3 pt-3 border-t border-luna-border flex items-center justify-between">
                    <span className="text-xs text-luna-text-tertiary">
                      创建于 {formatDate(world.created_at)}
                    </span>
                    <span className="text-xs text-luna-text-tertiary">
                      ID: {world.id}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[1000]">
          <div className="w-[90%] max-w-[500px] bg-luna-bg rounded-xl overflow-hidden flex flex-col">
            <div className="px-5 py-4 border-b border-luna-border flex items-center justify-between">
              <h2 className="text-base font-semibold text-luna-text">
                {editingId ? "编辑世界" : "创建世界"}
              </h2>
              <button
                onClick={() => setShowModal(false)}
                className="w-7 h-7 rounded-full bg-luna-bg-secondary flex items-center justify-center text-luna-text-secondary hover:bg-luna-bg-tertiary"
              >
                ×
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="text-xs font-medium text-luna-text-secondary mb-1.5 block">
                  世界名称 *
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="例如：幻想大陆"
                  className="w-full py-2 px-3 bg-luna-bg border border-luna-border rounded-md text-sm text-luna-text outline-none focus:border-luna-accent"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-luna-text-secondary mb-1.5 block">
                  描述
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="描述这个世界的背景、规则、特色..."
                  rows={4}
                  className="w-full py-2 px-3 bg-luna-bg border border-luna-border rounded-md text-sm text-luna-text outline-none focus:border-luna-accent resize-y leading-relaxed"
                />
              </div>
            </div>
            <div className="px-5 py-4 border-t border-luna-border flex justify-end gap-2.5">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 border border-luna-border rounded-md bg-luna-bg text-sm text-luna-text-secondary hover:bg-luna-bg-secondary transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleSubmit}
                className="px-4 py-2 bg-luna-accent text-white rounded-md text-sm font-medium hover:bg-[#3C3489] transition-colors"
              >
                {editingId ? "保存修改" : "创建世界"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
