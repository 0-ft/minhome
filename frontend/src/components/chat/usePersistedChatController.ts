import { useChat } from "@ai-sdk/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { UIMessage } from "ai";
import { useChatById, useChats, useCreateChat } from "../../api.js";

type ChatSource = "text" | "voice";

export function usePersistedChatController(source: ChatSource = "text") {
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const bootstrappedRef = useRef(false);
  const creatingInitialChatRef = useRef(false);
  const hydratedChatIdRef = useRef<string | null>(null);
  const hydratedChatUpdatedAtRef = useRef<string | null>(null);

  const { data: chats = [], isFetched: chatsFetched } = useChats();
  const { data: activeChat } = useChatById(activeChatId);
  const createChat = useCreateChat();
  const chat = useChat({
    id: activeChatId ?? undefined,
  });

  const { setMessages } = chat;

  useEffect(() => {
    if (bootstrappedRef.current) return;
    if (!chatsFetched) return;
    if (activeChatId) {
      bootstrappedRef.current = true;
      return;
    }
    if (chats.length > 0) {
      setActiveChatId(chats[0].id);
      hydratedChatIdRef.current = null;
      bootstrappedRef.current = true;
      return;
    }
    if (creatingInitialChatRef.current) return;
    creatingInitialChatRef.current = true;
    bootstrappedRef.current = true;
    createChat.mutate(
      { source },
      {
        onSuccess: (created) => {
          setActiveChatId(created.id);
          hydratedChatIdRef.current = created.id;
          hydratedChatUpdatedAtRef.current = created.updatedAt;
          setMessages((created.messages ?? []) as UIMessage[]);
          creatingInitialChatRef.current = false;
        },
        onError: () => {
          creatingInitialChatRef.current = false;
          bootstrappedRef.current = false;
        },
      },
    );
  }, [activeChatId, chats, chatsFetched, createChat, setMessages, source]);

  useEffect(() => {
    if (!activeChat || !activeChatId) return;
    if (activeChat.id !== activeChatId) return;
    if (
      hydratedChatIdRef.current === activeChatId
      && hydratedChatUpdatedAtRef.current === activeChat.updatedAt
    ) {
      return;
    }
    setMessages((activeChat.messages ?? []) as UIMessage[]);
    hydratedChatIdRef.current = activeChatId;
    hydratedChatUpdatedAtRef.current = activeChat.updatedAt;
  }, [activeChat, activeChatId, setMessages]);

  const selectChat = useCallback((chatId: string) => {
    hydratedChatIdRef.current = null;
    hydratedChatUpdatedAtRef.current = null;
    setActiveChatId(chatId);
  }, []);

  const createNewChat = useCallback(async () => {
    const created = await createChat.mutateAsync({ source });
    hydratedChatIdRef.current = created.id;
    hydratedChatUpdatedAtRef.current = created.updatedAt;
    setActiveChatId(created.id);
    setMessages((created.messages ?? []) as UIMessage[]);
    return created;
  }, [createChat, setMessages, source]);

  const markHydrationDirty = useCallback(() => {
    hydratedChatIdRef.current = null;
    hydratedChatUpdatedAtRef.current = null;
  }, []);

  return {
    ...chat,
    activeChatId,
    chats,
    chatsFetched,
    createChat,
    createNewChat,
    selectChat,
    setActiveChatId,
    markHydrationDirty,
  };
}
