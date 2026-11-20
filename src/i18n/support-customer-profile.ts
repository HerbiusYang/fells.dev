import { accountLanguage } from "./api-errors.ts";

const rows: Record<string, [string, string, string, string, string, string, string]> = {
  en: ["Edit customer profile", "Display name", "Internal support note", "Save changes", "Customer profile saved.", "This profile changed. Load the latest saved values before editing again.", "Load latest profile"],
  "zh": ["编辑客户资料", "客户昵称", "客服内部备注", "保存修改", "客户资料已保存。", "客户资料已更改。请载入最新保存的资料后再修改。", "载入最新资料"],
  "zh-hant": ["編輯客戶資料", "客戶暱稱", "客服內部備註", "儲存變更", "客戶資料已儲存。", "客戶資料已變更。請載入最新儲存的資料後再修改。", "載入最新資料"],
  ja: ["顧客情報を編集", "表示名", "サポート用の内部メモ", "変更を保存", "顧客情報を保存しました。", "顧客情報が更新されました。最新の内容を読み込んでから編集してください。", "最新の情報を読み込む"],
  ko: ["고객 정보 수정", "표시 이름", "상담원 내부 메모", "변경 사항 저장", "고객 정보를 저장했습니다.", "고객 정보가 변경되었습니다. 최신 정보를 불러온 후 다시 수정하세요.", "최신 정보 불러오기"],
  es: ["Editar los datos del cliente", "Nombre visible", "Nota interna de soporte", "Guardar cambios", "Datos del cliente guardados.", "Los datos han cambiado. Carga la última versión guardada antes de volver a editarlos.", "Cargar los datos actuales"],
};

export function supportCustomerProfileCopy(lang: string) {
  const locale = accountLanguage(lang);
  const [title, name, note, save, saved, conflict, reload] = rows[locale] ?? rows.en;
  const limits: Record<string, string> = {
    en: "Enter no more than 200 characters.", "zh": "最多输入 200 个字符。", "zh-hant": "最多輸入 200 個字元。",
    ja: "200文字以内で入力してください。", ko: "200자 이내로 입력하세요.", es: "Introduce como máximo 200 caracteres.",
  };
  return { title, name, note, save, saved, conflict, reload, limit: limits[locale] ?? limits.en };
}
