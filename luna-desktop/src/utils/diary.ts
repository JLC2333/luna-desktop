import { invoke } from "@tauri-apps/api/core";
import { getChats, getMessages, getCharacterById, getDiaryEntries } from "./db";

interface ApiSettings {
  endpoint: string;
  api_key: string;
  model: string;
  temperature: number;
  max_tokens: number;
  user_name: string;
  user_persona: string;
  system_prompt: string;
}

/**
 * 生成并保存日记
 * @returns { written, message } — written=true 表示写入了日记
 */
export async function generateDiary(params: {
  bindSystemClock: boolean;
  diaryMaxLength: number;
  settings: ApiSettings;
  onStatus?: (msg: string) => void;
}): Promise<{ written: boolean; message: string }> {
  const { bindSystemClock, diaryMaxLength, settings, onStatus } = params;
  const setStatus = onStatus || console.log;

  setStatus("正在整理今日对话...");

  const now = new Date();
  const today = bindSystemClock
    ? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
    : now.toISOString().slice(0, 10);

  const chats = await getChats();

  // 收集今日有对话的角色
  const charConversations: { name: string; personality: string; date: string; lines: string[]; latestMsgTs: string; latestUserTs: string }[] = [];

  for (const chat of chats) {
    const msgs = await getMessages(chat.id);
    const todayMsgs = msgs.filter((m: any) =>
      m.timestamp?.startsWith(today) && m.role !== "system"
    );
    if (todayMsgs.length === 0) continue;
    // 必须有用户主动发送的消息才算有效对话
    const userMsgs = todayMsgs.filter((m: any) => m.role === "user");
    if (userMsgs.length === 0) continue;

    let charName = "Luna";
    let charPersonality = "";
    if (chat.character_id) {
      const info = await getCharacterById(chat.character_id);
      if (info) {
        charName = info.name;
        charPersonality = [info.description, info.personality].filter(Boolean).join("。性格：");
      }
    }

    const lines = todayMsgs.map((m: any) => {
      const ts = m.timestamp ? (bindSystemClock ? new Date(m.timestamp + "Z") : new Date(m.timestamp)) : new Date();
      const time = `${String(ts.getHours()).padStart(2,'0')}:${String(ts.getMinutes()).padStart(2,'0')}`;
      const label = m.role === "user" ? (settings.user_name || "对方") : charName;
      return `[${time}] ${label}: ${m.content}`;
    });
    const lastMsg = todayMsgs[todayMsgs.length - 1];
    const convDate = lastMsg?.timestamp
      ? (bindSystemClock ? new Date(lastMsg.timestamp + "Z") : new Date(lastMsg.timestamp))
      : new Date();
    const dateStr = `${convDate.getFullYear()}-${String(convDate.getMonth() + 1).padStart(2, "0")}-${String(convDate.getDate()).padStart(2, "0")}`;

    const lastUserMsg = [...todayMsgs].reverse().find((m: any) => m.role === "user");
    charConversations.push({
      name: charName,
      personality: charPersonality,
      date: dateStr,
      lines,
      latestMsgTs: lastMsg?.timestamp || "",
      latestUserTs: lastUserMsg?.timestamp || "",
    });
  }

  if (charConversations.length === 0) {
    return { written: false, message: "今天没有对话，无法生成日记" };
  }

  const existingDiaries = await getDiaryEntries();

  // 为每个角色写日记（每人独立判断是否需要写）
  const diaryParts: string[] = [];
  for (const conv of charConversations) {
    // 找到该角色上一次的日记
    const existingForChar = existingDiaries.filter((d: any) => d.date === conv.date);
    const existingToday = existingForChar.find((d: any) => d.title?.startsWith(conv.name));
    const previousDiary = existingToday ? (existingToday.manual_note || existingToday.summary || "") : "";

    // 上次日记的 created_at 时间戳（SQLite UTC 格式，可直接字符串比较）
    const lastDiaryTs = existingToday?.created_at || "";

    // 过滤：如果最后一次用户消息在上次日记之前，说明没有新对话，跳过
    if (lastDiaryTs && conv.latestUserTs <= lastDiaryTs) {
      continue;
    }

    setStatus(`${conv.name} 正在写日记...`);
    try {
      const rawContext = conv.lines.join("\n");
      const isContinuation = previousDiary.length > 0;
      const fullContext = isContinuation ? rawContext : rawContext + (existingDiaries.length > 0
        ? "\n\n近期的日记记录（供参考）：\n" + existingDiaries.slice(0, 3).map((d: any) =>
            `[${d.date}]\n${(d.manual_note || d.summary || "").slice(0, 200)}`
          ).join("\n\n")
        : "");

      const text = await invoke<string>("generate_diary", {
        context: fullContext,
        characterName: conv.name,
        characterPersonality: conv.personality,
        maxLength: diaryMaxLength,
        previousDiary,
        isContinuation,
        settings,
      });
      diaryParts.push(`【${conv.name} 的日记】\n${text}`);
    } catch (e) {
      diaryParts.push(`【${conv.name} 的日记】\n（日记生成失败）`);
    }
  }

  if (diaryParts.length === 0) {
    return { written: false, message: "所有角色都没有新的对话，无需写日记" };
  }

  // 保存
  for (const part of diaryParts) {
    const match = part.match(/^【(.+?) 的日记】/);
    const charName = match ? match[1] : "未知";
    const conv = charConversations.find((c) => c.name === charName);
    const diaryDate = conv?.date || today;
    await invoke("save_diary_entry", {
      date: diaryDate,
      characterName: charName,
      content: part.replace(/^【.+? 的日记】\n?/, ""),
    });
  }

  return { written: true, message: "日记已保存" };
}
