import ChatPage from "@/pages/shared/ChatPage";

/** Parent messages — live MessageService via shared ChatPage (no mock threads). */
export default function ParentMessages() {
  return <ChatPage userRole="parent" />;
}
