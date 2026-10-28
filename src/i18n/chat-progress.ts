const copy = {
  en: { pending: "Waiting for the service", running: "Generating a reply", unknown: "Result awaiting confirmation", completed: "Reply saved", failed: "Request did not complete", elapsed: "Waited", latest: "Latest messages" },
  zh: { pending: "正在等待服务响应", running: "正在生成回复", unknown: "结果待确认", completed: "回复已保存", failed: "请求未完成", elapsed: "已等待", latest: "回到最新消息" },
  "zh-hant": { pending: "正在等待服務回應", running: "正在產生回覆", unknown: "結果待確認", completed: "回覆已儲存", failed: "請求未完成", elapsed: "已等待", latest: "回到最新訊息" },
  ja: { pending: "サービスの応答を待っています", running: "返信を生成しています", unknown: "結果の確認が必要です", completed: "返信を保存しました", failed: "リクエストは完了しませんでした", elapsed: "待機時間", latest: "最新のメッセージ" },
  ko: { pending: "서비스 응답을 기다리는 중", running: "답변 생성 중", unknown: "결과 확인 대기 중", completed: "답변 저장됨", failed: "요청이 완료되지 않았습니다", elapsed: "대기 시간", latest: "최신 메시지로" },
  es: { pending: "Esperando al servicio", running: "Generando una respuesta", unknown: "Resultado pendiente de confirmación", completed: "Respuesta guardada", failed: "La solicitud no se completó", elapsed: "Tiempo de espera", latest: "Últimos mensajes" },
};
const detail = {
  en: { working: "This request is still in progress. You can draft the next message or check this request.", uncertain: "This outcome is unconfirmed and may have run and been charged. Check its result; it will not be sent again.", failedDetail: "This request did not complete. Server history is authoritative; it will not be retried automatically.", check: "Check this request", checking: "Checking…" },
  zh: { working: "本次请求尚未完成。你可以先写下一条消息，或查看本次结果。", uncertain: "本次结果尚未确认，可能已执行并计费。可查看结果，不会重复发送。", failedDetail: "本次请求未完成。消息和结果以服务器记录为准，不会自动重试。", check: "查看本次结果", checking: "正在核对…" },
  "zh-hant": { working: "本次請求尚未完成。你可以先寫下一則訊息，或查看本次結果。", uncertain: "本次結果尚未確認，可能已執行並計費。可查看結果，不會重複傳送。", failedDetail: "本次請求未完成。訊息和結果以伺服器紀錄為準，不會自動重試。", check: "查看本次結果", checking: "正在核對…" },
  ja: { working: "このリクエストは処理中です。次のメッセージの下書きや結果の確認ができます。", uncertain: "結果は未確認で、実行・課金済みの可能性があります。結果を確認できます。再送信はしません。", failedDetail: "リクエストは完了しませんでした。サーバーの履歴が正式な記録です。自動で再試行しません。", check: "結果を確認", checking: "確認中…" },
  ko: { working: "요청이 아직 진행 중입니다. 다음 메시지를 작성하거나 결과를 확인할 수 있습니다.", uncertain: "결과가 확인되지 않았으며 이미 실행되고 요금이 청구되었을 수 있습니다. 결과를 확인하세요. 다시 전송하지 않습니다.", failedDetail: "요청이 완료되지 않았습니다. 서버 기록을 기준으로 하며 자동으로 재시도하지 않습니다.", check: "결과 확인", checking: "확인 중…" },
  es: { working: "La solicitud sigue en curso. Puedes redactar el siguiente mensaje o consultar el resultado.", uncertain: "El resultado no está confirmado y la solicitud puede haberse ejecutado y cobrado. Consulta el resultado; no se enviará de nuevo.", failedDetail: "La solicitud no se completó. El historial del servidor es el registro definitivo; no se reintentará automáticamente.", check: "Consultar resultado", checking: "Consultando…" },
};
export function chatProgressWords(language: string) {
  const code = language.toLowerCase();
  const key = code.startsWith("zh-hant") || code.startsWith("zh-tw") ? "zh-hant" : code.startsWith("zh") ? "zh" : code.startsWith("ja") ? "ja" : code.startsWith("ko") ? "ko" : code.startsWith("es") ? "es" : "en";
  return { ...copy[key], ...detail[key] };
}

export function chatElapsed(startedAt: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
