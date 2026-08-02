import {
  assertCanOwn,
  assertCanConsume,
  toRepoContext,
  type ServiceContext,
} from "./context";
import { getClient, throwIfError } from "../repository/base";
import { broadcastAcademicWrite } from "../live";

export type ChatContact = {
  userId: string;
  name: string;
  role: string;
  unread: number;
  lastMessage?: string;
  lastTime?: string;
};

export type ChatMessage = {
  id: string;
  senderId: string;
  receiverId: string;
  content: string;
  isRead: boolean;
  createdAt: string;
};

/**
 * MessageService — direct messages via `messages` + `get_chat_contacts` RPC.
 */
export const MessageService = {
  async listContacts(ctx: ServiceContext): Promise<ChatContact[]> {
    assertCanConsume(ctx, "message");
    const client = getClient(toRepoContext(ctx));
    const { data: allowedUsers, error } = await client.rpc("get_chat_contacts" as never);
    throwIfError(error, "Failed to load chat contacts");

    const contactList: ChatContact[] = ((allowedUsers as { user_id: string; name?: string; role?: string }[] | null) ?? []).map(
      (u) => ({
        userId: u.user_id,
        name: u.name || "Unknown",
        role: u.role || "user",
        unread: 0,
      }),
    );

    if (contactList.length === 0) return contactList;

    const { data: received } = await client
      .from("messages")
      .select("sender_id, is_read, content, created_at")
      .eq("receiver_id", ctx.userId)
      .order("created_at", { ascending: false });

    for (const m of received ?? []) {
      const contact = contactList.find((c) => c.userId === m.sender_id);
      if (!contact) continue;
      if (!m.is_read) contact.unread += 1;
      if (!contact.lastMessage) {
        contact.lastMessage = m.content;
        contact.lastTime = m.created_at;
      }
    }

    const { data: sent } = await client
      .from("messages")
      .select("receiver_id, content, created_at")
      .eq("sender_id", ctx.userId)
      .order("created_at", { ascending: false });

    for (const m of sent ?? []) {
      const contact = contactList.find((c) => c.userId === m.receiver_id);
      if (contact && (!contact.lastTime || m.created_at > contact.lastTime)) {
        contact.lastMessage = `You: ${m.content}`;
        contact.lastTime = m.created_at;
      }
    }

    contactList.sort((a, b) => {
      if (a.unread !== b.unread) return b.unread - a.unread;
      return (b.lastTime || "") > (a.lastTime || "") ? 1 : -1;
    });

    return contactList;
  },

  async listThread(ctx: ServiceContext, peerUserId: string): Promise<ChatMessage[]> {
    assertCanConsume(ctx, "message");
    const client = getClient(toRepoContext(ctx));
    const { data, error } = await client
      .from("messages")
      .select("*")
      .or(
        `and(sender_id.eq.${ctx.userId},receiver_id.eq.${peerUserId}),and(sender_id.eq.${peerUserId},receiver_id.eq.${ctx.userId})`,
      )
      .order("created_at", { ascending: true });
    throwIfError(error, "Failed to load messages");

    await client
      .from("messages")
      .update({ is_read: true })
      .eq("sender_id", peerUserId)
      .eq("receiver_id", ctx.userId)
      .eq("is_read", false);

    return ((data ?? []) as {
      id: string;
      sender_id: string;
      receiver_id: string;
      content: string;
      is_read: boolean;
      created_at: string;
    }[]).map((m) => ({
      id: m.id,
      senderId: m.sender_id,
      receiverId: m.receiver_id,
      content: m.content,
      isRead: m.is_read,
      createdAt: m.created_at,
    }));
  },

  async send(ctx: ServiceContext, receiverId: string, content: string): Promise<ChatMessage> {
    assertCanOwn(ctx, "message");
    const body = content.trim();
    if (!body) throw new Error("Message cannot be empty");
    const { data, error } = await getClient(toRepoContext(ctx))
      .from("messages")
      .insert({
        sender_id: ctx.userId,
        receiver_id: receiverId,
        content: body,
        is_read: false,
      })
      .select("*")
      .single();
    throwIfError(error, "Failed to send message");
    broadcastAcademicWrite(ctx.schoolId, ["profile"], {
      source: "MessageService.send",
    });
    const m = data as {
      id: string;
      sender_id: string;
      receiver_id: string;
      content: string;
      is_read: boolean;
      created_at: string;
    };
    return {
      id: m.id,
      senderId: m.sender_id,
      receiverId: m.receiver_id,
      content: m.content,
      isRead: m.is_read,
      createdAt: m.created_at,
    };
  },
};
