import { useEffect, useRef } from "react";
import gsap from "gsap";

const IMGS = ["/steps/01.webp", "/steps/02.webp", "/steps/03.webp"];

/**
 * Cursor-following image reveal for the SHIELD / SEND / PROVE rows.
 * Hovering a row fades in its still, which glides after the pointer via
 * gsap.quickTo. The images live in this untransformed fixed layer because
 * the rows themselves sit inside the translated vault wrap, where
 * position: fixed would resolve against the transform instead of the viewport.
 */
export default function StepHoverImages() {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fine = window.matchMedia("(pointer: fine)").matches;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!fine || reduced) return;

    const root = rootRef.current!;
    const steps = Array.from(document.querySelectorAll<HTMLElement>(".stage-step"));
    const cleanups: Array<() => void> = [];

    steps.forEach((el, i) => {
      const image = root.children[i] as HTMLElement | undefined;
      if (!image) return;
      gsap.set(image, { yPercent: -50, xPercent: -50 });
      const setX = gsap.quickTo(image, "x", { duration: 0.4, ease: "power3" });
      const setY = gsap.quickTo(image, "y", { duration: 0.4, ease: "power3" });

      let firstEnter = true;
      const align = (e: MouseEvent) => {
        if (firstEnter) {
          // jump straight to the pointer on entry, then ease afterwards
          setX(e.clientX, e.clientX);
          setY(e.clientY, e.clientY);
          firstEnter = false;
        } else {
          setX(e.clientX);
          setY(e.clientY);
        }
      };
      const startFollow = () => document.addEventListener("mousemove", align);
      const stopFollow = () => document.removeEventListener("mousemove", align);
      const fade = gsap.to(image, {
        autoAlpha: 1,
        ease: "none",
        paused: true,
        duration: 0.12,
        onReverseComplete: stopFollow,
      });

      // while the still IS the cursor, the glyph cursor steps aside
      const cursorEl = () => document.querySelector<HTMLElement>(".cursor");
      const onEnter = (e: MouseEvent) => {
        firstEnter = true;
        fade.play();
        startFollow();
        align(e);
        cursorEl()?.classList.add("suppress");
      };
      const onLeave = () => {
        fade.reverse();
        cursorEl()?.classList.remove("suppress");
      };

      el.addEventListener("mouseenter", onEnter);
      el.addEventListener("mouseleave", onLeave);
      cleanups.push(() => {
        el.removeEventListener("mouseenter", onEnter);
        el.removeEventListener("mouseleave", onLeave);
        stopFollow();
        fade.kill();
      });
    });

    return () => cleanups.forEach((fn) => fn());
  }, []);

  return (
    <div ref={rootRef} aria-hidden="true">
      {IMGS.map((src) => (
        <img key={src} className="swipeimage" src={src} alt="" loading="lazy" draggable={false} />
      ))}
    </div>
  );
}
