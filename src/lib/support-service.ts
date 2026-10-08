// UI-facing service boundary. The local adapter can be replaced with a backend
// adapter without moving persistence or transport details into either UI.
import * as local from "./support-store";
import type { Snapshot } from "./preview-store";
import type { SupportAgent, SupportConversation, SupportImage } from "./support-store";
export type { SupportAgent, SupportConversation, SupportImage } from "./support-store";
export { SUPPORT_CHANNEL, MAX_SUPPORT_IMAGE_BYTES, SupportStorageFull, InvalidSupportData, SupportSessionEnded, validateSupportImage } from "./support-store";
export { MAX_SUPPORT_IMAGE_PIXELS } from "./support-image";

export interface SupportService {
  readSupport(expectedAgentSession?: string): Promise<SupportConversation[]>;
  ensureUserConversation(snapshot: Snapshot, locale: string): Promise<SupportConversation>;
  sendUserMessage(session: string, text: string, image?: SupportImage): Promise<SupportConversation>;
  markUserRead(session: string, throughCreated?: number): Promise<void>;
  beginSupportSession(name: string, email: string): Promise<SupportAgent>;
  readSupportSession(): Promise<SupportAgent | null>;
  endSupportSession(session: string): Promise<void>;
  sendAgentMessage(session: string, conversationId: string, text: string, image?: SupportImage): Promise<SupportConversation>;
  markAgentRead(session: string, conversationId: string, throughCreated?: number): Promise<void>;
  setConversationStatus(session: string, conversationId: string, status: "open" | "resolved"): Promise<void>;
  seedSupportDemo(session: string): Promise<void>;
  readUserTyping(session: string): Promise<boolean>;
  setUserTyping(session: string, typing: boolean, sourceId: string): Promise<void>;
  readAgentTyping(session: string, conversationId: string): Promise<boolean>;
  setAgentTyping(session: string, conversationId: string, typing: boolean, sourceId: string): Promise<void>;
  readSupportAvailability(session: string): Promise<boolean>;
  setAgentAvailability(session: string, online: boolean, sourceId: string): Promise<void>;
}

// Explicitly a demo adapter. Production authentication and media upload DTOs
// are defined separately in support-api.ts and docs/online-support.md.
const service: SupportService = local;
export const readSupport: SupportService["readSupport"] = (...args) => service.readSupport(...args);
export const ensureUserConversation: SupportService["ensureUserConversation"] = (...args) => service.ensureUserConversation(...args);
export const sendUserMessage: SupportService["sendUserMessage"] = (...args) => service.sendUserMessage(...args);
export const markUserRead: SupportService["markUserRead"] = (...args) => service.markUserRead(...args);
export const beginSupportSession: SupportService["beginSupportSession"] = (...args) => service.beginSupportSession(...args);
export const readSupportSession: SupportService["readSupportSession"] = (...args) => service.readSupportSession(...args);
export const endSupportSession: SupportService["endSupportSession"] = (...args) => service.endSupportSession(...args);
export const sendAgentMessage: SupportService["sendAgentMessage"] = (...args) => service.sendAgentMessage(...args);
export const markAgentRead: SupportService["markAgentRead"] = (...args) => service.markAgentRead(...args);
export const setConversationStatus: SupportService["setConversationStatus"] = (...args) => service.setConversationStatus(...args);
export const seedSupportDemo: SupportService["seedSupportDemo"] = (...args) => service.seedSupportDemo(...args);
export const readUserTyping: SupportService["readUserTyping"] = (...args) => service.readUserTyping(...args);
export const setUserTyping: SupportService["setUserTyping"] = (...args) => service.setUserTyping(...args);
export const readAgentTyping: SupportService["readAgentTyping"] = (...args) => service.readAgentTyping(...args);
export const setAgentTyping: SupportService["setAgentTyping"] = (...args) => service.setAgentTyping(...args);
export const readSupportAvailability: SupportService["readSupportAvailability"] = (...args) => service.readSupportAvailability(...args);
export const setAgentAvailability: SupportService["setAgentAvailability"] = (...args) => service.setAgentAvailability(...args);
