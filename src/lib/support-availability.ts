export type SupportAvailabilityState = "online" | "offline" | "unknown";

export function installSupportAvailabilityReader(options: {
  read(): Promise<boolean>;
  changed(state: SupportAvailabilityState): void;
  onError(error: unknown): void;
}) {
  let disposed = false, reading = false, again = false, generation = 0;
  async function refresh() {
    if (disposed || document.hidden) return;
    if (!navigator.onLine) { options.changed("unknown"); return; }
    if (reading) { again = true; return; }
    reading = true;
    const expected = generation;
    try {
      const online = await options.read();
      if (!disposed && expected === generation && navigator.onLine) options.changed(online ? "online" : "offline");
    } catch (error) {
      if (!disposed && expected === generation) { options.changed("unknown"); options.onError(error); }
    } finally {
      reading = false;
      if (again && !disposed) { again = false; void refresh(); }
    }
  }
  const offline = () => { generation++; options.changed("unknown"); };
  const visible = () => { if (!document.hidden) { generation++; void refresh(); } };
  const timer = setInterval(() => { void refresh(); }, 5000);
  addEventListener("online", refresh);
  addEventListener("offline", offline);
  addEventListener("focus", visible);
  document.addEventListener("visibilitychange", visible);
  options.changed("unknown"); void refresh();
  return {
    dispose() {
      disposed = true; generation++; clearInterval(timer);
      removeEventListener("online", refresh); removeEventListener("offline", offline); removeEventListener("focus", visible);
      document.removeEventListener("visibilitychange", visible);
    },
  };
}

export function installSupportAvailabilityHeartbeat(options: {
  publish(online: boolean, sourceId: string): Promise<void>;
  changed(state: SupportAvailabilityState): void;
  onError(error: unknown): void;
}) {
  const sourceId = crypto.randomUUID();
  let disposed = false, publishing = false;
  let queue = Promise.resolve();
  function heartbeat() {
    if (disposed || publishing || !navigator.onLine) return;
    publishing = true;
    queue = queue.then(async () => {
      if (disposed) return;
      try {
        await options.publish(true, sourceId);
        if (!disposed && navigator.onLine) options.changed("online");
      } catch (error) { if (!disposed) { options.changed("unknown"); options.onError(error); } }
    }).finally(() => { publishing = false; });
  }
  const offline = () => { options.changed("unknown"); };
  const timer = setInterval(heartbeat, 10000);
  addEventListener("online", heartbeat); addEventListener("offline", offline);
  options.changed("unknown"); heartbeat();
  return {
    dispose() {
      if (disposed) return;
      disposed = true; clearInterval(timer);
      removeEventListener("online", heartbeat); removeEventListener("offline", offline);
      // Serialize the stop after any in-flight heartbeat so a slow response
      // cannot put a closed desk back online. A lost stop expires on the server.
      queue = queue.then(() => options.publish(false, sourceId)).catch(() => {});
    },
  };
}
