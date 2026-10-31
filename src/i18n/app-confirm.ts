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
  return { ...(translations[locale as keyof typeof translations] ?? translations.en), ...(deletion[locale as keyof typeof deletion] ?? deletion.en) };
}
