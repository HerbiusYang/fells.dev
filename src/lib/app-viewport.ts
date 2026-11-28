import { subscribeMaintenance } from "./maintenance";

// Mobile keyboards can shrink the visual viewport while CSS viewport units
// still describe the layout viewport. Keep the composer inside the visible area.
export function bindAppViewport(root: HTMLElement) {
  const viewport = window.visualViewport;
  const notice = document.querySelector<HTMLElement>("[data-maintenance-notice]");
  const update = () => {
    const unzoomed = !viewport || Math.abs(viewport.scale - 1) < 0.01;
    const height = unzoomed && viewport ? Math.min(innerHeight, viewport.height) : innerHeight;
    const banner = notice && !notice.hidden ? notice.offsetHeight : 0;
    const top = (unzoomed && viewport ? Math.max(0, viewport.offsetTop) : 0) + banner;
    root.style.setProperty("--app-height", `${Math.max(1, height - banner)}px`);
    root.style.setProperty("--app-top", `${top}px`);
  };
  update();
  const unsubscribe = subscribeMaintenance(() => requestAnimationFrame(update));
  const resizeObserver = notice && typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
  if (notice) resizeObserver?.observe(notice);
  window.addEventListener("resize", update);
  viewport?.addEventListener("resize", update);
  viewport?.addEventListener("scroll", update);
  window.addEventListener("pagehide", event => {
    if (event.persisted) return;
    unsubscribe();
    resizeObserver?.disconnect();
    window.removeEventListener("resize", update);
    viewport?.removeEventListener("resize", update);
    viewport?.removeEventListener("scroll", update);
  });
}
