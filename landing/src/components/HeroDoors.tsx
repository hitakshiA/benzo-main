import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { BALANCE_EVENT, CONSOLE_URL, LEAVE_EVENT, WALLET_URL } from "../lib/config";

const SCRAMBLE = "█▓▒░•§#%¤";

const CONTENT = {
  personal: {
    kicker: "For you",
    title: "The wallet",
    points: [
      "Send to @handles, as easy as texting",
      "Your balance and history stay yours",
      "Cash in, cash out, split anything",
      "Every payment gets a provable receipt",
    ],
  },
  business: {
    kicker: "For your team",
    title: "The console",
    points: [
      "Run payroll without leaking salaries",
      "Pay invoices, keep the terms private",
      "Treasury with totals you can prove",
      "Give auditors exactly what they need",
    ],
  },
} as const;
type DoorKey = keyof typeof CONTENT;

/**
 * The two doors as one square: Personal and Business are two triangles that
 * meet on the diagonal. Hovering a triangle lets it claim more of the square
 * (the seam slides), the slab tilts toward the cursor without leaving its
 * spot, and a feature panel decrypts into the open sky on the right. Clicking
 * runs the petal send-off and the violet wave.
 */
export default function HeroDoors() {
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<DoorKey | null>(null);
  const hideTimer = useRef<number | null>(null);
  const lastShown = useRef<DoorKey>("personal");

  // click ceremony (the card itself never moves — hover only changes emphasis)
  useEffect(() => {
    const root = rootRef.current!;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const cleanups: Array<() => void> = [];
    let leaving = false;

    for (const door of Array.from(root.querySelectorAll<HTMLAnchorElement>("a.tri, a.door-mobile"))) {
      const onClick = (e: MouseEvent) => {
        if (reduced || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        if (leaving) return;
        leaving = true;

        // the chosen side floods the whole card before the wave arrives
        door.classList.add("filling");

        const r = root.getBoundingClientRect();
        const cx = (e.clientX || r.left + r.width / 2) - r.left;
        const cy = (e.clientY || r.top + r.height / 2) - r.top;
        const colors = ["#efeee9", "#c9b8f5", "#7342e2", "#9d81ec"];
        for (let i = 0; i < 14; i++) {
          const petal = document.createElement("span");
          petal.className = "petal";
          petal.style.left = `${cx}px`;
          petal.style.top = `${cy}px`;
          petal.style.background = colors[i % colors.length];
          root.appendChild(petal);
          const ang = (i / 14) * Math.PI * 2 + Math.random() * 0.5;
          const dist = 34 + Math.random() * 66;
          gsap.fromTo(
            petal,
            { scale: 0, rotation: Math.random() * 160 },
            {
              x: Math.cos(ang) * dist,
              y: Math.sin(ang) * dist + 42,
              scale: 0.5 + Math.random() * 0.8,
              rotation: "+=140",
              opacity: 0,
              duration: 0.55 + Math.random() * 0.35,
              ease: "power2.out",
              onComplete: () => petal.remove(),
            },
          );
        }
        window.dispatchEvent(new CustomEvent(LEAVE_EVENT, { detail: { href: door.href } }));
      };
      door.addEventListener("click", onClick);
      cleanups.push(() => door.removeEventListener("click", onClick));
    }

    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) {
        leaving = false;
        root.querySelectorAll(".filling").forEach((el) => el.classList.remove("filling"));
      }
    };
    window.addEventListener("pageshow", onPageShow);
    cleanups.push(() => window.removeEventListener("pageshow", onPageShow));

    // the slab tilts toward whichever part the cursor is over — rotation only,
    // the card's footprint on the page never changes
    const card = root.querySelector<HTMLElement>(".doors-card");
    if (card && !reduced && window.matchMedia("(pointer: fine)").matches) {
      const BX = 9;
      const BY = -8; // resting pose, mirrors the CSS transform
      gsap.set(card, { rotationX: BX, rotationY: BY, "--shine": 0 });
      const rx = gsap.quickTo(card, "rotationX", { duration: 0.5, ease: "power3.out" });
      const ry = gsap.quickTo(card, "rotationY", { duration: 0.5, ease: "power3.out" });
      // the gloss band slides opposite the tilt, like light moving on plastic
      const sh = gsap.quickTo(card, "--shine", { duration: 0.5, ease: "power3.out" });
      const onTilt = (e: MouseEvent) => {
        const r = root.getBoundingClientRect();
        const nx = (e.clientX - r.left) / r.width - 0.5;
        const ny = (e.clientY - r.top) / r.height - 0.5;
        rx(BX + ny * 14);
        ry(BY - nx * 16);
        sh(-(nx + ny * 0.4) * 34);
      };
      const onRest = () => {
        rx(BX);
        ry(BY);
        sh(0);
      };
      root.addEventListener("mousemove", onTilt);
      root.addEventListener("mouseleave", onRest);
      cleanups.push(() => {
        root.removeEventListener("mousemove", onTilt);
        root.removeEventListener("mouseleave", onRest);
      });
    }

    return () => cleanups.forEach((fn) => fn());
  }, []);

  // feature panel: decrypting title + masked rows sliding up
  useEffect(() => {
    const panel = panelRef.current!;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!active) {
      gsap.killTweensOf(panel);
      gsap.to(panel, { autoAlpha: 0, duration: 0.22, ease: "power1.out" });
      return;
    }
    const rows = panel.querySelectorAll<HTMLElement>(".dp-row");
    const title = panel.querySelector<HTMLElement>(".dp-title");
    gsap.killTweensOf([panel, ...Array.from(rows)]);
    gsap.set(panel, { autoAlpha: 1 });
    if (reduced || !title) return;

    // title decrypts in
    const target = CONTENT[active].title;
    let frame = 0;
    const total = 10;
    const id = window.setInterval(() => {
      frame++;
      const resolved = Math.floor((frame / total) * target.length);
      let out = "";
      for (let i = 0; i < target.length; i++) {
        out += i < resolved ? target[i] : SCRAMBLE[(Math.random() * SCRAMBLE.length) | 0];
      }
      title.textContent = out;
      if (frame >= total) {
        window.clearInterval(id);
        title.textContent = target;
      }
    }, 34);

    gsap.fromTo(
      rows,
      { yPercent: 130 },
      { yPercent: 0, duration: 0.55, ease: "power3.out", stagger: 0.06 },
    );
    return () => window.clearInterval(id);
  }, [active]);

  const enter = (key: DoorKey) => () => {
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    setActive(key);
    window.dispatchEvent(new CustomEvent(BALANCE_EVENT, { detail: { show: true } }));
  };
  const leave = () => {
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setActive(null), 140);
    window.dispatchEvent(new CustomEvent(BALANCE_EVENT, { detail: { show: false } }));
  };

  // the panel slot is reserved; content lingers through the fade-out
  if (active) lastShown.current = active;
  const content = CONTENT[active ?? lastShown.current];

  return (
    <>
      <div ref={rootRef} id="hero-ctas" className="doors" onMouseLeave={leave}>
        <div className="doors-card">
          <a className="tri tri-p" href={WALLET_URL} onMouseEnter={enter("personal")} aria-label="Personal: open the wallet">
            <span className="t-label">
              <span className="t-word display">Personal</span>
              <span className="t-sub">The wallet ↗</span>
            </span>
            <span className="kit kit-p" aria-hidden="true">
              <span className="chiprow">
                <svg className="chip" viewBox="0 0 44 32">
                  <defs>
                    <linearGradient id="chipg" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0" stopColor="#e8cf8a" />
                      <stop offset="0.55" stopColor="#c9a24f" />
                      <stop offset="1" stopColor="#e3c87f" />
                    </linearGradient>
                  </defs>
                  <rect x="1" y="1" width="42" height="30" rx="6.5" fill="url(#chipg)" stroke="#8a6b2a" strokeOpacity="0.45" />
                  <path
                    d="M1 11h13M1 21h13M30 11h13M30 21h13M14 11c4 0 4 10 0 10M30 11c-4 0-4 10 0 10M22 1v8M22 23v8"
                    fill="none"
                    stroke="#8a6b2a"
                    strokeOpacity="0.5"
                    strokeWidth="1.4"
                  />
                </svg>
                <svg className="waves" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
                  <path d="M7.5 10a5.5 5.5 0 0 1 0 4" />
                  <path d="M10.8 8a9 9 0 0 1 0 8" />
                  <path d="M14.1 6a12.6 12.6 0 0 1 0 12" />
                </svg>
              </span>
              <span className="pan tnum">•••• •••• •••• 4291</span>
              <span className="meta tnum">@you · 12/29</span>
            </span>
          </a>
          <a className="tri tri-b" href={CONSOLE_URL} onMouseEnter={enter("business")} aria-label="Business: open the console">
            <span className="t-label">
              <span className="t-word display">Business</span>
              <span className="t-sub">The console ↗</span>
            </span>
            <span className="kit kit-b" aria-hidden="true">
              <span className="chiprow">
                <svg className="chip" viewBox="0 0 44 32">
                  <rect x="1" y="1" width="42" height="30" rx="6.5" fill="url(#chipg)" stroke="#8a6b2a" strokeOpacity="0.45" />
                  <path
                    d="M1 11h13M1 21h13M30 11h13M30 21h13M14 11c4 0 4 10 0 10M30 11c-4 0-4 10 0 10M22 1v8M22 23v8"
                    fill="none"
                    stroke="#8a6b2a"
                    strokeOpacity="0.5"
                    strokeWidth="1.4"
                  />
                </svg>
                <svg className="waves" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
                  <path d="M7.5 10a5.5 5.5 0 0 1 0 4" />
                  <path d="M10.8 8a9 9 0 0 1 0 8" />
                  <path d="M14.1 6a12.6 12.6 0 0 1 0 12" />
                </svg>
              </span>
              <span className="pan tnum">•••• •••• •••• 7305</span>
              <span className="meta tnum">@yourco · 01/31</span>
            </span>
          </a>
        </div>
        <span className="door-hint" aria-hidden="true">
          Hover to open
        </span>
        <a className="door-mobile display" href={WALLET_URL}>
          Open the wallet <span aria-hidden="true">↗</span>
        </a>
      </div>

      <div ref={panelRef} className="door-panel" aria-hidden={!active}>
        <p className="dp-kicker">{content.kicker}</p>
        <h3 className="dp-title display">{content.title}</h3>
        {content.points.map((p) => (
          <div className="dp-clip" key={p}>
            <p className="dp-row">
              <span className="dp-dash" aria-hidden="true" />
              {p}
            </p>
          </div>
        ))}
      </div>
    </>
  );
}
