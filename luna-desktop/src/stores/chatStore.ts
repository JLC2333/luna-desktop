import { create } from "zustand";
import { Message, Chat, ChatStats } from "../types";

interface ChatState {
  chats: Chat[];
  currentChatId: number | null;
  messages: Message[];
  stats: ChatStats | null;
  isLoading: boolean;
  currentCharacterId: number | null;
  setChats: (chats: Chat[]) => void;
  setCurrentChat: (id: number | null) => void;
  setMessages: (messages: Message[]) => void;
  addMessage: (message: Message) => void;
  setStats: (stats: ChatStats | null) => void;
  setIsLoading: (loading: boolean) => void;
  setCurrentCharacter: (id: number | null) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  chats: [],
  currentChatId: null,
  messages: [],
  stats: null,
  isLoading: false,
  currentCharacterId: null,
  setChats: (chats) => set({ chats }),
  setCurrentChat: (id) => set({ currentChatId: id }),
  setMessages: (messages) => set({ messages }),
  addMessage: (message) =>
    set((state) => ({ messages: [...state.messages, message] })),
  setStats: (stats) => set({ stats }),
  setIsLoading: (loading) => set({ isLoading: loading }),
  setCurrentCharacter: (id) => set({ currentCharacterId: id }),
}));
