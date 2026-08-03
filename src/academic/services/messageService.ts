import {
  assertCanOwn,
  assertCanConsume,
  toRepoContext,
  type ServiceContext,
} from "./context";
import { getClient, throwIfError } from "../repository/base";
import { broadcastAcademicWrite } from "../live";
import { invokeEdgeFunction } from "@/lib/edgeFunction";

/** Best-effort FCM for DM receivers (native tokens). Never blocks the send path. */
function notifyReceiverPush(receiverId: string, title: string, body: string): void {
  void invokeEdgeFunction("send-push", {
    audience: "user",
    user_id: receiverId,
    title,
    body,
  }).then((res) => {
    if (res.error) console.warn("[MessageService] push notify skipped:", res.error);
  });
}

export type ChatContact = {
  userId: string;
  name: string;
  role: string;
  unread: number;
  lastMessage?: string;
  lastTime?: string;
  avatarUrl?: string | null;
  /** Present when backed by chat_conversations */
  conversationId?: string;
  kind?: "dm" | "class_group" | "teacher_group";
  classId?: string | null;
};

export type ChatAttachment = {
  id?: string;
  name: string;
  url: string;
  mimeType?: string | null;
  sizeBytes?: number | null;
};

export type ChatMessage = {
  id: string;
  senderId: string;
  receiverId: string | null;
  conversationId?: string | null;
  content: string;
  isRead: boolean;
  createdAt: string;
  replyToId?: string | null;
  deletedAt?: string | null;
  attachments?: ChatAttachment[];
  /** Resolved reply preview (optional) */
  replyPreview?: string | null;
};

export type ChatSearchHit = {
  conversationId?: string | null;
  peerUserId?: string | null;
  title: string;
  snippet: string;
  createdAt?: string | null;
};

type DbMessage = {
  id: string;
  sender_id: string;
  receiver_id: string | null;
  conversation_id?: string | null;
  content: string;
  is_read: boolean;
  created_at: string;
  reply_to_id?: string | null;
  deleted_at?: string | null;
  has_attachment?: boolean | null;
};

type InboxRow = {
  conversation_id: string;
  kind: string;
  title: string;
  class_id: string | null;
  peer_user_id: string | null;
  peer_role: string | null;
  unread: number;
  last_message: string | null;
  last_time: string | null;
};

function mapMessage(m: DbMessage, attachments: ChatAttachment[] = [], replyPreview?: string | null): ChatMessage {
  return {
    id: m.id,
    senderId: m.sender_id,
    receiverId: m.receiver_id,
    conversationId: m.conversation_id ?? null,
    content: m.deleted_at ? "Message deleted" : m.content,
    isRead: m.is_read,
    createdAt: m.created_at,
    replyToId: m.reply_to_id ?? null,
    deletedAt: m.deleted_at ?? null,
    attachments: m.deleted_at ? [] : attachments,
    replyPreview: m.deleted_at ? null : replyPreview ?? null,
  };
}

async function loadAttachments(
  client: ReturnType<typeof getClient>,
  messageIds: string[],
): Promise<Map<string, ChatAttachment[]>> {
  const map = new Map<string, ChatAttachment[]>();
  if (messageIds.length === 0) return map;
  const { data, error } = await client
    .from("message_attachments" as never)
    .select("id, message_id, name, url, mime_type, size_bytes")
    .in("message_id", messageIds);
  if (error || !data) return map;
  for (const row of data as {
    id: string;
    message_id: string;
    name: string;
    url: string;
    mime_type: string | null;
    size_bytes: number | null;
  }[]) {
    const list = map.get(row.message_id) ?? [];
    list.push({
      id: row.id,
      name: row.name,
      url: row.url,
      mimeType: row.mime_type,
      sizeBytes: row.size_bytes,
    });
    map.set(row.message_id, list);
  }
  return map;
}

/**
 * MessageService ΓÇö school chat SSOT (DM + class/teacher groups).
 */
export const MessageService = {
  async listConversations(ctx: ServiceContext, search?: string): Promise<ChatContact[]> {
    assertCanConsume(ctx, "message");
    const client = getClient(toRepoContext(ctx));
    const { data, error } = await client.rpc("rpc_list_conversations" as never, {
      _search: search ?? null,
      _limit: 50,
    } as never);
    if (!error && Array.isArray(data)) {
      return (data as any[]).map((r) => ({
        userId: r.peer_user_id || r.conversation_id,
        name: r.title || "Chat",
        role:
          r.kind === "class_group"
            ? "class_group"
            : r.kind === "teacher_group"
              ? "teacher_group"
              : r.peer_role || "user",
        unread: r.unread ?? 0,
        lastMessage: r.last_message ?? undefined,
        lastTime: r.last_time ?? undefined,
        conversationId: r.conversation_id,
        kind: r.kind as ChatContact["kind"],
        classId: r.class_id,
      }));
    }
    const all = await this.listContacts(ctx);
    const q = (search || "").trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.lastMessage || "").toLowerCase().includes(q),
    );
  },

  async listContacts(ctx: ServiceContext): Promise<ChatContact[]> {
    assertCanConsume(ctx, "message");
    const client = getClient(toRepoContext(ctx));

    const { data: inbox, error: inboxErr } = await client.rpc("get_chat_inbox" as never);
    if (!inboxErr && Array.isArray(inbox)) {
      const rows = inbox as InboxRow[];
      const mapped: ChatContact[] = rows.map((r) => ({
        userId: r.peer_user_id || r.conversation_id,
        name: r.title || "Chat",
        role:
          r.kind === "class_group"
            ? "class_group"
            : r.kind === "teacher_group"
              ? "teacher_group"
              : r.peer_role || "user",
        unread: r.unread ?? 0,
        lastMessage: r.last_message ?? undefined,
        lastTime: r.last_time ?? undefined,
        conversationId: r.conversation_id,
        kind: r.kind as ChatContact["kind"],
        classId: r.class_id,
      }));
      // Merge allowed DM contacts that have no conversation yet
      const { data: allowedUsers } = await client.rpc("get_chat_contacts" as never);
      const have = new Set(mapped.map((c) => c.userId));
      for (const u of (allowedUsers as { user_id: string; name?: string; role?: string }[] | null) ?? []) {
        if (have.has(u.user_id)) continue;
        mapped.push({
          userId: u.user_id,
          name: u.name || "Unknown",
          role: u.role || "user",
          unread: 0,
          kind: "dm",
        });
      }
      mapped.sort((a, b) => {
        if (a.unread !== b.unread) return b.unread - a.unread;
        return (b.lastTime || "") > (a.lastTime || "") ? 1 : -1;
      });
      return mapped;
    }

    // Fallback: legacy contacts + messages (pre-MVP SQL)
    const { data: allowedUsers, error } = await client.rpc("get_chat_contacts" as never);
    throwIfError(error ?? inboxErr, "Failed to load chat contacts");

    const contactList: ChatContact[] = ((allowedUsers as { user_id: string; name?: string; role?: string }[] | null) ?? []).map(
      (u) => ({
        userId: u.user_id,
        name: u.name || "Unknown",
        role: u.role || "user",
        unread: 0,
        kind: "dm" as const,
      }),
    );

    if (contactList.length === 0) return contactList;

    const { data: received, error: recvErr } = await client
      .from("messages")
      .select("sender_id, is_read, content, created_at")
      .eq("receiver_id", ctx.userId)
      .order("created_at", { ascending: false });
    throwIfError(recvErr, "Failed to load received messages");

    for (const m of received ?? []) {
      const contact = contactList.find((c) => c.userId === m.sender_id);
      if (!contact) continue;
      if (!m.is_read) contact.unread += 1;
      if (!contact.lastMessage) {
        contact.lastMessage = m.content;
        contact.lastTime = m.created_at;
      }
    }

    const { data: sent, error: sentErr } = await client
      .from("messages")
      .select("receiver_id, content, created_at")
      .eq("sender_id", ctx.userId)
      .order("created_at", { ascending: false });
    throwIfError(sentErr, "Failed to load sent messages");

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

  async countUnread(ctx: ServiceContext): Promise<number> {
    assertCanConsume(ctx, "message");
    const client = getClient(toRepoContext(ctx));
    const { data, error } = await client.rpc("get_chat_unread_total" as never);
    if (!error && typeof data === "number") return data;

    const { count, error: countErr } = await client
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("receiver_id", ctx.userId)
      .eq("is_read", false);
    throwIfError(countErr ?? error, "Failed to count unread messages");
    return count ?? 0;
  },

  async openThread(ctx: ServiceContext, conversationId: string): Promise<ChatMessage[]> {
    return this.listThread(ctx, conversationId, conversationId);
  },

  async listThread(ctx: ServiceContext, peerUserId: string, conversationId?: string | null): Promise<ChatMessage[]> {
    assertCanConsume(ctx, "message");
    const client = getClient(toRepoContext(ctx));

    let convId = conversationId ?? null;
    if (!convId) {
      const { data: ensured } = await client.rpc("rpc_ensure_dm" as never, {
        _peer_user_id: peerUserId,
      } as never);
      if (ensured) {
        const row = (Array.isArray(ensured) ? ensured[0] : ensured) as { id?: string };
        convId = row?.id ?? null;
      }
    }

    let data: DbMessage[] | null = null;
    if (convId) {
      const res = await (client as any)
        .from("messages")
        .select("*")
        .eq("conversation_id", convId)
        .order("created_at", { ascending: true });
      throwIfError(res.error, "Failed to load messages");
      data = res.data as DbMessage[] | null;
      await this.markConversationRead(ctx, convId);
    } else {
      const res = await client
        .from("messages")
        .select("*")
        .or(
          `and(sender_id.eq.${ctx.userId},receiver_id.eq.${peerUserId}),and(sender_id.eq.${peerUserId},receiver_id.eq.${ctx.userId})`,
        )
        .order("created_at", { ascending: true });
      throwIfError(res.error, "Failed to load messages");
      data = res.data as DbMessage[] | null;
      await this.markThreadRead(ctx, peerUserId);
    }

    const rows = data ?? [];
    const attMap = await loadAttachments(
      client,
      rows.filter((m) => m.has_attachment).map((m) => m.id),
    );
    const byId = new Map(rows.map((m) => [m.id, m]));
    return rows.map((m) =>
      mapMessage(
        m,
        attMap.get(m.id) ?? [],
        m.reply_to_id ? byId.get(m.reply_to_id)?.content ?? null : null,
      ),
    );
  },

  async markThreadRead(ctx: ServiceContext, peerUserId: string): Promise<void> {
    assertCanOwn(ctx, "message");
    const client = getClient(toRepoContext(ctx));
    const { error: rpcErr } = await client.rpc("rpc_mark_messages_read" as never, {
      _peer_user_id: peerUserId,
    } as never);

    if (rpcErr) {
      const { error } = await client
        .from("messages")
        .update({ is_read: true })
        .eq("sender_id", peerUserId)
        .eq("receiver_id", ctx.userId)
        .eq("is_read", false);
      throwIfError(error, "Failed to mark messages read");
    }

    broadcastAcademicWrite(ctx.schoolId, ["message"], {
      source: "MessageService.markThreadRead",
    });
  },

  async markConversationRead(ctx: ServiceContext, conversationId: string): Promise<void> {
    assertCanOwn(ctx, "message");
    const client = getClient(toRepoContext(ctx));
    const { error } = await client.rpc("rpc_mark_conversation_read" as never, {
      _conversation_id: conversationId,
    } as never);
    if (error) {
      // Soft-fail until SQL applied
      return;
    }
    broadcastAcademicWrite(ctx.schoolId, ["message"], {
      source: "MessageService.markConversationRead",
    });
  },

  async reply(
    ctx: ServiceContext,
    receiverId: string,
    content: string,
    replyToId: string,
    opts?: { conversationId?: string | null; attachment?: ChatAttachment | null },
  ): Promise<ChatMessage> {
    return this.send(ctx, receiverId, content, {
      conversationId: opts?.conversationId,
      replyToId,
      attachment: opts?.attachment,
    });
  },

  async send(
    ctx: ServiceContext,
    receiverId: string,
    content: string,
    opts?: {
      conversationId?: string | null;
      replyToId?: string | null;
      attachment?: ChatAttachment | null;
    },
  ): Promise<ChatMessage> {
    assertCanOwn(ctx, "message");
    const body = content.trim();
    const att = opts?.attachment;
    if (!body && !att?.url) throw new Error("Message cannot be empty");

    const client = getClient(toRepoContext(ctx));
    const { data: rpcData, error: rpcErr } = await client.rpc("rpc_send_chat_message" as never, {
      _conversation_id: opts?.conversationId ?? null,
      _receiver_id: opts?.conversationId ? null : receiverId,
      _content: body,
      _reply_to_id: opts?.replyToId ?? null,
      _attachment_name: att?.name ?? null,
      _attachment_url: att?.url ?? null,
      _attachment_mime: att?.mimeType ?? null,
      _attachment_size: att?.sizeBytes ?? null,
    } as never);
    // Never fall back to raw INSERT ΓÇö that bypassed DM / class / school checks.
    throwIfError(rpcErr, "Failed to send message");
    if (!rpcData) throw new Error("Failed to send message");
    const m = (Array.isArray(rpcData) ? rpcData[0] : rpcData) as DbMessage;
    if (!m?.id) throw new Error("Failed to send message");

    broadcastAcademicWrite(ctx.schoolId, ["message"], {
      source: "MessageService.send",
    });

    if (m.receiver_id) {
      const preview = (body || att?.name || "New message").slice(0, 160);
      notifyReceiverPush(m.receiver_id, "New message", preview);
    }

    const attachments = att?.url
      ? [{ name: att.name, url: att.url, mimeType: att.mimeType, sizeBytes: att.sizeBytes }]
      : await loadAttachments(client, [m.id]).then((map) => map.get(m.id) ?? []);

    return mapMessage(m, attachments);
  },

  async sendFile(
    ctx: ServiceContext,
    opts: {
      receiverId: string;
      file: File;
      conversationId?: string | null;
      caption?: string;
      replyToId?: string | null;
    },
  ): Promise<ChatMessage> {
    assertCanOwn(ctx, "message");
    if (!ctx.schoolId) throw new Error("Missing school context");
    const { uploadChatAttachment } = await import("../storage/chatFileUpload");
    const threadKey = opts.conversationId || opts.receiverId || "dm";
    const uploaded = await uploadChatAttachment(opts.file, ctx.schoolId, threadKey);
    return this.send(ctx, opts.receiverId, opts.caption || "", {
      conversationId: opts.conversationId,
      replyToId: opts.replyToId,
      attachment: {
        name: uploaded.name,
        url: uploaded.url,
        mimeType: uploaded.mimeType,
        sizeBytes: uploaded.sizeBytes,
      },
    });
  },

  async deleteMessage(ctx: ServiceContext, messageId: string): Promise<void> {
    assertCanOwn(ctx, "message");
    const client = getClient(toRepoContext(ctx));
    const { error } = await client.rpc("rpc_delete_chat_message" as never, {
      _message_id: messageId,
    } as never);
    if (error) {
      const { error: altErr } = await client.rpc("rpc_delete_message" as never, {
        _message_id: messageId,
      } as never);
      throwIfError(altErr ?? error, "Failed to delete message");
    }
    broadcastAcademicWrite(ctx.schoolId, ["message"], {
      source: "MessageService.deleteMessage",
    });
  },

  async ensureClassGroup(ctx: ServiceContext, classId: string): Promise<ChatContact> {
    assertCanOwn(ctx, "message");
    const client = getClient(toRepoContext(ctx));
    const { data, error } = await client.rpc("rpc_ensure_class_group" as never, {
      _class_id: classId,
    } as never);
    throwIfError(error, "Failed to create class group");
    if (!data) throw new Error("Failed to create class group");
    const row = (Array.isArray(data) ? data[0] : data) as {
      id: string;
      title: string;
      class_id: string | null;
      kind: string;
    };
    broadcastAcademicWrite(ctx.schoolId, ["message"], { source: "MessageService.ensureClassGroup" });
    return {
      userId: row.id,
      conversationId: row.id,
      name: row.title,
      role: "class_group",
      kind: "class_group",
      classId: row.class_id,
      unread: 0,
    };
  },

  async ensureTeacherGroup(ctx: ServiceContext): Promise<ChatContact> {
    assertCanOwn(ctx, "message");
    const client = getClient(toRepoContext(ctx));
    const { data, error } = await client.rpc("rpc_ensure_teacher_group" as never);
    throwIfError(error, "Failed to create teacher group");
    if (!data) throw new Error("Failed to create teacher group");
    const row = (Array.isArray(data) ? data[0] : data) as {
      id: string;
      title: string;
      kind: string;
    };
    broadcastAcademicWrite(ctx.schoolId, ["message"], { source: "MessageService.ensureTeacherGroup" });
    return {
      userId: row.id,
      conversationId: row.id,
      name: row.title || "Teacher Group",
      role: "teacher_group",
      kind: "teacher_group",
      unread: 0,
    };
  },

  /** Client-side search over inbox rows (name / role / last message). */
  searchContacts(contacts: ChatContact[], query: string): ChatContact[] {
    const q = query.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.role.toLowerCase().includes(q) ||
        (c.lastMessage || "").toLowerCase().includes(q),
    );
  },

  /** Optional server-side message body search (no-op until RPC applied). */
  async search(ctx: ServiceContext, query: string): Promise<ChatSearchHit[]> {
    assertCanConsume(ctx, "message");
    const q = query.trim();
    if (!q) return [];
    const client = getClient(toRepoContext(ctx));
    const { data, error } = await client.rpc("rpc_search_chat" as never, { _query: q } as never);
    if (error || !Array.isArray(data)) return [];
    return (data as {
      conversation_id?: string | null;
      peer_user_id?: string | null;
      title?: string;
      snippet?: string;
      created_at?: string | null;
    }[]).map((r) => ({
      conversationId: r.conversation_id ?? null,
      peerUserId: r.peer_user_id ?? null,
      title: r.title || "Chat",
      snippet: r.snippet || "",
      createdAt: r.created_at ?? null,
    }));
  },

  /** Students/parents never; class teachers + principal/admin yes. */
  async canCreateClassGroup(ctx: ServiceContext): Promise<boolean> {
    if (ctx.role === "student" || ctx.role === "parent") return false;
    if (ctx.role === "principal" || ctx.role === "admin") return true;
    if (ctx.role !== "teacher") return false;
    const client = getClient(toRepoContext(ctx));
    const { data } = await client
      .from("teachers")
      .select("class_teacher_of")
      .eq("user_id", ctx.userId)
      .maybeSingle();
    return Boolean(data?.class_teacher_of);
  },

  /** Ensure Class Group when allowed (class_teacher_of or ctx.classId). */
  async createClassGroup(ctx: ServiceContext, classIdArg?: string): Promise<ChatContact> {
    const allowed = await this.canCreateClassGroup(ctx);
    if (!allowed) throw new Error("Only class teachers or school admins can create a Class Group");
    let classId = classIdArg ?? ctx.classId ?? null;
    if (!classId) {
      const client = getClient(toRepoContext(ctx));
      const { data } = await client
        .from("teachers")
        .select("class_teacher_of")
        .eq("user_id", ctx.userId)
        .maybeSingle();
      classId = data?.class_teacher_of ?? null;
    }
    if (!classId) throw new Error("No class available for Class Group");
    return this.ensureClassGroup(ctx, classId);
  },
  async createTeacherGroup(ctx: ServiceContext, title?: string): Promise<ChatContact> {
    assertCanOwn(ctx, "message");
    if (ctx.role === "student" || ctx.role === "parent") {
      throw new Error("Only teachers or principal can create a Teacher Group");
    }
    const client = getClient(toRepoContext(ctx));
    const { data, error } = await client.rpc("rpc_create_teacher_group" as never, {
      _title: title ?? null,
    } as never);
    if (!error && data) {
      const row = (Array.isArray(data) ? data[0] : data) as { id: string; title: string };
      broadcastAcademicWrite(ctx.schoolId, ["message"], { source: "MessageService.createTeacherGroup" });
      return {
        userId: row.id,
        conversationId: row.id,
        name: row.title || "Teacher Group",
        role: "teacher_group",
        kind: "teacher_group",
        unread: 0,
      };
    }
    return this.ensureTeacherGroup(ctx);
  },
};
