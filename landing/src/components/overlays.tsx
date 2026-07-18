import { forwardRef, useEffect, useRef, useSyncExternalStore } from "react";
import { motion } from "motion/react";
import HeroDoors from "./HeroDoors";
import { BALANCE_EVENT, EXPLORER_URL, GLYPH_PATH, HEADLINE, SOCIALS } from "../lib/config";

const PHONE_Q = "(max-width: 639px)";
const usePhone = () =>
  useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(PHONE_Q);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(PHONE_Q).matches,
    () => false,
  );

const EASE = [0.25, 0.1, 0.25, 1] as const;
// When the page loads already scrolled (reload mid-page, bfcache), skip entry
// animations entirely so Motion never fights the scroll ticker over opacity.
const startedScrolled = () => typeof window !== "undefined" && window.scrollY > 2;
const rise = (delay: number) =>
  startedScrolled()
    ? { initial: false as const }
    : {
        initial: { opacity: 0, y: 12 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.6, ease: EASE, delay },
      };
const fade = (delay: number) =>
  startedScrolled()
    ? { initial: false as const }
    : {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        transition: { duration: 0.6, ease: EASE, delay },
      };

export function BrandMark() {
  // solid ink, same as the headline — exclusion blending gave it a stray hue
  return (
    <motion.div id="brand-mark" className="brand brand-solid" {...rise(0)}>
      <svg viewBox="0 0 256 256" fill="currentColor" role="img" aria-label="Benzo">
        <path d={GLYPH_PATH} />
      </svg>
      <span className="word display">Benzo</span>
    </motion.div>
  );
}

/** Avalanche's own alpha-channel loops, played through an A-shaped cutout. */
const AVAX_QUEUE = [6, 3, 8, 3, 7, 5, 6, 4, 3, 7, 2, 5, 7, 5];
const AVAX_VID = (n: number) => `https://atk2comacjoao5mp.public.blob.vercel-storage.com/alpha_webm/${n}.webm`;

function AvaxMark() {
  const vidRef = useRef<HTMLVideoElement>(null);
  const idx = useRef(0);
  const reduced =
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    const v = vidRef.current;
    if (!v) return;
    // infinite queue: each clip hands off to the next, then wraps
    const onEnd = () => {
      idx.current = (idx.current + 1) % AVAX_QUEUE.length;
      v.src = AVAX_VID(AVAX_QUEUE[idx.current]);
      v.play().catch(() => {});
    };
    v.addEventListener("ended", onEnd);
    // the header chrome goes inert once the vault covers it — stop decoding
    const nav = v.closest("nav");
    let mo: MutationObserver | null = null;
    if (nav) {
      mo = new MutationObserver(() => {
        if (nav.hasAttribute("inert")) v.pause();
        else v.play().catch(() => {});
      });
      mo.observe(nav, { attributes: true, attributeFilter: ["inert"] });
    }
    return () => {
      v.removeEventListener("ended", onEnd);
      mo?.disconnect();
    };
  }, []);

  return (
    <a
      className="avax-mark"
      href={EXPLORER_URL}
      target="_blank"
      rel="noreferrer"
      aria-label="Powered by Avalanche. Opens the testnet explorer"
    >
      <span className="avax-mark__label" aria-hidden="true">
        <span className="l-rest">Private L1 on Avalanche</span>
      </span>
      <span className="avax-mark__cut">
        {!reduced && <video ref={vidRef} src={AVAX_VID(AVAX_QUEUE[0])} autoPlay muted playsInline />}
      </span>
      <span className="l-clip" aria-hidden="true">
        <span className="l-hover">View explorer</span>
      </span>
    </a>
  );
}

export function HeaderNav() {
  // not xchrome: exclusion blending would invert the video in the cutout.
  // Phones skip the hover-driven avalanche mark and keep plain links.
  const phone = usePhone();
  return (
    <motion.nav id="site-nav" className="nav nav-solid" {...rise(0.15)} aria-label="Site">
      {phone ? (
        <>
          <a className="about" href={SOCIALS.x} target="_blank" rel="noreferrer">
            X
          </a>
          <div className="links">
            <a href={EXPLORER_URL} target="_blank" rel="noreferrer">
              [ Testnet ]
            </a>
          </div>
        </>
      ) : (
        <AvaxMark />
      )}
    </motion.nav>
  );
}

/** Hero block: title, subtitle, and the doors in one composed unit. */
export function HeroBlock() {
  return (
    <motion.div id="hero-block" className="headline" {...fade(0.3)}>
      <div className="title-box">
        <span className="line display">{HEADLINE}</span>
      </div>
      <p id="hero-sub" className="sub">
        Send, request, and receive money without putting your balance, income, or payment history on
        display. Privacy, on chain.
      </p>
      <HeroDoors />
    </motion.div>
  );
}

const MASKED = "$•••••";
const REVEALED = "$8,214";
const GLYPHS = "█▓▒░•§#%¤";

export const BalanceInfo = forwardRef<HTMLDivElement, { symbolRef: React.Ref<HTMLSpanElement> }>(
  function BalanceInfo({ symbolRef }, ref) {
    const amountRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
      const el = amountRef.current!;
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      let timer: number | null = null;
      let shown = false;

      const scrambleTo = (target: string) => {
        if (reduced) {
          el.textContent = target;
          return;
        }
        if (timer) window.clearInterval(timer);
        let frame = 0;
        const totalFrames = 14;
        timer = window.setInterval(() => {
          frame++;
          const resolved = Math.floor((frame / totalFrames) * target.length);
          let out = "";
          for (let i = 0; i < target.length; i++) {
            out += i < resolved ? target[i] : GLYPHS[(Math.random() * GLYPHS.length) | 0];
          }
          el.textContent = out;
          if (frame >= totalFrames && timer) {
            window.clearInterval(timer);
            timer = null;
            el.textContent = target;
          }
        }, 42);
      };

      const reveal = () => {
        if (shown) return;
        shown = true;
        scrambleTo(REVEALED);
      };
      const hide = () => {
        if (!shown) return;
        shown = false;
        scrambleTo(MASKED);
      };
      const toggle = () => (shown ? hide() : reveal());
      // the door card broadcasts its hover so the balance uncensors with it
      const onDoors = (e: Event) => {
        if ((e as CustomEvent<{ show: boolean }>).detail?.show) reveal();
        else hide();
      };

      el.addEventListener("mouseenter", reveal);
      el.addEventListener("mouseleave", hide);
      el.addEventListener("touchstart", toggle, { passive: true });
      window.addEventListener(BALANCE_EVENT, onDoors);
      return () => {
        if (timer) window.clearInterval(timer);
        el.removeEventListener("mouseenter", reveal);
        el.removeEventListener("mouseleave", hide);
        el.removeEventListener("touchstart", toggle);
        window.removeEventListener(BALANCE_EVENT, onDoors);
      };
    }, []);

    return (
      <motion.div ref={ref} className="xchrome balance" {...fade(0.45)}>
        <div className="head">
          <div className="glyphcircle">
            <svg viewBox="0 0 40 40" width="100%" height="100%" aria-hidden="true">
              <circle cx="20" cy="20" r="18.75" stroke="#fff" strokeWidth="2.5" fill="none" />
            </svg>
            <span ref={symbolRef}>●</span>
          </div>
        </div>
        <div className="label display">
          Private
          <br />
          balance
        </div>
        <div
          ref={amountRef}
          className="amount display tnum"
          data-cursor
          title="Demo balance"
          aria-label="Private balance, hidden. Hover to preview a demo amount."
        >
          {MASKED}
        </div>
      </motion.div>
    );
  },
);

export const ScrollHint = () => (
  <motion.div id="scroll-hint" className="xchrome hint" {...fade(0.7)} aria-hidden="true">
    Scroll to see the magic
  </motion.div>
);
