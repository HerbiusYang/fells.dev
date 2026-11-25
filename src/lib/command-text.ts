// Catalogue model IDs reach copied shell, PowerShell, JSON, TOML and Python
// examples. Only printable ASCII that needs no quoting decisions is placed in a
// runnable snippet; any other ID keeps its catalogue entry but gets a notice.
const COMMAND_MODEL_ID = /^[A-Za-z0-9._:/@-]{1,200}$/;

// Terminal controls (C0 except tab/newline, DEL, C1 such as U+009B CSI), Unicode
// line separators and bidirectional formatting characters can make pasted text
// differ from what the page displays.
const UNSAFE_COMMAND_TEXT = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/;

export const commandModelId = (value: unknown): value is string => typeof value === "string" && COMMAND_MODEL_ID.test(value);

export const commandTextSafe = (text: string): boolean => !UNSAFE_COMMAND_TEXT.test(text);
