export type SupportPresenceContext = { session: string; conversationId?: string };
type Options = {
  text: HTMLTextAreaElement;
  indicator: HTMLElement;
  getContext(): SupportPresenceContext | null;
  canType(): boolean;
  publish(context: SupportPresenceContext, typing: boolean, sourceId: string): Promise<void>;
  read(context: SupportPresenceContext): Promise<boolean>;
};

// Presence is a short lease, never a draft or a saved message. Reads and writes
// are independent from chat persistence so a failed hint cannot lose a draft.
export function installSupportPresence(options: Options) {
  const sourceId = crypto.randomUUID();
  const key = (context: SupportPresenceContext | null) => context ? `${context.session}:${context.conversationId ?? ""}` : "";
  let published: SupportPresenceContext | null = null;
  let lastSent = 0, visibleContext = "", generation = 0;
  let disposed = false, reading = false;
  let stopTimer: ReturnType<typeof setTimeout> | undefined;
  let sendTimer: ReturnType<typeof setTimeout> | undefined;
  let queue = Promise.resolve();
  let command = 0;
  const publish = (context: SupportPresenceContext, typing: boolean) => {
    const expected = ++command;
    queue = queue.then(() => {
      // A slow transport must not replay old heartbeats after the draft was
      // paused, closed or moved to another conversation. Keep only the latest.
      if (typing && (disposed || expected !== command || key(published) !== key(context) || document.activeElement !== options.text || !options.canType() || !options.text.value.trim())) return;
      return options.publish(context, typing, sourceId);
    }).catch(() => { /* The lease expires even if the transport fails. */ });
  };
  function clear() {
    clearTimeout(stopTimer); clearTimeout(sendTimer);
    stopTimer = sendTimer = undefined;
    if (published) publish(published, false);
    published = null; lastSent = 0; generation++;
  }
  function activity() {
    if (disposed) return;
    const context = options.getContext();
    if (!context || document.hidden || document.activeElement !== options.text || !options.canType() || !options.text.value.trim()) { clear(); return; }
    if (published && key(published) !== key(context)) clear();
    const send = () => {
      sendTimer = undefined;
      if (disposed || key(options.getContext()) !== key(context) || document.activeElement !== options.text || !options.canType() || !options.text.value.trim()) { clear(); return; }
      published = { ...context }; lastSent = Date.now(); publish(context, true);
    };
    if (!published || Date.now() - lastSent >= 1500) send();
    else if (!sendTimer) sendTimer = setTimeout(send, 1500 - (Date.now() - lastSent));
    clearTimeout(stopTimer);
    stopTimer = setTimeout(clear, 2000);
  }
  async function refresh() {
    const context = options.getContext(), currentKey = key(context);
    if (visibleContext !== currentKey) { generation++; visibleContext = currentKey; options.indicator.hidden = true; }
    if (disposed || document.hidden || !context) { options.indicator.hidden = true; return; }
    if (reading) return;
    reading = true;
    const expectedGeneration = generation;
    try {
      const typing = await options.read(context);
      if (!disposed && !document.hidden && generation === expectedGeneration && key(options.getContext()) === currentKey) options.indicator.hidden = !typing;
    } catch { if (!disposed && key(options.getContext()) === currentKey) options.indicator.hidden = true; }
    finally { reading = false; }
  }
  const onVisibility = () => { if (document.hidden) { clear(); options.indicator.hidden = true; } else void refresh(); };
  const onWindowBlur = () => { clear(); };
  const onFocus = () => { void refresh(); };
  options.text.addEventListener("input", activity);
  options.text.addEventListener("blur", clear);
  document.addEventListener("visibilitychange", onVisibility);
  addEventListener("blur", onWindowBlur);
  addEventListener("focus", onFocus);
  const timer = setInterval(() => { if (!document.hidden) void refresh(); }, 1000);
  function dispose() {
    if (disposed) return;
    clear(); disposed = true; options.indicator.hidden = true; clearInterval(timer);
    options.text.removeEventListener("input", activity); options.text.removeEventListener("blur", clear);
    document.removeEventListener("visibilitychange", onVisibility);
    removeEventListener("blur", onWindowBlur); removeEventListener("focus", onFocus);
  }
  void refresh();
  return { clear, refresh, dispose };
}
