import { supportCopy, type SupportCopy } from "../i18n/support.ts";

type NetworkFields = Pick<SupportCopy, "demo" | "demoNotice" | "loginNotice" | "enter" | "logout" | "emptyInboxBody" | "credits" | "previewUser" | "deskHint" | "privacy" | "sessionEnded" | "unavailable" | "frameBlocked" | "storageFull"> & { account: string; password: string; signInRequired: string; signIn: string; accessNotice: string; returnConsole: string; collapse: string; endConsultation: string; endingConsultation: string; consultationEnded: string; endConflict: string };
export type SupportNetworkCopy = SupportCopy & NetworkFields;
const en: NetworkFields = {
  collapse: "Minimize support", endConsultation: "End conversation", endingConsultation: "Ending…", consultationEnded: "Conversation ended. Send a message to continue.", endConflict: "A new reply arrived. Read it before ending the conversation.",
  accessNotice: "Open support from the management console after signing in through Cloudflare Access.", returnConsole: "Back to management console",
  demo: "Online support", demoNotice: "Your conversation is saved to your Fells account.", loginNotice: "Sign in with your support account and password.", enter: "Sign in to support", logout: "Sign out", emptyInboxBody: "Messages sent by customers appear here.", credits: "API allowance (USD)", previewUser: "Customer", deskHint: "Customer conversations and replies sync in real time.", privacy: "Customer information is available to authorized support staff.", sessionEnded: "Your session ended. Please sign in again.", unavailable: "Could not connect to support. Please try again.", frameBlocked: "Open this page directly to use support.", storageFull: "Could not save this attachment. Your draft is still here.", account: "Support account", password: "Password", signInRequired: "Sign in to your Fells account to contact support.", signIn: "Sign in",
};
const zh: NetworkFields = {
  collapse: "收起客服窗口", endConsultation: "结束咨询", endingConsultation: "正在结束…", consultationEnded: "本次咨询已结束，发送消息可继续沟通。", endConflict: "收到新回复，请阅读后再结束咨询。",
  accessNotice: "请从管理后台进入客服，使用 Cloudflare Access 登录。", returnConsole: "返回管理后台",
  demo: "在线客服", demoNotice: "会话将保存到你的 Fells 账号。", loginNotice: "使用客服账号和密码登录。", enter: "登录客服工作台", logout: "退出登录", emptyInboxBody: "用户发送的消息会显示在这里。", credits: "API 美元额度", previewUser: "用户", deskHint: "用户会话和回复实时同步。", privacy: "用户资料仅向有权限的客服人员开放。", sessionEnded: "登录已失效，请重新登录。", unavailable: "无法连接客服服务，请重试。", frameBlocked: "请直接打开此页面使用在线客服。", storageFull: "附件保存失败，草稿已保留。", account: "客服账号", password: "密码", signInRequired: "请登录 Fells 账号后联系在线客服。", signIn: "登录账号",
};
const zhHant: NetworkFields = {
  collapse: "收起客服視窗", endConsultation: "結束諮詢", endingConsultation: "正在結束…", consultationEnded: "本次諮詢已結束，傳送訊息可繼續溝通。", endConflict: "收到新回覆，請閱讀後再結束諮詢。",
  accessNotice: "請從管理後台進入客服，使用 Cloudflare Access 登入。", returnConsole: "返回管理後台",
  demo: "線上客服", demoNotice: "會話將儲存到你的 Fells 帳號。", loginNotice: "使用客服帳號和密碼登入。", enter: "登入客服工作台", logout: "登出", emptyInboxBody: "使用者傳送的訊息會顯示在這裡。", credits: "API 美元額度", previewUser: "使用者", deskHint: "使用者會話和回覆即時同步。", privacy: "使用者資料僅向有權限的客服人員開放。", sessionEnded: "登入已失效，請重新登入。", unavailable: "無法連線客服服務，請重試。", frameBlocked: "請直接開啟此頁面使用線上客服。", storageFull: "附件儲存失敗，草稿已保留。", account: "客服帳號", password: "密碼", signInRequired: "請登入 Fells 帳號後聯絡線上客服。", signIn: "登入帳號",
};
const ja: NetworkFields = {
  collapse: "サポートを最小化", endConsultation: "会話を終了", endingConsultation: "終了中…", consultationEnded: "会話が終了しました。メッセージを送ると再開できます。", endConflict: "新しい返信が届きました。内容を確認してから会話を終了してください。",
  accessNotice: "Cloudflare Access でログインし、管理画面からサポートを開いてください。", returnConsole: "管理画面に戻る",
  demo: "オンラインサポート", demoNotice: "会話は Fells アカウントに保存されます。", loginNotice: "サポートアカウントとパスワードでログインしてください。", enter: "サポートにログイン", logout: "ログアウト", emptyInboxBody: "お客様からのメッセージがここに表示されます。", credits: "API 残高（USD）", previewUser: "お客様", deskHint: "会話と返信はリアルタイムで同期されます。", privacy: "お客様の情報は権限のある担当者のみ閲覧できます。", sessionEnded: "セッションが終了しました。再度ログインしてください。", unavailable: "サポートに接続できません。再試行してください。", frameBlocked: "このページを直接開いてサポートをご利用ください。", storageFull: "添付を保存できませんでした。下書きは残っています。", account: "サポートアカウント", password: "パスワード", signInRequired: "サポートを利用するには Fells にログインしてください。", signIn: "ログイン",
};
const ko: NetworkFields = {
  collapse: "고객 지원 최소화", endConsultation: "상담 종료", endingConsultation: "종료 중…", consultationEnded: "상담이 종료되었습니다. 메시지를 보내면 다시 대화할 수 있습니다.", endConflict: "새 답장이 도착했습니다. 읽은 후 상담을 종료하세요.",
  accessNotice: "Cloudflare Access로 로그인한 후 관리 콘솔에서 고객 지원을 여세요.", returnConsole: "관리 콘솔로 돌아가기",
  demo: "온라인 고객 지원", demoNotice: "대화는 Fells 계정에 저장됩니다.", loginNotice: "상담원 계정과 비밀번호로 로그인하세요.", enter: "상담 데스크 로그인", logout: "로그아웃", emptyInboxBody: "고객이 보낸 메시지가 여기에 표시됩니다.", credits: "API 잔액 (USD)", previewUser: "고객", deskHint: "대화와 답장이 실시간으로 동기화됩니다.", privacy: "고객 정보는 권한이 있는 상담원만 볼 수 있습니다.", sessionEnded: "세션이 종료되었습니다. 다시 로그인하세요.", unavailable: "고객 지원에 연결할 수 없습니다. 다시 시도하세요.", frameBlocked: "이 페이지를 직접 열어 고객 지원을 이용하세요.", storageFull: "첨부 파일을 저장하지 못했습니다. 초안은 유지됩니다.", account: "상담원 계정", password: "비밀번호", signInRequired: "고객 지원을 이용하려면 Fells 계정에 로그인하세요.", signIn: "로그인",
};
const es: NetworkFields = {
  collapse: "Minimizar soporte", endConsultation: "Finalizar conversación", endingConsultation: "Finalizando…", consultationEnded: "Conversación finalizada. Envía un mensaje para continuar.", endConflict: "Ha llegado una respuesta. Léela antes de finalizar la conversación.",
  accessNotice: "Accede con Cloudflare Access y abre soporte desde la consola de administración.", returnConsole: "Volver a administración",
  demo: "Atención al cliente", demoNotice: "La conversación se guarda en tu cuenta de Fells.", loginNotice: "Accede con tu cuenta de soporte y contraseña.", enter: "Acceder al soporte", logout: "Cerrar sesión", emptyInboxBody: "Los mensajes de los clientes aparecerán aquí.", credits: "Saldo API (USD)", previewUser: "Cliente", deskHint: "Las conversaciones y respuestas se sincronizan en tiempo real.", privacy: "Los datos del cliente están disponibles para el personal autorizado.", sessionEnded: "La sesión ha terminado. Vuelve a iniciar sesión.", unavailable: "No se pudo conectar al soporte. Vuelve a intentarlo.", frameBlocked: "Abre esta página directamente para usar el soporte.", storageFull: "No se pudo guardar el adjunto. Tu borrador sigue aquí.", account: "Cuenta de soporte", password: "Contraseña", signInRequired: "Inicia sesión en Fells para contactar con soporte.", signIn: "Iniciar sesión",
};
export function liveSupportCopy(lang: string): SupportNetworkCopy {
  const copy = lang === "zh" || lang === "zh-CN" ? zh : lang === "zh-hant" || lang === "zh-TW" ? zhHant : lang === "ja" ? ja : lang === "ko" ? ko : lang === "es" ? es : en;
  return { ...supportCopy(lang), ...copy };
}
