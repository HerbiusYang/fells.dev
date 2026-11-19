// Public loading copy only: never put cached identity or account data in HTML.
const words = {
  en: { loading: "Loading your workspace…", hint: "Your account is being securely loaded.", error: "Unable to load your workspace", reload: "Reload page", entry: "Return to sign in", jsRequired: "Enable JavaScript to open your workspace." },
  "zh-CN": { loading: "正在加载工作区…", hint: "正在安全地读取账户信息。", error: "暂时无法加载工作区", reload: "重新加载页面", entry: "返回登录", jsRequired: "请启用 JavaScript 后打开工作区。" },
  "zh-TW": { loading: "正在載入工作區…", hint: "正在安全地讀取帳戶資訊。", error: "暫時無法載入工作區", reload: "重新載入頁面", entry: "返回登入", jsRequired: "請啟用 JavaScript 後開啟工作區。" },
  ja: { loading: "ワークスペースを読み込んでいます…", hint: "アカウント情報を安全に読み込んでいます。", error: "ワークスペースを読み込めません", reload: "ページを再読み込み", entry: "ログインに戻る", jsRequired: "ワークスペースを開くには JavaScript を有効にしてください。" },
  ko: { loading: "워크스페이스를 불러오는 중…", hint: "계정 정보를 안전하게 불러오고 있습니다.", error: "워크스페이스를 불러올 수 없습니다", reload: "페이지 새로 고침", entry: "로그인으로 돌아가기", jsRequired: "워크스페이스를 열려면 JavaScript를 활성화하세요." },
  es: { loading: "Cargando tu espacio de trabajo…", hint: "Se está cargando tu cuenta de forma segura.", error: "No se pudo cargar tu espacio de trabajo", reload: "Recargar página", entry: "Volver a iniciar sesión", jsRequired: "Activa JavaScript para abrir tu espacio de trabajo." },
};

const timeout = {
  en: "Loading took too long. Reload the page to try again.",
  "zh-CN": "加载时间过长，请重新加载页面后重试。",
  "zh-TW": "載入時間過長，請重新載入頁面後再試。",
  ja: "読み込みがタイムアウトしました。ページを再読み込みしてください。",
  ko: "불러오는 데 시간이 너무 오래 걸립니다. 페이지를 새로 고쳐 다시 시도하세요.",
  es: "La carga tardó demasiado. Recarga la página para volver a intentarlo.",
};

const sessionChanged = {
  en: "Your sign-in state has changed. Please sign in again.",
  "zh-CN": "登录状态已改变，请重新登录。",
  "zh-TW": "登入狀態已改變，請重新登入。",
  ja: "ログイン状態が変わりました。もう一度ログインしてください。",
  ko: "로그인 상태가 변경되었습니다. 다시 로그인해 주세요.",
  es: "Tu sesión ha cambiado. Vuelve a iniciar sesión.",
};
const locked = {
  en: "This browser is locked. Server sign-out is pending. Reconnect and retry if needed.",
  "zh-CN": "本机已锁定，服务器尚未确认退出。恢复连接后可重试。",
  "zh-TW": "本機已鎖定，伺服器尚未確認登出。恢復連線後可重試。",
  ja: "このブラウザーはロックされました。サーバーのログアウト確認を待っています。接続が戻ったら再試行できます。",
  ko: "이 브라우저가 잠겼습니다. 서버 로그아웃 확인을 기다리는 중입니다. 연결이 복구되면 다시 시도할 수 있습니다.",
  es: "Este navegador está bloqueado. Falta la confirmación del servidor. Puedes volver a intentarlo cuando se restablezca la conexión.",
};
const signedOut = {
  en: "You are signed out.", "zh-CN": "已安全退出账户。", "zh-TW": "已安全登出帳戶。",
  ja: "ログアウトしました。", ko: "로그아웃했습니다.", es: "Has cerrado la sesión.",
};
export const appStartupWords = (lang: string) => {
  const locale = Object.hasOwn(words, lang) ? lang as keyof typeof words : "en";
  return { ...words[locale], timeout: timeout[locale], sessionChanged: sessionChanged[locale], locked: locked[locale], signedOut: signedOut[locale] };
};
