const en = { invalidLimit: "Enter 0 or a positive USD amount with at most 6 decimal places. Leave blank to use the default limit.", revoke: "Revoke this API key? Connected tools will stop working. This cannot be undone.", closeSecret: "You have not copied this key. Close anyway? The complete key cannot be shown again.", restricted: "API key creation is restricted for this account. Contact support to check access.", name: "Name", prefix: "Key prefix", base: "API Base URL" };
type Words = { [K in keyof typeof en]: string };
const words: Record<string, Words> = {
  en,
  zh: { invalidLimit: "请输入 0 或最多 6 位小数的正数美元金额；留空使用默认限额。", revoke: "确认撤销这把 API Key？使用它的工具将无法继续访问，撤销后无法恢复。", closeSecret: "这把密钥尚未复制，仍要关闭吗？关闭后无法再次查看完整密钥。", restricted: "当前账户限制创建 API Key，请联系客服确认访问权限。", name: "名称", prefix: "密钥前缀", base: "API 接口地址" },
  "zh-hant": { invalidLimit: "請輸入 0 或最多 6 位小數的正數美元金額；留空使用預設上限。", revoke: "確認撤銷這把 API Key？使用它的工具將無法繼續存取，撤銷後無法恢復。", closeSecret: "這把金鑰尚未複製，仍要關閉嗎？關閉後無法再次查看完整金鑰。", restricted: "目前帳戶限制建立 API Key，請聯絡客服確認存取權限。", name: "名稱", prefix: "金鑰前綴", base: "API 介面位址" },
  ja: { invalidLimit: "0 または小数点以下 6 桁までの正の USD 金額を入力してください。空欄は既定上限を使用します。", revoke: "この API キーを取り消しますか？接続中のツールは利用できなくなります。元に戻せません。", closeSecret: "キーはまだコピーされていません。閉じますか？完全なキーは再表示できません。", restricted: "このアカウントでは API キーの作成が制限されています。サポートで権限を確認してください。", name: "名前", prefix: "キーの接頭辞", base: "API Base URL" },
  ko: { invalidLimit: "0 또는 소수점 이하 6자리까지의 양수 USD 금액을 입력하세요. 비워 두면 기본 한도를 사용합니다.", revoke: "이 API 키를 폐기할까요? 연결된 도구가 작동하지 않으며 되돌릴 수 없습니다.", closeSecret: "아직 키를 복사하지 않았습니다. 닫을까요? 전체 키는 다시 볼 수 없습니다.", restricted: "이 계정은 API 키 생성이 제한되어 있습니다. 고객 지원에 권한을 문의하세요.", name: "이름", prefix: "키 접두사", base: "API Base URL" },
  es: { invalidLimit: "Introduce 0 o un importe USD positivo con hasta 6 decimales. Déjalo vacío para usar el límite predeterminado.", revoke: "¿Revocar esta clave API? Las herramientas conectadas dejarán de funcionar. No se puede deshacer.", closeSecret: "Aún no has copiado esta clave. ¿Cerrar igualmente? No podrás volver a ver la clave completa.", restricted: "La creación de claves API está restringida en esta cuenta. Consulta los permisos con soporte.", name: "Nombre", prefix: "Prefijo de la clave", base: "URL base de API" },
};
export function keyUXWords(language: string): Words {
  const locale = language.toLowerCase();
  return words[locale === "zh-cn" ? "zh" : locale === "zh-tw" ? "zh-hant" : locale] ?? en;
}
