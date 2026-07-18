import { useEffect, useRef, useState, forwardRef } from "react";

/**
 * Full-bleed sky stage. One brand film, two directions: the 12s forward cut,
 * then the same film reversed — a palindrome drift that never jump-cuts.
 * Plays everywhere; prefers-reduced-motion gets the still poster frame.
 *
 * Scrolling "encrypts" the sky: a canvas resamples the live video into
 * progressively chunkier mosaic blocks with ink/violet cipher cells mixed in,
 * synced to scroll, so the public sky turns unreadable right as the vault
 * seals over it. Skipped entirely under reduced motion or when unsupported —
 * the plain film is the fallback.
 */
const VideoStage = forwardRef<HTMLDivElement>(function VideoStage(_props, outerRef) {
  const fwdRef = useRef<HTMLVideoElement>(null);
  const revRef = useRef<HTMLVideoElement>(null);
  const cipherRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const fwd = fwdRef.current!;
    const rev = revRef.current!;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Reveal on first frame, on error (poster still shows), or after a grace
    // period — Data Saver / Low Power Mode may never fire loadeddata.
    const onReady = () => setReady(true);
    fwd.addEventListener("loadeddata", onReady, { once: true });
    fwd.addEventListener("error", onReady, { once: true });
    const readyFallback = window.setTimeout(onReady, 2500);
    if (fwd.readyState >= 2) setReady(true);

    if (reduced) {
      return () => {
        window.clearTimeout(readyFallback);
        fwd.removeEventListener("loadeddata", onReady);
        fwd.removeEventListener("error", onReady);
      };
    }

    const playSafe = (v: HTMLVideoElement) => v.play().catch(() => {});
    const onFwdEnd = () => {
      fwd.style.display = "none";
      rev.style.display = "block";
      rev.currentTime = 0;
      playSafe(rev);
    };
    const onRevEnd = () => {
      rev.style.display = "none";
      fwd.style.display = "block";
      fwd.currentTime = 0;
      playSafe(fwd);
    };
    fwd.addEventListener("ended", onFwdEnd);
    rev.addEventListener("ended", onRevEnd);
    playSafe(fwd);

    // ——— the cipher pass ———
    const canvas = cipherRef.current!;
    const ctx = canvas.getContext("2d", { alpha: true });
    const buffer = document.createElement("canvas");
    const bctx = buffer.getContext("2d", { alpha: false });
    let raf = 0;
    let drawn = false;

    if (ctx && bctx) {
      buffer.width = 192;
      buffer.height = 108;

      const coarse = window.matchMedia("(pointer: coarse)").matches;
      const dpr = Math.min(window.devicePixelRatio || 1, coarse ? 1 : 1.25);
      const size = () => {
        canvas.width = Math.round(window.innerWidth * dpr);
        canvas.height = Math.round(window.innerHeight * dpr);
      };
      size();
      window.addEventListener("resize", size);

      const PALETTE = ["#171f33", "#7342e2", "#2a2440", "#efeee9", "#0e1322"];

      const tick = () => {
        raf = requestAnimationFrame(tick);
        const vh = window.innerHeight;
        const y = window.scrollY;
        const p = Math.max(0, Math.min(1, y / (vh * 0.85)));

        if (p <= 0.02) {
          if (drawn) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            canvas.style.opacity = "0";
            drawn = false;
          }
          return;
        }
        if (y >= vh) return; // fully covered by the vault — stop burning frames

        const video = fwd.style.display === "none" ? rev : fwd;
        if (video.readyState < 2 || !video.videoWidth) return;

        // ramp: barely-there dither → chunky unreadable blocks
        const eased = p * p;
        const cols = Math.max(14, Math.round(150 - eased * 136));
        const rows = Math.max(8, Math.round((cols * canvas.height) / canvas.width));

        // cover-crop the video into the sample buffer
        const va = video.videoWidth / video.videoHeight;
        const ca = canvas.width / canvas.height;
        let sx = 0,
          sy = 0,
          sw = video.videoWidth,
          sh = video.videoHeight;
        if (va > ca) {
          sw = video.videoHeight * ca;
          sx = (video.videoWidth - sw) / 2;
        } else {
          sh = video.videoWidth / ca;
          sy = (video.videoHeight - sh) / 2;
        }
        bctx.drawImage(video, sx, sy, sw, sh, 0, 0, cols, rows);

        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(buffer, 0, 0, cols, rows, 0, 0, canvas.width, canvas.height);

        // cipher cells: stray blocks flip to ink/violet as encryption deepens
        const cellW = canvas.width / cols;
        const cellH = canvas.height / rows;
        const glitches = Math.round(eased * 140);
        for (let i = 0; i < glitches; i++) {
          const gx = (Math.random() * cols) | 0;
          const gy = (Math.random() * rows) | 0;
          ctx.globalAlpha = 0.25 + Math.random() * 0.55 * eased;
          ctx.fillStyle = PALETTE[(Math.random() * PALETTE.length) | 0];
          ctx.fillRect(gx * cellW, gy * cellH, cellW, cellH);
        }
        ctx.globalAlpha = 1;

        // ease the whole pass in so the first pixels of scroll stay crisp
        canvas.style.opacity = String(Math.min(1, (p - 0.02) / 0.18));
        drawn = true;
      };
      raf = requestAnimationFrame(tick);

      return () => {
        cancelAnimationFrame(raf);
        window.removeEventListener("resize", size);
        window.clearTimeout(readyFallback);
        fwd.removeEventListener("loadeddata", onReady);
        fwd.removeEventListener("error", onReady);
        fwd.removeEventListener("ended", onFwdEnd);
        rev.removeEventListener("ended", onRevEnd);
        fwd.pause();
        rev.pause();
      };
    }

    return () => {
      window.clearTimeout(readyFallback);
      fwd.removeEventListener("loadeddata", onReady);
      fwd.removeEventListener("error", onReady);
      fwd.removeEventListener("ended", onFwdEnd);
      rev.removeEventListener("ended", onRevEnd);
      fwd.pause();
      rev.pause();
    };
  }, []);

  return (
    <div ref={outerRef} className="stage" style={{ opacity: ready ? 1 : 0 }} aria-hidden="true">
      <video ref={fwdRef} src="/media/sky-v2.mp4" poster="/media/sky-v2-poster.jpg" muted playsInline preload="auto" />
      <video ref={revRef} src="/media/sky-v2-rev.mp4" muted playsInline preload="auto" style={{ display: "none" }} />
      <canvas ref={cipherRef} className="cipher" />
      <div className="scrim" />
    </div>
  );
});

export default VideoStage;
