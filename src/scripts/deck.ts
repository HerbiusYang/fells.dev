// Fanned agent-card deck + composer. Pure transforms, no canvas.
export function initDeck(stage: HTMLElement) {
  const deck = stage.querySelector<HTMLElement>("[data-deck]")!;
  const cards = [...stage.querySelectorAll<HTMLElement>("[data-card]")];
  const prompt = stage.querySelector<HTMLTextAreaElement>("[data-prompt]")!;
  const dot = stage.querySelector<HTMLElement>("[data-agent-dot]")!;
  const toast = stage.querySelector<HTMLElement>("[data-toast]")!;
  const template = stage.dataset.placeholder ?? "{agent}";
  const n = cards.length;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  let active = 0;
  let timer: number | undefined;
  let interacted = false;

  const spread = () => (innerWidth < 640 ? 92 : 170);

  function layout() {
    const half = Math.floor(n / 2);
    cards.forEach((card, i) => {
      // Signed distance from the active card, wrapping around.
      const o = ((i - active + n + half) % n) - half;
      const d = Math.abs(o);
      const s = card.style;
      s.setProperty("--x", `${o * spread()}px`);
      s.setProperty("--z", `${-d * 140}px`);
      s.setProperty("--ry", `${-o * 16}deg`);
      s.setProperty("--rz", `${o * 3}deg`);
      s.setProperty("--a", String(Math.max(0, 1 - d * 0.32)));
      s.zIndex = String(10 - d);
      card.setAttribute("aria-selected", String(o === 0));
    });
    const cur = cards[active];
    typePlaceholder(template.replace("{agent}", cur.dataset.name ?? ""));
    dot.style.setProperty("--hue", cur.dataset.hue ?? "#fff");
  }

  // Types the placeholder in when the agent changes (instant for reduced motion).
  let typing = 0;
  function typePlaceholder(text: string) {
    window.clearInterval(typing);
    if (reduced.matches || prompt.placeholder === text) {
      prompt.placeholder = text;
      return;
    }
    const chars = [...text];
    let n = 0;
    typing = window.setInterval(() => {
      n += 2;
      prompt.placeholder = chars.slice(0, n).join("");
      if (n >= chars.length) window.clearInterval(typing);
    }, 18);
  }

  function go(i: number) {
    active = (i + n) % n;
    layout();
  }
  const stopAuto = () => {
    interacted = true;
    window.clearInterval(timer);
  };
  function startAuto() {
    if (reduced.matches || interacted) return;
    window.clearInterval(timer);
    timer = window.setInterval(() => go(active + 1), 4200);
  }

  cards.forEach((card, i) =>
    card.addEventListener("click", () => {
      if (dragged) return;
      stopAuto();
      if (i === active) prompt.focus();
      else go(i);
    }),
  );
  stage.querySelector("[data-prev]")!.addEventListener("click", () => (stopAuto(), go(active - 1)));
  stage.querySelector("[data-next]")!.addEventListener("click", () => (stopAuto(), go(active + 1)));
  deck.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") (stopAuto(), go(active - 1), e.preventDefault());
    if (e.key === "ArrowRight") (stopAuto(), go(active + 1), e.preventDefault());
    if (e.key === "Enter") prompt.focus();
  });

  // Swipe / drag.
  // A swipe also fires a click on the card under the pointer; `dragged` swallows it.
  let startX: number | null = null;
  let dragged = false;
  deck.addEventListener("pointerdown", (e) => {
    startX = e.clientX;
    dragged = false;
  });
  addEventListener("pointerup", (e) => {
    if (startX === null) return;
    const dx = e.clientX - startX;
    startX = null;
    if (Math.abs(dx) > 40) {
      dragged = true;
      stopAuto();
      go(active + (dx < 0 ? 1 : -1));
      setTimeout(() => (dragged = false), 0);
    }
  });

  // Pause autoplay while the user is looking at or typing in the stage.
  stage.addEventListener("pointerenter", () => window.clearInterval(timer));
  stage.addEventListener("pointerleave", startAuto);
  prompt.addEventListener("focus", stopAuto);

  stage.querySelector("form")!.addEventListener("submit", (e) => {
    e.preventDefault();
    toast.textContent = toast.dataset.text ?? "";
    toast.classList.add("show");
    window.setTimeout(() => toast.classList.remove("show"), 5000);
  });
  prompt.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      prompt.form?.requestSubmit();
    }
  });

  addEventListener("resize", layout, { passive: true });
  layout();
  startAuto();
}
