export type ConversationStatus = "BOT" | "WAITING_HUMAN" | "HUMAN" | "CLOSED";

export interface ConversationSummary {
  id: string;
  status: ConversationStatus;
  lastMessageAt: string | null;
  assignedToUserId: string | null;
  assignedTo: { id: string; name: string } | null;
  contact: { id: string; firstName: string | null; lastName: string | null };
  channelConnection: { provider: string; displayName: string | null; externalAccountId: string };
}

export interface ConversationMessageItem {
  id: string;
  direction: "IN" | "OUT";
  senderType: "CONTACT" | "AGENT" | "BOT";
  body: string;
  createdAt: string;
}

export interface ConversationDetail extends ConversationSummary {
  messages: ConversationMessageItem[];
}

export const STATUS_LABEL: Record<ConversationStatus, string> = {
  BOT: "Bot",
  WAITING_HUMAN: "Aguardando atendimento",
  HUMAN: "Em atendimento",
  CLOSED: "Fechada",
};

export function contactDisplayName(contact: ConversationSummary["contact"]): string {
  const name = [contact.firstName, contact.lastName].filter(Boolean).join(" ");
  return name || "Contato sem nome";
}
