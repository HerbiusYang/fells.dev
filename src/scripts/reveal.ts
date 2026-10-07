// Decorative observers must not break interactions when unavailable.
if (typeof IntersectionObserver === "undefined") {
  document.querySelectorAll(".reveal").forEach(el => el.classList.add("in"));
} else {
const io = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (e.isIntersecting) {
        e.target.classList.add("in");
        io.unobserve(e.target);
      }
    }
  },
  { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
);
document.querySelectorAll(".reveal").forEach((el) => io.observe(el));

}
