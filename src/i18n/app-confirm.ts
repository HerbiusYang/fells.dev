const translations = {
  en: { title: "Confirm this action", cancel: "Cancel", confirm: "Confirm", deleteChat: "Delete this conversation?", discard: "Close without copying", rebate: "Transfer payable rebates to your CNY cash wallet?", import: "Upload and save {n} conversations to this workspace?", secretNotice: "Copy this key before leaving. Refreshing or closing this tab will remove the only displayed copy." },
  "zh-CN": { title: "确认操作", cancel: "取消", confirm: "确认", deleteChat: "确认删除这条对话？", discard: "未复制，仍然关闭", rebate: "确认把可支付返佣转入人民币现金钱包？", import: "确认把 {n} 条对话历史上传并保存到当前工作区？", secretNotice: "请先复制密钥再离开。刷新或关闭标签页后，将无法再次查看完整密钥。" },
  "zh-TW": { title: "確認操作", cancel: "取消", confirm: "確認", deleteChat: "確認刪除此對話？", discard: "未複製，仍然關閉", rebate: "確認將可支付返佣轉入人民幣現金錢包？", import: "確認將 {n} 筆對話記錄上傳並儲存至目前工作區？", secretNotice: "請先複製金鑰再離開。重新整理或關閉分頁後，將無法再次查看完整金鑰。" },
  ja: { title: "操作の確認", cancel: "キャンセル", confirm: "確認", deleteChat: "この会話を削除しますか？", discard: "コピーせずに閉じる", rebate: "支払可能な紹介報酬を CNY 現金ウォレットへ移しますか？", import: "{n} 件の会話をこのワークスペースにアップロードして保存しますか？", secretNotice: "移動する前にキーをコピーしてください。再読み込みやタブを閉じると、完全なキーを再表示できません。" },
  ko: { title: "작업 확인", cancel: "취소", confirm: "확인", deleteChat: "이 대화를 삭제할까요?", discard: "복사하지 않고 닫기", rebate: "지급 가능한 추천 보상을 CNY 현금 지갑으로 옮길까요?", import: "대화 {n}개를 이 워크스페이스에 업로드하고 저장할까요?", secretNotice: "이동하기 전에 키를 복사하세요. 새로 고침하거나 탭을 닫으면 전체 키를 다시 볼 수 없습니다." },
  es: { title: "Confirmar acción", cancel: "Cancelar", confirm: "Confirmar", deleteChat: "¿Eliminar esta conversación?", discard: "Cerrar sin copiar", rebate: "¿Transferir las comisiones disponibles a tu cartera de efectivo en CNY?", import: "¿Subir y guardar {n} conversaciones en este espacio de trabajo?", secretNotice: "Copia esta clave antes de salir. Al actualizar o cerrar esta pestaña, no podrás volver a ver la clave completa." },
};

export function appConfirmWords(language: string) {
  const locale = language === "zh" ? "zh-CN" : language === "zh-hant" ? "zh-TW" : language;
  const deletion = {
    en: { deletingChat: "Deleting…", deleteFailed: "The conversation could not be deleted.", deleteUnconfirmed: "Deletion is unconfirmed. Check this conversation before trying again." },
    "zh-CN": { deletingChat: "正在删除…", deleteFailed: "未能删除这条对话。", deleteUnconfirmed: "删除结果尚未确认，请核对这条对话后再试。" },
    "zh-TW": { deletingChat: "正在刪除…", deleteFailed: "未能刪除此對話。", deleteUnconfirmed: "刪除結果尚未確認，請先核對此對話再試。" },
    ja: { deletingChat: "削除中…", deleteFailed: "会話を削除できませんでした。", deleteUnconfirmed: "削除結果を確認できません。再試行する前にこの会話を確認してください。" },
    ko: { deletingChat: "삭제 중…", deleteFailed: "대화를 삭제하지 못했습니다.", deleteUnconfirmed: "삭제 결과가 확인되지 않았습니다. 다시 시도하기 전에 이 대화를 확인하세요." },
    es: { deletingChat: "Eliminando…", deleteFailed: "No se pudo eliminar la conversación.", deleteUnconfirmed: "No se ha confirmado la eliminación. Revisa esta conversación antes de reintentarlo." },
  };
  const clear = {
    en: { clearChats: "Clear all chats", clearConfirm: 'Permanently delete all {n} conversations in “{workspace}”? This also removes their saved messages and attachments for everyone in this workspace. This cannot be undone.', clearingChats: "Clearing chats…", clearFailed: "Chats could not be cleared. Refresh the list and try again.", clearUnconfirmed: "Deletion is not yet confirmed. Refresh the chat list before trying again.", clearBusy: "Wait for the current replies to finish before clearing chats.", clearRefresh: "Refresh chats" },
    "zh-CN": { clearChats: "清空全部对话", clearConfirm: '确认永久删除「{workspace}」工作区的全部 {n} 条对话？保存的消息和附件也会删除，此工作区的所有成员将无法再查看，且无法恢复。', clearingChats: "正在清空对话…", clearFailed: "未能清空对话，请刷新列表后重试。", clearUnconfirmed: "删除结果尚未确认，请先刷新对话列表再试。", clearBusy: "请等待正在生成的回复完成后再清空对话。", clearRefresh: "刷新对话列表" },
    "zh-TW": { clearChats: "清空全部對話", clearConfirm: '確定永久刪除「{workspace}」工作區的全部 {n} 筆對話？儲存的訊息和附件也會刪除，此工作區的所有成員將無法再查看，且無法復原。', clearingChats: "正在清空對話…", clearFailed: "未能清空對話，請重新整理清單後再試。", clearUnconfirmed: "刪除結果尚未確認，請先重新整理對話清單再試。", clearBusy: "請等待正在產生的回覆完成後再清空對話。", clearRefresh: "重新整理對話" },
    ja: { clearChats: "すべての会話を削除", clearConfirm: '「{workspace}」の会話 {n} 件をすべて完全に削除しますか？保存されたメッセージと添付ファイルも削除され、このワークスペースの全員が閲覧できなくなります。元に戻すことはできません。', clearingChats: "会話を削除中…", clearFailed: "会話を削除できませんでした。一覧を更新して再試行してください。", clearUnconfirmed: "削除結果はまだ確認できません。再試行する前に会話一覧を更新してください。", clearBusy: "進行中の返信が完了してから会話を削除してください。", clearRefresh: "会話を更新" },
    ko: { clearChats: "모든 대화 삭제", clearConfirm: '“{workspace}”의 대화 {n}개를 모두 영구 삭제할까요? 저장된 메시지와 첨부 파일도 삭제되어 이 작업 공간의 모든 구성원이 볼 수 없게 됩니다. 되돌릴 수 없습니다.', clearingChats: "대화 삭제 중…", clearFailed: "대화를 삭제하지 못했습니다. 목록을 새로 고친 후 다시 시도하세요.", clearUnconfirmed: "삭제 결과가 아직 확인되지 않았습니다. 다시 시도하기 전에 대화 목록을 새로 고치세요.", clearBusy: "진행 중인 응답이 끝난 후 대화를 삭제하세요.", clearRefresh: "대화 새로 고침" },
    es: { clearChats: "Eliminar todos los chats", clearConfirm: '¿Eliminar permanentemente las {n} conversaciones de «{workspace}»? También se eliminarán sus mensajes y archivos adjuntos guardados para todos los miembros de este espacio. No se puede deshacer.', clearingChats: "Eliminando chats…", clearFailed: "No se pudieron eliminar los chats. Actualiza la lista e inténtalo de nuevo.", clearUnconfirmed: "La eliminación aún no está confirmada. Actualiza la lista antes de reintentarlo.", clearBusy: "Espera a que terminen las respuestas en curso antes de eliminar los chats.", clearRefresh: "Actualizar chats" },
  };
  const limits = {
    en: { clearRateLimited: "Too many requests. Try again later, or delete conversations individually.", clearHistoryLimit: "Bulk deletion is unavailable for this workspace. You can still delete conversations individually." },
    "zh-CN": { clearRateLimited: "操作较频繁，请稍后再试；也可逐条删除对话。", clearHistoryLimit: "此工作区暂不支持继续批量清空，你仍可逐条删除对话。" },
    "zh-TW": { clearRateLimited: "操作過於頻繁，請稍後再試；也可逐筆刪除對話。", clearHistoryLimit: "此工作區無法繼續批次清空，你仍可逐筆刪除對話。" },
    ja: { clearRateLimited: "操作が多すぎます。しばらくしてから再試行するか、会話を個別に削除してください。", clearHistoryLimit: "このワークスペースでは一括削除を利用できません。会話を個別に削除できます。" },
    ko: { clearRateLimited: "요청이 너무 많습니다. 나중에 다시 시도하거나 대화를 개별적으로 삭제하세요.", clearHistoryLimit: "이 작업 공간에서는 일괄 삭제를 사용할 수 없습니다. 대화를 개별적으로 삭제할 수 있습니다." },
    es: { clearRateLimited: "Demasiadas solicitudes. Inténtalo más tarde o elimina las conversaciones una por una.", clearHistoryLimit: "La eliminación en bloque no está disponible en este espacio. Puedes eliminar las conversaciones una por una." },
  };
  return { ...(translations[locale as keyof typeof translations] ?? translations.en), ...(deletion[locale as keyof typeof deletion] ?? deletion.en), ...(clear[locale as keyof typeof clear] ?? clear.en), ...(limits[locale as keyof typeof limits] ?? limits.en) };
}
