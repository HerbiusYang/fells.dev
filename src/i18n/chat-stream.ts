const words = {
  en: { queued: "Waiting for a reply…", connecting: "Connecting…", generating: "Receiving reply…", searching: "Searching the web…", finalizing: "Finishing reply…", stopping: "Waiting for the final result…", reconnecting: "Reconnecting to this reply…", fallback: "Live updates interrupted. Checking the saved result…", uncertain: "This partial reply is unconfirmed. Check this request; it will not be sent again." },
  zh: { queued: "正在等待回复…", connecting: "正在连接…", generating: "正在接收回复…", searching: "正在搜索网页…", finalizing: "正在完成回复…", stopping: "正在等待最终结果…", reconnecting: "正在重新连接本次回复…", fallback: "实时连接已中断，正在核对已保存的结果…", uncertain: "这段回复尚未确认。请核对本次请求，不会重复发送。" },
  "zh-hant": { queued: "正在等待回覆…", connecting: "正在連線…", generating: "正在接收回覆…", searching: "正在搜尋網頁…", finalizing: "正在完成回覆…", stopping: "正在等待最終結果…", reconnecting: "正在重新連線本次回覆…", fallback: "即時連線已中斷，正在核對已儲存的結果…", uncertain: "此段回覆尚未確認。請核對本次請求，不會重複傳送。" },
  ja: { queued: "返信を待っています…", connecting: "接続中…", generating: "返信を受信中…", searching: "ウェブを検索中…", finalizing: "返信を仕上げています…", stopping: "最終結果を待っています…", reconnecting: "この返信に再接続中…", fallback: "接続が途切れました。保存済みの結果を確認中…", uncertain: "この途中の返信は未確認です。リクエストの結果を確認してください。再送信はしません。" },
  ko: { queued: "답변을 기다리는 중…", connecting: "연결 중…", generating: "답변 수신 중…", searching: "웹 검색 중…", finalizing: "답변 마무리 중…", stopping: "최종 결과를 기다리는 중…", reconnecting: "이 답변에 다시 연결 중…", fallback: "실시간 연결이 끊겼습니다. 저장된 결과를 확인하는 중…", uncertain: "이 답변의 일부는 아직 확인되지 않았습니다. 요청 결과를 확인하세요. 다시 전송하지 않습니다." },
  es: { queued: "Esperando respuesta…", connecting: "Conectando…", generating: "Recibiendo respuesta…", searching: "Buscando en la web…", finalizing: "Finalizando respuesta…", stopping: "Esperando el resultado final…", reconnecting: "Reconectando a esta respuesta…", fallback: "Se interrumpió la conexión. Consultando el resultado guardado…", uncertain: "Esta respuesta parcial no está confirmada. Consulta esta solicitud; no se enviará de nuevo." },
};
export function chatStreamWords(language: string) {
  const value = language.toLowerCase();
  const key = value.startsWith("zh-hant") || value.startsWith("zh-tw") ? "zh-hant" : value.startsWith("zh") ? "zh" : value.startsWith("ja") ? "ja" : value.startsWith("ko") ? "ko" : value.startsWith("es") ? "es" : "en";
  return words[key];
}
