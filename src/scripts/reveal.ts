// Server-rendered content starts visible. Never make the current viewport wait
// for a module download, observer callback or decorative transition.
export {};
const elements = [...document.querySelectorAll<HTMLElement>(".reveal")];
if (typeof IntersectionObserver !== "undefined" && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
  try {
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("in");
          observer.unobserve(entry.target);
        }
      }
    }, { rootMargin: "0px", threshold: 0 });
    for (const element of elements) {
      if (element.getBoundingClientRect().top >= innerHeight) {
        element.classList.add("reveal-pending");
        observer.observe(element);
      }
    }
  } catch {
    // Embedded browsers may expose an observer that fails during setup.
    elements.forEach(element => element.classList.remove("reveal-pending"));
  }
}
