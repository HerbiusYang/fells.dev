// UI-facing service boundary. Cookies and server DTOs are handled by the HTTP
// adapter; the retained local store is used only by its explicit preview tests.
import { supportHttp, type CustomerSupportSession } from "./support-http";
import type { SupportAgent, SupportConversation, SupportImage } from "./support-store";
export type { SupportAgent, SupportConversation, SupportImage } from "./support-store";
export { SUPPORT_CHANNEL, MAX_SUPPORT_IMAGE_BYTES, SupportStorageFull, InvalidSupportData, SupportSessionEnded, validateSupportImage } from "./support-store";
export { MAX_SUPPORT_IMAGE_PIXELS } from "./support-image";

export interface SupportService {
  readSupport(expectedAgentSession?: string): Promise<SupportConversation[]>;
  ensureUserConversation(snapshot: CustomerSupportSession, locale: string): Promise<SupportConversation>;
  sendUserMessage(session: string, text: string, image?: SupportImage): Promise<SupportConversation>;
  markUserRead(session: string, throughCreated?: number): Promise<void>;
  beginSupportSession(email: string, password: string): Promise<SupportAgent>;
  readSupportSession(): Promise<SupportAgent | null>;
  endSupportSession(session: string): Promise<void>;
  sendAgentMessage(session: string, conversationId: string, text: string, image?: SupportImage): Promise<SupportConversation>;
  markAgentRead(session: string, conversationId: string, throughCreated?: number): Promise<void>;
  setConversationStatus(session: string, conversationId: string, status: "open" | "resolved"): Promise<void>;
  readUserTyping(session: string): Promise<boolean>;
  setUserTyping(session: string, typing: boolean, sourceId: string): Promise<void>;
  readAgentTyping(session: string, conversationId: string): Promise<boolean>;
  setAgentTyping(session: string, conversationId: string, typing: boolean, sourceId: string): Promise<void>;
  readSupportAvailability(session: string): Promise<boolean>;
  setAgentAvailability(session: string, online: boolean, sourceId: string): Promise<void>;
}

const service: SupportService = supportHttp;
export const readCustomerSession = supportHttp.readCustomerSession;
export const openSupportEvents = supportHttp.openSupportEvents;
export { SESSION_CHANNEL } from "./support-http";
export type { CustomerSupportSession } from "./support-http";
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
export const readUserTyping: SupportService["readUserTyping"] = (...args) => service.readUserTyping(...args);
export const setUserTyping: SupportService["setUserTyping"] = (...args) => service.setUserTyping(...args);
export const readAgentTyping: SupportService["readAgentTyping"] = (...args) => service.readAgentTyping(...args);
export const setAgentTyping: SupportService["setAgentTyping"] = (...args) => service.setAgentTyping(...args);
export const readSupportAvailability: SupportService["readSupportAvailability"] = (...args) => service.readSupportAvailability(...args);
export const setAgentAvailability: SupportService["setAgentAvailability"] = (...args) => service.setAgentAvailability(...args);
