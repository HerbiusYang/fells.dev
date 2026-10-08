/**
 * Reserved production backend contract; this file performs no HTTP requests.
 * The current UI uses support-service.ts with its local preview adapter.
 * A production adapter must map these server-owned DTOs to the UI model.
 */
export type SupportConversationStatus = "open" | "resolved";
export type SupportImageMime = "image/png" | "image/jpeg" | "image/webp";
export type SupportTimestamp = string; // ISO 8601 UTC, supplied by the server.

export interface SupportCustomerDto {
  id: string;
  name: string;
  email: string;
  joinedAt: SupportTimestamp;
  preferredLocale: string;
  workspaceCount: number;
  credits: number;
}

export interface SupportOperatorDto {
  id: string;
  name: string;
  email: string;
}

export interface SupportSessionDto {
  operator: SupportOperatorDto;
  expiresAt: SupportTimestamp;
}

/** Media is uploaded first. The server returns a temporary authorized URL. */
export interface SupportAttachmentDto {
  id: string;
  name: string;
  mimeType: SupportImageMime;
  size: number;
  url: string;
  urlExpiresAt: SupportTimestamp;
}

export interface SupportMessageDto {
  id: string;
  conversationId: string;
  clientMessageId: string;
  sender: "user" | "agent";
  text: string;
  attachments: SupportAttachmentDto[];
  createdAt: SupportTimestamp;
}

export interface SupportReadStateDto {
  lastReadMessageId: string | null;
  updatedAt: SupportTimestamp | null;
}

export interface SupportConversationSummaryDto {
  id: string;
  customer: SupportCustomerDto;
  status: SupportConversationStatus;
  lastMessage: SupportMessageDto | null;
  unreadCount: number; // Calculated for the authenticated viewer by the server.
  updatedAt: SupportTimestamp;
}

export interface SupportConversationDto extends SupportConversationSummaryDto {
  userRead: SupportReadStateDto;
  agentRead: SupportReadStateDto;
}

export interface SupportCursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

export interface SupportConversationQuery {
  cursor?: string;
  limit?: number;
  status?: SupportConversationStatus;
  search?: string;
}

export interface SupportMessageQuery {
  cursor?: string;
  limit?: number;
}

/** Credentials authenticate an operator on the server, never in browser storage. */
export interface SupportLoginPayload {
  email: string;
  password: string;
}

export interface SupportSendMessagePayload {
  clientMessageId: string; // Retry the same UUID to avoid duplicate messages.
  text: string; // At most 4,000 characters; empty only with an attachment.
  attachmentIds: string[]; // At most one attachment in the current UI.
}

export interface SupportReadPayload {
  lastReadMessageId: string;
}

export interface SupportStatusPayload {
  status: SupportConversationStatus;
}
export interface SupportTypingPayload {
  typing: boolean;
  sourceId: string; // A page UUID for independent short-lived leases, not authentication.
}
export interface SupportTypingStateDto {
  user: boolean;
  agent: boolean;
}
export interface SupportAvailabilityDto { online: boolean }
export interface SupportAvailabilityPayload {
  online: boolean;
  sourceId: string; // A page UUID; the operator identity comes from the server session.
}

export type SupportApiErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "validation_error"
  | "payload_too_large"
  | "unsupported_media"
  | "rate_limited"
  | "conflict"
  | "internal_error";

export interface SupportApiError {
  code: SupportApiErrorCode;
  message: string;
  fields?: Record<string, string>;
  retryAfterSeconds?: number;
}

export type SupportApiResponse<T> =
  | { ok: true; data: T; requestId: string }
  | { ok: false; error: SupportApiError; requestId: string };

export type SupportEventDto =
  | { id: string; type: "message.created"; data: SupportMessageDto }
  | { id: string; type: "conversation.updated"; data: SupportConversationSummaryDto }
  | { id: string; type: "conversation.read"; data: { conversationId: string; reader: "user" | "agent"; read: SupportReadStateDto } }
  | { id: string; type: "conversation.typing"; data: SupportTypingEventDto }
  | { id: string; type: "session.expired"; data: { role: "user" | "agent" } };
export interface SupportTypingEventDto { conversationId: string; sender: "user" | "agent"; typing: boolean; expiresAt: SupportTimestamp | null }

export interface SupportEventOptions {
  signal?: AbortSignal;
  lastEventId?: string;
}

export interface SupportEventConnection {
  close(): void;
}

/**
 * Both roles use server cookie authentication. Methods never accept a browser
 * session, customer ID, sender role or customer profile as authorization proof.
 * See docs/online-support.md for endpoint, validation and event requirements.
 */
export interface SupportBackendApi {
  loginOperator(payload: SupportLoginPayload): Promise<SupportApiResponse<SupportSessionDto>>;
  readOperatorSession(): Promise<SupportApiResponse<SupportSessionDto | null>>;
  logoutOperator(): Promise<SupportApiResponse<null>>;
  listConversations(query?: SupportConversationQuery): Promise<SupportApiResponse<SupportCursorPage<SupportConversationSummaryDto>>>;
  getCurrentConversation(): Promise<SupportApiResponse<SupportConversationDto | null>>;
  ensureCurrentConversation(): Promise<SupportApiResponse<SupportConversationDto>>;
  getConversation(conversationId: string): Promise<SupportApiResponse<SupportConversationDto>>;
  listMessages(conversationId: string, query?: SupportMessageQuery): Promise<SupportApiResponse<SupportCursorPage<SupportMessageDto>>>;
  uploadAttachment(file: File): Promise<SupportApiResponse<SupportAttachmentDto>>;
  sendMessage(conversationId: string, payload: SupportSendMessagePayload): Promise<SupportApiResponse<SupportMessageDto>>;
  markRead(conversationId: string, payload: SupportReadPayload): Promise<SupportApiResponse<SupportReadStateDto>>;
  setStatus(conversationId: string, payload: SupportStatusPayload): Promise<SupportApiResponse<SupportConversationSummaryDto>>;
  getTyping(conversationId: string): Promise<SupportApiResponse<SupportTypingStateDto>>;
  setTyping(conversationId: string, payload: SupportTypingPayload): Promise<SupportApiResponse<null>>;
  getAvailability(): Promise<SupportApiResponse<SupportAvailabilityDto>>;
  setAvailability(payload: SupportAvailabilityPayload): Promise<SupportApiResponse<null>>;
  openEvents(onEvent: (event: SupportEventDto) => void, options?: SupportEventOptions): Promise<SupportEventConnection>;
}
