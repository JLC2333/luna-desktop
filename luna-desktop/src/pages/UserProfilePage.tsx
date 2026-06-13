import { useState, useEffect } from "react";
import { useSettingsStore } from "../stores/settingsStore";
import { getSettings, updateSettings } from "../utils/db";

export default function UserProfilePage() {
  const { settings, updateSettings: updateStore } = useSettingsStore();
  const [name, setName] = useState(settings.user_name || "");
  const [persona, setPersona] = useState(settings.user_persona || "");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    loadProfile();
  }, []);

  async function loadProfile() {
    const data = await getSettings();
    if (data) {
      setName(data.user_name || "");
      setPersona(data.user_persona || "");
    }
  }

  async function handleSave() {
    await updateSettings({
      user_name: name,
      user_persona: persona,
    });
    updateStore({ user_name: name, user_persona: persona });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="h-full bg-luna-bg-tertiary overflow-y-auto p-8">
      <div className="max-w-xl mx-auto">
        <div className="bg-luna-bg border border-luna-border rounded-xl p-8">
          <div className="flex items-center gap-4 mb-8">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#667eea] to-[#764ba2] flex items-center justify-center text-3xl shadow-md">
              
            </div>
            <div>
              <div className="text-xl font-semibold text-luna-text">
                个人信息
              </div>
              <div className="text-sm text-luna-text-secondary mt-0.5">
                这些信息会被注入到所有对话中，让角色更好地了解你
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div>
              <label className="text-sm font-medium text-luna-text mb-2 block">
                你的名字 / 称呼
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="角色会用这个名字称呼你"
                className="w-full py-2.5 px-4 bg-luna-bg border border-luna-border rounded-lg text-sm text-luna-text outline-none focus:border-luna-accent focus:ring-1 focus:ring-luna-accent transition-all"
              />
              <div className="text-xs text-luna-text-tertiary mt-1.5">
                例如：冒险者、旅行者、小王
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-luna-text mb-2 block">
                身份描述
              </label>
              <textarea
                value={persona}
                onChange={(e) => setPersona(e.target.value)}
                placeholder="简单介绍你自己..."
                rows={5}
                className="w-full py-2.5 px-4 bg-luna-bg border border-luna-border rounded-lg text-sm text-luna-text outline-none focus:border-luna-accent focus:ring-1 focus:ring-luna-accent resize-none leading-relaxed transition-all"
              />
              <div className="text-xs text-luna-text-tertiary mt-1.5">
                例如：一位来自远方的旅人，在各个世界间游历，寻找传说中的宝藏
              </div>
            </div>

            <div className="bg-luna-bg-secondary border border-luna-border rounded-lg p-4">
              <div className="text-xs text-luna-text-tertiary mb-2">
                 对话中的效果预览
              </div>
              <div className="space-y-2 text-xs text-luna-text-secondary">
                <div>
                  系统提示词中会包含：「用户的名字是{name || "（未设置）"}」
                </div>
                <div>
                  角色会根据你的身份描述来调整对话风格和称呼方式
                </div>
              </div>
            </div>
          </div>

          <div className="mt-8 pt-6 border-t border-luna-border flex items-center gap-3">
            <button
              onClick={handleSave}
              className="px-6 py-2.5 bg-luna-accent text-white rounded-lg text-sm font-medium hover:bg-[#3C3489] transition-colors"
            >
              保存
            </button>
            {saved && (
              <span className="text-sm text-green-600"> 已保存</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}