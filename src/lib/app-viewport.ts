// Mobile keyboards can shrink the visual viewport while CSS viewport units
// still describe the layout viewport. Keep the composer inside the visible area.
export function bindAppViewport(root: HTMLElement) {
  const viewport = window.visualViewport;
  const update = () => {
    const unzoomed = !viewport || Math.abs(viewport.scale - 1) < 0.01;
    const height = unzoomed && viewport ? Math.min(innerHeight, viewport.height) : innerHeight;
    root.style.setProperty("--app-height", `${Math.max(1, height)}px`);
    root.style.setProperty("--app-top", `${unzoomed && viewport ? Math.max(0, viewport.offsetTop) : 0}px`);
  };
  update();
  window.addEventListener("resize", update);
  viewport?.addEventListener("resize", update);
  viewport?.addEventListener("scroll", update);
  window.addEventListener("pagehide", event => {
    if (event.persisted) return;
    window.removeEventListener("resize", update);
    viewport?.removeEventListener("resize", update);
    viewport?.removeEventListener("scroll", update);
  });
}
