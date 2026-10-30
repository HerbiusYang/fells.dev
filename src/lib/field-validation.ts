type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
type Locale = "en" | "zh" | "zh-hant" | "ja" | "ko" | "es";
type Words = Record<"required" | "checked" | "selected" | "email" | "url" | "pattern" | "short" | "long" | "under" | "over" | "step" | "number" | "invalid", string>;

const words: Record<Locale, Words> = {
  en: { required: "Fill in this field.", checked: "Select this checkbox to continue.", selected: "Choose an option.", email: "Enter a valid email address.", url: "Enter a valid URL.", pattern: "Use the required format shown for this field.", short: "Enter at least {n} characters.", long: "Enter no more than {n} characters.", under: "Enter a value of at least {n}.", over: "Enter a value no greater than {n}.", step: "Use an allowed increment for this field.", number: "Enter a valid number.", invalid: "Check this value before continuing." },
  zh: { required: "请填写此项。", checked: "请勾选此项后继续。", selected: "请选择一项。", email: "请输入有效的邮箱地址。", url: "请输入有效的网址。", pattern: "请按此字段提示的格式填写。", short: "请至少输入 {n} 个字符。", long: "请最多输入 {n} 个字符。", under: "请输入不小于 {n} 的值。", over: "请输入不大于 {n} 的值。", step: "请使用此字段允许的递增值。", number: "请输入有效的数字。", invalid: "请检查此项后继续。" },
  "zh-hant": { required: "請填寫此項。", checked: "請勾選此項後繼續。", selected: "請選擇一項。", email: "請輸入有效的電子郵件地址。", url: "請輸入有效的網址。", pattern: "請按照此欄位提示的格式填寫。", short: "請至少輸入 {n} 個字元。", long: "請最多輸入 {n} 個字元。", under: "請輸入不小於 {n} 的值。", over: "請輸入不大於 {n} 的值。", step: "請使用此欄位允許的遞增值。", number: "請輸入有效的數字。", invalid: "請檢查此項後繼續。" },
  ja: { required: "この項目を入力してください。", checked: "続けるにはこの項目を選択してください。", selected: "選択肢を選んでください。", email: "有効なメールアドレスを入力してください。", url: "有効なURLを入力してください。", pattern: "この項目に指定された形式で入力してください。", short: "{n}文字以上で入力してください。", long: "{n}文字以内で入力してください。", under: "{n}以上の値を入力してください。", over: "{n}以下の値を入力してください。", step: "この項目で許可されている刻み値を使用してください。", number: "有効な数値を入力してください。", invalid: "入力内容を確認してください。" },
  ko: { required: "이 항목을 입력해 주세요.", checked: "계속하려면 이 항목을 선택해 주세요.", selected: "옵션을 선택해 주세요.", email: "올바른 이메일 주소를 입력해 주세요.", url: "올바른 URL을 입력해 주세요.", pattern: "이 항목에 안내된 형식으로 입력해 주세요.", short: "{n}자 이상 입력해 주세요.", long: "{n}자 이하로 입력해 주세요.", under: "{n} 이상의 값을 입력해 주세요.", over: "{n} 이하의 값을 입력해 주세요.", step: "이 항목에서 허용하는 증분을 사용해 주세요.", number: "올바른 숫자를 입력해 주세요.", invalid: "입력한 값을 확인해 주세요." },
  es: { required: "Completa este campo.", checked: "Marca esta casilla para continuar.", selected: "Elige una opción.", email: "Introduce un correo electrónico válido.", url: "Introduce una URL válida.", pattern: "Usa el formato indicado para este campo.", short: "Introduce al menos {n} caracteres.", long: "Introduce un máximo de {n} caracteres.", under: "Introduce un valor mínimo de {n}.", over: "Introduce un valor máximo de {n}.", step: "Usa un incremento permitido para este campo.", number: "Introduce un número válido.", invalid: "Revisa este valor antes de continuar." },
};

const installed = new WeakSet<Document>();
const feedback = new WeakMap<Field, { message: HTMLElement; previousInvalid: string | null }>();
const pendingFocus = new Set<Field>();
let focusQueued = false;
let sequence = 0;

function field(value: EventTarget | Element | null): value is Field {
  return value instanceof HTMLInputElement || value instanceof HTMLSelectElement || value instanceof HTMLTextAreaElement;
}

function fields(target: HTMLFormElement | Field): Field[] {
  return target instanceof HTMLFormElement ? Array.from(target.elements).filter(field) : [target];
}

function copy(control: Field): Words {
  const lang = (control.closest("[lang]")?.getAttribute("lang") || control.ownerDocument.documentElement.lang || "en").toLowerCase();
  const locale: Locale = lang.startsWith("zh") ? /hant|tw|hk/.test(lang) ? "zh-hant" : "zh" : lang.startsWith("ja") ? "ja" : lang.startsWith("ko") ? "ko" : lang.startsWith("es") ? "es" : "en";
  return words[locale];
}

function message(control: Field): string {
  const v = control.validity, c = copy(control);
  if (v.badInput) return c.number;
  if (v.valueMissing) return control instanceof HTMLSelectElement ? c.selected : control instanceof HTMLInputElement && ["checkbox", "radio"].includes(control.type) ? c.checked : c.required;
  if (v.typeMismatch) return control instanceof HTMLInputElement && control.type === "email" ? c.email : c.url;
  if (v.patternMismatch) return c.pattern;
  if (v.tooShort) return c.short.replace("{n}", control.getAttribute("minlength") || "");
  if (v.tooLong) return c.long.replace("{n}", control.getAttribute("maxlength") || "");
  if (v.rangeUnderflow) return c.under.replace("{n}", control.getAttribute("min") || "");
  if (v.rangeOverflow) return c.over.replace("{n}", control.getAttribute("max") || "");
  if (v.stepMismatch) return c.step;
  return c.invalid;
}

function clear(control: Field): void {
  const current = feedback.get(control);
  if (!current) return;
  const described = (control.getAttribute("aria-describedby") || "").split(/\s+/).filter(id => id && id !== current.message.id);
  if (described.length) control.setAttribute("aria-describedby", described.join(" "));
  else control.removeAttribute("aria-describedby");
  if (current.previousInvalid === null) control.removeAttribute("aria-invalid");
  else control.setAttribute("aria-invalid", current.previousInvalid);
  control.removeAttribute("data-field-invalid");
  current.message.remove();
  feedback.delete(control);
}

function show(control: Field): void {
  if (!control.willValidate || control.validity.valid) { clear(control); return; }
  let current = feedback.get(control);
  if (!current) {
    const error = control.ownerDocument.createElement("span");
    do { error.id = `field-validation-${++sequence}`; } while (control.ownerDocument.getElementById(error.id));
    error.className = "field-validation-message";
    error.dataset.fieldError = "";
    error.setAttribute("role", "status");
    error.setAttribute("aria-live", "polite");
    const anchor = control.closest(".code-row") || (control instanceof HTMLInputElement && ["checkbox", "radio"].includes(control.type) ? control.closest("label") : null) || control;
    anchor.insertAdjacentElement("afterend", error);
    current = { message: error, previousInvalid: control.getAttribute("aria-invalid") };
    feedback.set(control, current);
    control.setAttribute("aria-describedby", [...(control.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean), error.id].join(" "));
  }
  current.message.textContent = message(control);
  control.setAttribute("aria-invalid", "true");
  control.dataset.fieldInvalid = "true";
}

function focusFirst(control: Field): void {
  pendingFocus.add(control);
  if (focusQueued) return;
  focusQueued = true;
  queueMicrotask(() => {
    focusQueued = false;
    const first = [...pendingFocus].find(item => item.isConnected && item.willValidate && !item.validity.valid && item.getClientRects().length > 0);
    pendingFocus.clear();
    first?.focus();
  });
}

/** Keep native constraint semantics; replace only the browser's validation UI. */
export function validateFields(target: HTMLFormElement | Field): boolean {
  installFieldValidation();
  const valid = target.checkValidity();
  for (const control of fields(target)) {
    if (!control.willValidate || control.validity.valid) clear(control);
    else { show(control); focusFirst(control); }
  }
  return valid;
}

/** A mode change clears only our presentation, never the field constraints. */
export function clearFieldValidation(target: HTMLFormElement | Field): void {
  fields(target).forEach(clear);
}

/** Capture also covers dynamically rendered forms and default HTML submission. */
export function installFieldValidation(): void {
  if (typeof document === "undefined" || installed.has(document)) return;
  installed.add(document);
  document.addEventListener("invalid", event => {
    if (!field(event.target)) return;
    event.preventDefault();
    show(event.target);
    focusFirst(event.target);
  }, true);
  document.addEventListener("submit", event => {
    const form = event.target;
    const submitter = (event as SubmitEvent).submitter;
    if (!(form instanceof HTMLFormElement) || form.noValidate || submitter instanceof HTMLButtonElement && submitter.formNoValidate || submitter instanceof HTMLInputElement && submitter.formNoValidate) return;
    if (!validateFields(form)) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  const update = (event: Event) => {
    if (!field(event.target) || !feedback.has(event.target)) return;
    show(event.target);
  };
  document.addEventListener("input", update, true);
  document.addEventListener("change", update, true);
  document.addEventListener("reset", event => {
    if (event.target instanceof HTMLFormElement) {
      const controls = fields(event.target);
      queueMicrotask(() => controls.forEach(clear));
    }
  }, true);
}
