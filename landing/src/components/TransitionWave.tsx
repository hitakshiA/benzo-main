import { useEffect, useRef } from "react";
import gsap from "gsap";
import { LEAVE_EVENT } from "../lib/config";

const NUM_POINTS = 10;
const POINT_DELAY_MAX = 0.25;
const PATH_DELAY = 0.15;

/**
 * Wavy violet overlay that sweeps up when the visitor steps through a door
 * (Open wallet / Open console), then navigates.
 *
 * Blake Bowen's shape-overlays technique: each path's top edge is N control
 * points tweened 100 → 0 with small random delays; a cubic spline is redrawn
 * through them every tick, so the edge rolls like a wave. The pale lavender
 * path leads, the deep violet body covers it.
 */
export default function TransitionWave() {
  const ref = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = ref.current!;
    const paths = Array.from(svg.querySelectorAll("path"));
    const allPoints = paths.map(() => new Array<number>(NUM_POINTS).fill(100));
    let leaving = false;

    const render = () => {
      paths.forEach((path, i) => {
        const pts = allPoints[i];
        let d = `M 0 ${pts[0]} C`;
        for (let j = 0; j < NUM_POINTS - 1; j++) {
          const p = ((j + 1) / (NUM_POINTS - 1)) * 100;
          const cp = p - ((1 / (NUM_POINTS - 1)) * 100) / 2;
          d += ` ${cp} ${pts[j]} ${cp} ${pts[j + 1]} ${p} ${pts[j + 1]}`;
        }
        d += " V 100 H 0";
        path.setAttribute("d", d);
      });
    };

    const onLeave = (e: Event) => {
      if (leaving) return;
      leaving = true;
      const { href } = (e as CustomEvent<{ href: string }>).detail;
      render();
      svg.style.display = "block";

      const tl = gsap.timeline({
        delay: 0.35, // let the label diff + petal burst have their moment first
        onUpdate: render,
        onComplete: () => {
          window.location.href = href;
        },
        defaults: { ease: "power2.inOut", duration: 0.75 },
      });
      const pointsDelay = Array.from({ length: NUM_POINTS }, () => Math.random() * POINT_DELAY_MAX);
      allPoints.forEach((pts, i) => {
        pointsDelay.forEach((delay, j) => {
          tl.to(pts, { [j]: 0 }, delay + i * PATH_DELAY);
        });
      });
    };

    // Back/forward-cache restore would otherwise leave the wave covering the
    // page (and `leaving` latched) after the visitor navigates back.
    const onPageShow = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      leaving = false;
      allPoints.forEach((pts) => pts.fill(100));
      render();
      svg.style.display = "none";
    };

    window.addEventListener(LEAVE_EVENT, onLeave);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.removeEventListener(LEAVE_EVENT, onLeave);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);

  return (
    <svg ref={ref} className="wave" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="waveUnder" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#e6ddfa" />
          <stop offset="100%" stopColor="#b49af0" />
        </linearGradient>
        <linearGradient id="waveOver" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#8f66e9" />
          <stop offset="100%" stopColor="#5c33c9" />
        </linearGradient>
      </defs>
      <path d="M 0 100 V 100 H 0" fill="url(#waveUnder)" />
      <path d="M 0 100 V 100 H 0" fill="url(#waveOver)" />
    </svg>
  );
}
