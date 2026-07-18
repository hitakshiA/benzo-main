import { useRef } from "react";
import { MotionConfig } from "motion/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import VideoStage from "./components/VideoStage";
import GalleryPanel from "./components/GalleryPanel";
import CustomCursor from "./components/CustomCursor";
import TransitionWave from "./components/TransitionWave";
import SiteFooter from "./components/SiteFooter";
import StepHoverImages from "./components/StepHoverImages";
import { BalanceInfo, BrandMark, HeaderNav, HeroBlock, ScrollHint } from "./components/overlays";

gsap.registerPlugin(ScrollTrigger, useGSAP);
// Mobile URL-bar collapse fires resize; don't let it rebuild the scrub.
ScrollTrigger.config({ ignoreMobileResize: true });

const SYMBOLS = ["●", "✱", "§", "%", "#"];

/**
 * Scroll choreography (all layers fixed; the spacer defines scroll length):
 *   Phase 1 (0 → vh)          the vault panel slides up over the sky.
 *   Phase 2 (vh → vh+max)     the vault's inner wrap scrolls; captioned cards
 *                             scale in/out per frame; the header bows out.
 *   Outro  (last 1vh)         the ink footer slides up — nav, the two doors,
 *                             and the oversized wordmark.
 */
export default function App() {
  const spacerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const infoRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  const symbolRef = useRef<HTMLSpanElement>(null);

  useGSAP(
    () => {
      const spacer = spacerRef.current!;
      const stage = stageRef.current!;
      const panel = panelRef.current!;
      const apron = document.getElementById("vault-apron");
      const apronCv = apron?.querySelector("canvas") ?? null;

      // The vault's leading edge dissolves the sky in the same currency as
      // the cipher mosaic: chunky ink cells, sparse at the top and solid at
      // the edge, dithered by the site's usual hash. Drawn at grid resolution
      // and upscaled with pixelated rendering, so cells stay crisp.
      const drawApron = (seed = 0) => {
        if (!apron || !apronCv) return;
        const CELL = Math.max(34, Math.round(window.innerWidth / 30));
        const cols = Math.ceil(window.innerWidth / CELL);
        const ROWS = 9;
        if (apronCv.width !== cols || apronCv.height !== ROWS) {
          apronCv.width = cols;
          apronCv.height = ROWS;
          const H = ROWS * CELL;
          apron.style.top = `${-(H - 2)}px`;
          apron.style.height = `${H}px`;
        }
        const ctx = apronCv.getContext("2d");
        if (!ctx) return;
        const ink = getComputedStyle(document.documentElement).getPropertyValue("--panel").trim() || "#1a2030";
        const hash = (a: number, b: number) => {
          const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
          return s - Math.floor(s);
        };
        ctx.clearRect(0, 0, cols, ROWS);
        for (let y = 0; y < ROWS; y++) {
          const d = (y + 1) / ROWS;
          const dd = d * d;
          for (let x = 0; x < cols; x++) {
            // the seed churns the dither so the edge lives like the sky filter
            const r = hash(x + seed * 13.7, y + seed * 7.3);
            if (r < dd) {
              ctx.globalAlpha = 1;
              ctx.fillStyle = ink;
            } else if (r < dd + 0.16) {
              ctx.globalAlpha = 0.45;
              ctx.fillStyle = ink;
            } else if (r > 0.985) {
              ctx.globalAlpha = 0.35 * d;
              ctx.fillStyle = "oklch(0.55 0.18 292)";
            } else {
              continue;
            }
            ctx.fillRect(x, y, 1, 1);
          }
        }
        ctx.globalAlpha = 1;
      };
      let apronStep = -1;
      const wrap = wrapRef.current!;
      const info = infoRef.current!;
      const footer = footerRef.current!;
      const hint = document.getElementById("scroll-hint");
      const headline = document.getElementById("hero-block");
      const brand = document.getElementById("brand-mark");
      const nav = document.getElementById("site-nav");
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      const heroCtas = document.getElementById("hero-ctas");

      let vh = window.innerHeight;
      let maxScroll = 0;
      let cards: { el: HTMLElement; top: number; h: number; tag: HTMLElement | null }[] = [];
      let scenes: { el: HTMLElement; pin: HTMLElement; top: number; h: number }[] = [];

      const topWithin = (el: HTMLElement, root: HTMLElement) => {
        let t = 0;
        let n: HTMLElement | null = el;
        while (n && n !== root) {
          t += n.offsetTop;
          n = n.offsetParent as HTMLElement | null;
        }
        return t;
      };

      const measure = () => {
        vh = window.innerHeight;
        maxScroll = Math.max(0, wrap.scrollHeight - vh);
        spacer.style.height = `${vh + maxScroll + 2 * vh}px`;
        drawApron();
        cards = Array.from(wrap.querySelectorAll<HTMLElement>(".bp-card")).map((el) => ({
          el,
          top: topWithin(el, wrap),
          h: el.offsetHeight,
          tag: el.parentElement?.querySelector<HTMLElement>(".cell-tag") ?? null,
        }));
        scenes = Array.from(wrap.querySelectorAll<HTMLElement>(".scene")).flatMap((el) => {
          const pin = el.querySelector<HTMLElement>(".scene-pin");
          return pin ? [{ el, pin, top: topWithin(el, wrap), h: el.offsetHeight }] : [];
        });
        ScrollTrigger.refresh();
      };

      // Coalesce re-measures; the ResizeObserver fires after React re-lays the
      // grid on a breakpoint change, so card offsets are never stale.
      let measureRaf = 0;
      const scheduleMeasure = () => {
        cancelAnimationFrame(measureRaf);
        measureRaf = requestAnimationFrame(measure);
      };
      const coarse = window.matchMedia("(pointer: coarse)").matches;
      let lastW = window.innerWidth;
      const onResize = () => {
        // On touch devices ignore height-only resizes (URL bar collapse).
        if (coarse && window.innerWidth === lastW) return;
        lastW = window.innerWidth;
        scheduleMeasure();
      };

      // Vault slides up over the sky during the first viewport of scroll.
      gsap.fromTo(
        panel,
        { y: () => window.innerHeight },
        {
          y: 0,
          ease: "none",
          scrollTrigger: { start: 0, end: () => window.innerHeight, scrub: true, invalidateOnRefresh: true },
        },
      );

      let lastSymbolAt = 0;
      let lastY = -1;

      const update = () => {
        const y = window.scrollY;
        const panelY = Math.max(0, vh - y);
        const wrapY = -Math.max(0, y - vh);
        wrap.style.transform = `translate3d(0, ${wrapY}px, 0)`;

        // The dusk apron rides the vault's leading edge: the sky passes
        // through a violet twilight before it lands in ink. Fades in with
        // the first scroll so the hero stays untinted at rest.
        if (apron) {
          apron.style.transform = `translate3d(0, ${panelY}px, 0)`;
          apron.style.opacity = String(Math.min(1, y / (vh * 0.28)));
          // while the edge is on screen the dither churns in ~8 fps steps
          if (!reduced && y > 0 && y < vh * 1.2) {
            const step = Math.floor(performance.now() / 130);
            if (step !== apronStep) {
              apronStep = step;
              drawApron(step);
            }
          }
        }

        // The sky is fully covered after the first viewport — stop compositing it.
        stage.style.visibility = y >= vh ? "hidden" : "visible";
        if (hint && y > 0) hint.style.opacity = String(Math.max(0, 1 - y / (vh * 0.4)));

        for (const c of cards) {
          const top = panelY + wrapY + c.top;
          const bottom = top + c.h;
          let s: number;
          if (reduced) s = 1;
          else if (bottom <= 0 || top >= vh) s = 0;
          else s = Math.max(0, Math.min(1, Math.min((vh - top) / (vh * 0.6), bottom / (vh * 0.4))));
          c.el.style.transform = `scale(${s})`;
          if (c.tag) c.tag.style.opacity = String(s);
        }

        // Scenes: pin each 100vh stage while its tall section passes, fade it
        // in on arrival, expose scrub progress as --sp, lift it away after.
        for (const s of scenes) {
          const topVp = panelY + wrapY + s.top;
          const pinRange = Math.max(0, s.h - vh);
          const pinOffset = Math.min(Math.max(-topVp, 0), pinRange);
          s.pin.style.transform = `translate3d(0, ${pinOffset}px, 0)`;
          s.el.style.setProperty("--sp", (pinRange ? pinOffset / pinRange : 1).toFixed(4));
          if (reduced) {
            s.pin.style.opacity = "1";
          } else {
            const fadeIn = Math.max(0, Math.min(1, (vh * 0.9 - topVp) / (vh * 0.45)));
            const exitP = Math.max(0, Math.min(1, (-topVp - pinRange) / (vh * 0.4)));
            s.pin.style.opacity = String(Math.min(fadeIn, 1 - exitP));
          }
        }

        // Outro: the footer slides up over the vault.
        const outroStart = vh + maxScroll;
        const p = Math.max(0, Math.min(1, (y - outroStart) / (vh - 100)));
        footer.style.transform = `translate3d(0, ${(1 - p) * vh}px, 0)`;
        const interactive = p > 0.55;
        footer.style.pointerEvents = interactive ? "auto" : "none";
        footer.toggleAttribute("inert", !interactive);

        // The whole hero chrome (header, cover line, balance, doors) bows out
        // quickly once the vault starts rising; the footer carries the brand.
        const fadeOut = Math.max(0, Math.min(1, (y - vh * 0.12) / (vh * 0.33)));
        if (y > 0) {
          const chrome = String(1 - fadeOut);
          if (headline) headline.style.opacity = chrome;
          if (brand) brand.style.opacity = chrome;
          if (nav) nav.style.opacity = chrome;
          if (heroCtas) heroCtas.style.opacity = chrome;
          info.style.opacity = chrome;
          const gone = fadeOut > 0.5;
          nav?.toggleAttribute("inert", gone);
          heroCtas?.toggleAttribute("inert", gone);
          info.toggleAttribute("inert", gone);
        } else if (lastY > 0) {
          // Instant jump back to top (Home key, scrollTo): restore defaults once.
          for (const el of [headline, brand, nav, info, hint, heroCtas]) if (el) el.style.opacity = "";
          nav?.removeAttribute("inert");
          heroCtas?.removeAttribute("inert");
          info.removeAttribute("inert");
        }

        const now = performance.now();
        if (!reduced && y !== lastY && now - lastSymbolAt > 80 && symbolRef.current) {
          symbolRef.current.textContent = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
          lastSymbolAt = now;
        }
        lastY = y;
      };

      measure();
      gsap.ticker.add(update);
      window.addEventListener("resize", onResize);
      const ro = new ResizeObserver(scheduleMeasure);
      ro.observe(wrap);
      document.fonts?.ready.then(scheduleMeasure).catch(() => {});

      return () => {
        gsap.ticker.remove(update);
        window.removeEventListener("resize", onResize);
        ro.disconnect();
        cancelAnimationFrame(measureRaf);
      };
    },
    { scope: spacerRef },
  );

  return (
    <div id="scroll-spacer" ref={spacerRef} style={{ height: "500vh" }}>
      <MotionConfig reducedMotion="user">
        <main>
        <h1 className="sr-only">Benzo: private USDC payments on Avalanche</h1>
        <VideoStage ref={stageRef} />
        <div id="vault-apron" className="vault-apron" aria-hidden="true">
          <canvas />
        </div>
        <GalleryPanel ref={panelRef} wrapRef={wrapRef} />
        <StepHoverImages />
        <SiteFooter ref={footerRef} />
        <BrandMark />
        <HeaderNav />
        <HeroBlock />
        <BalanceInfo ref={infoRef} symbolRef={symbolRef} />
          <ScrollHint />
        </main>
      </MotionConfig>
      <CustomCursor />
      <TransitionWave />
    </div>
  );
}
