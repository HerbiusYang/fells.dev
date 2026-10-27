import { createMaintenanceClient, type MaintenanceStatus } from "./maintenance-state.ts";

const client = createMaintenanceClient();
export const getMaintenanceStatus: () => MaintenanceStatus | null = client.get;
export const isBusinessBlocked = client.blocked;
export const observeMaintenanceResponse = client.observe;
export const readMaintenanceStatus = client.read;
export const subscribeMaintenance = client.subscribe;

/** One monitor per document. Importing the transport alone starts no timers. */
export function installMaintenanceMonitor() {
  const refresh = () => { if (!document.hidden && navigator.onLine) void client.read(); };
  const timer = setInterval(refresh, 30000);
  addEventListener("online", refresh); addEventListener("focus", refresh);
  document.addEventListener("visibilitychange", refresh);
  refresh();
  return () => {
    clearInterval(timer); removeEventListener("online", refresh); removeEventListener("focus", refresh);
    document.removeEventListener("visibilitychange", refresh);
  };
}
