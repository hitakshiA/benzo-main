import { useEffect, useRef } from "react";
import gsap from "gsap";
import { GLYPH_PATH } from "../lib/config";

const HEX = "0123456789abcdef";
const SCRAMBLE = "█▓▒░•§#%¤";
const MASK_BAL = "$•••••";
const MASK_ADDR = "0x••••…••••";
const MASK_TX = "0x••••••••";
const IDLE_TX = "· · · · · · · ·";
const Y_ADDR = "0x8f4a…31c9";
const R_ADDR = "0x2d7e…a844";
const TX_ID = "0x7d29…49da";
const BASE = 1067;
const AMOUNT = 120;
const fmt = (v: number) => `$${Math.round(v).toLocaleString("en-US")}`;

/**
 * Scroll-scrubbed private send where encryption is the choreography:
 * the sender starts in the clear and ENCRYPTS the moment the packet departs;
 * the receiver DECRYPTS on arrival (balance counts up, address shows, tx id
 * resolves) and seals back to ciphertext at the end. All of it maps onto the
 * scene's --sp scroll progress, so it runs forward and backward.
 */
export default function PrivateSend() {
  const rootRef = useRef<HTMLDivElement>(null);
  const coinRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const root = rootRef.current!;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const q = gsap.utils.selector(root);
    const packet = q(".packet")[0] as HTMLElement;
    const track = q(".rail-track")[0] as HTMLElement;
    const netcap = q(".rail-cipher")[0] as HTMLElement;
    const sendline = q(".psending")[0] as HTMLElement;
    const plus = q(".pplus")[0] as HTMLElement;
    const yBal = q(".ps-ybal")[0] as HTMLElement;
    const yAddr = q(".ps-yaddr")[0] as HTMLElement;
    const rBal = q(".ps-rbal")[0] as HTMLElement;
    const rAddr = q(".ps-raddr")[0] as HTMLElement;
    const receipt = q(".ppriv")[0] as HTMLElement;

    const state = { bal: BASE };

    if (reduced) {
      packet.style.display = "none";
      sendline.style.opacity = "1";
      plus.style.opacity = "1";
      receipt.style.opacity = "1";
      yBal.textContent = "$8,214";
      yAddr.textContent = Y_ADDR;
      rBal.textContent = fmt(BASE + AMOUNT);
      rAddr.textContent = R_ADDR;
      netcap.textContent = TX_ID;
      return;
    }

    // — encrypt/decrypt text driver: scrambles whenever the target flips —
    const timers = new Map<HTMLElement, number>();
    const current = new Map<HTMLElement, string>();
    const scrambleTo = (el: HTMLElement, target: string) => {
      const old = timers.get(el);
      if (old) window.clearInterval(old);
      let frame = 0;
      const total = 11;
      const id = window.setInterval(() => {
        frame++;
        const resolved = Math.floor((frame / total) * target.length);
        let out = "";
        for (let i = 0; i < target.length; i++) {
          out += i < resolved ? target[i] : SCRAMBLE[(Math.random() * SCRAMBLE.length) | 0];
        }
        el.textContent = out;
        if (frame >= total) {
          window.clearInterval(id);
          timers.delete(el);
          el.textContent = target;
        }
      }, 38);
      timers.set(el, id);
    };
    const apply = (el: HTMLElement, target: string, live = false) => {
      const prev = current.get(el);
      if (prev === target) {
        // live values (the counting balance) update in place while decrypted
        if (live && !timers.has(el)) el.textContent = target;
        return;
      }
      current.set(el, target);
      scrambleTo(el, target);
    };

    const mobile = window.matchMedia("(max-width: 639px)");
    const scene = root.closest<HTMLElement>(".scene");
    let tl: gsap.core.Timeline | null = null;
    let scrambleAt = 0;

    // — the coin: a fake-3D gold disc on canvas. Materialize/dissolve and
    // glitch amounts are tweened INSIDE the scrubbed timeline (so they run
    // backward with scroll); only the spin is ambient wall-clock, like the
    // rail's flowing stripes. —
    const coin = coinRef.current!;
    const cctx = coin.getContext("2d")!;
    const off = document.createElement("canvas");
    const octx = off.getContext("2d")!;
    const glyph = new Path2D(GLYPH_PATH);
    const fx = { mat: 0, glitch: 0 };
    // deterministic per-cell hash so pixels materialize in a stable order
    const cellH = (a: number, b: number) => {
      const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
      return s - Math.floor(s);
    };
    const sizeCoin = () => {
      const px = packet.offsetWidth || 46;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      coin.width = off.width = Math.round(px * dpr);
      coin.height = off.height = Math.round(px * dpr);
    };
    const drawCoin = (now: number, travelP: number) => {
      const W = coin.width;
      const H = coin.height;
      cctx.clearRect(0, 0, W, H);
      if (fx.mat <= 0.002 || W === 0) return;

      // face pass: spinning disc with the glyph, gold like the card's chip
      octx.clearRect(0, 0, W, H);
      const R = W * 0.42;
      const th = now * 2.6 + travelP * 7;
      const c = Math.cos(th);
      const sN = Math.sin(th);
      const rx = Math.max(R * 0.1, R * Math.abs(c));
      const dir = sN >= 0 ? 1 : -1;
      const d = R * 0.38 * Math.abs(sN); // projected thickness
      octx.save();
      octx.translate(W / 2, H / 2);
      // reeded edge: stacked ellipses from the back face forward
      const steps = Math.max(1, Math.round(d));
      for (let i = steps; i >= 0; i--) {
        octx.beginPath();
        octx.ellipse(dir * (d / 2 - i), 0, rx, R, 0, 0, Math.PI * 2);
        octx.fillStyle = i % 4 < 2 ? "#8a682a" : "#aa862f";
        octx.fill();
      }
      octx.translate(dir * (d / 2), 0);
      const g = octx.createLinearGradient(-rx, 0, rx, 0);
      g.addColorStop(0, c >= 0 ? "#e8cf8a" : "#caa652");
      g.addColorStop(0.5, "#c9a24f");
      g.addColorStop(1, c >= 0 ? "#b98f3e" : "#e3c87f");
      octx.fillStyle = g;
      octx.beginPath();
      octx.ellipse(0, 0, rx, R, 0, 0, Math.PI * 2);
      octx.fill();
      octx.lineWidth = Math.max(1.5, R * 0.1);
      octx.strokeStyle = "rgba(90, 70, 20, 0.55)";
      octx.stroke();
      octx.beginPath();
      octx.ellipse(0, 0, rx * 0.76, R * 0.76, 0, 0, Math.PI * 2);
      octx.lineWidth = Math.max(1, R * 0.045);
      octx.strokeStyle = "rgba(90, 70, 20, 0.3)";
      octx.stroke();
      // two faces so the rotation reads: glyph on the front, $ on the back
      // (the back is mirrored, like a real coin turning over)
      octx.save();
      if (c >= 0) {
        octx.scale(rx / R, 1);
        const s = (R * 1.06) / 256;
        octx.translate(-R * 0.53, -R * 0.53);
        octx.scale(s, s);
        octx.fillStyle = "rgba(80, 60, 16, 0.8)";
        octx.fill(glyph);
      } else {
        octx.scale(-rx / R, 1);
        octx.font = `800 ${Math.round(R * 1.3)}px "Hanken Grotesk", sans-serif`;
        octx.textAlign = "center";
        octx.textBaseline = "middle";
        octx.fillStyle = "rgba(80, 60, 16, 0.8)";
        octx.fillText("$", 0, R * 0.06);
      }
      octx.restore();
      // specular sweep
      octx.beginPath();
      octx.ellipse(-rx * 0.3, -R * 0.38, rx * 0.5, R * 0.26, -0.5, 0, Math.PI * 2);
      octx.fillStyle = "rgba(255, 255, 255, 0.2)";
      octx.fill();
      octx.restore();

      // pixel pass: cells appear/disappear in hash order as mat scrubs 0↔1
      if (fx.mat >= 0.998) {
        cctx.drawImage(off, 0, 0);
      } else {
        const cell = Math.max(3, Math.round(W / 11));
        for (let y = 0; y < H; y += cell) {
          for (let x = 0; x < W; x += cell) {
            if (cellH(x / cell, y / cell) < fx.mat) {
              cctx.drawImage(off, x, y, cell, cell, x, y, cell, cell);
            }
          }
        }
      }

      // glitch pass: twitchy band tears + a red echo while on the wire
      if (fx.glitch > 0.05) {
        const step = Math.floor(now * 11);
        if (cellH(step, 7) < 0.55) {
          const bandY = Math.floor(cellH(step, 3) * H * 0.8);
          const bandH = Math.max(2, Math.round(H * 0.16));
          const dx = (cellH(step, 5) - 0.5) * W * 0.26 * fx.glitch;
          cctx.drawImage(coin, 0, bandY, W, bandH, dx, bandY, W, bandH);
          cctx.save();
          cctx.globalCompositeOperation = "source-atop";
          cctx.globalAlpha = 0.3 * fx.glitch;
          cctx.fillStyle = "#e84142";
          cctx.fillRect(0, bandY, W, bandH);
          cctx.restore();
        }
        cctx.save();
        cctx.globalAlpha = 0.18 * fx.glitch;
        cctx.drawImage(off, W * 0.05, 0);
        cctx.restore();
      }
    };

    // film mode: on phones each act gets its own screen — sender, network,
    // receiver — crossfaded by the same scrubbed timeline
    const vYou = q(".pcard-you")[0] as HTMLElement;
    const vRail = q(".prail")[0] as HTMLElement;
    const vMaria = q(".pcard-maria")[0] as HTMLElement;
    const XFADE = 0.15; // handoff fade width, in timeline seconds
    let film = false;
    const setView = (el: HTMLElement, enter: number, exit: number) => {
      el.style.opacity = String(Math.min(enter, 1 - exit));
      el.style.transform = `translateY(${((1 - enter) * 28 - exit * 28).toFixed(1)}px)`;
    };

    const build = () => {
      film = mobile.matches;
      root.classList.toggle("psend--film", film);
      if (!film) {
        for (const el of [vYou, vRail, vMaria]) {
          el.style.removeProperty("opacity");
          el.style.removeProperty("transform");
        }
      }
      tl?.kill();
      gsap.set(packet, { x: 0, y: 0 });
      fx.mat = 0;
      fx.glitch = 0;
      sizeCoin();
      gsap.set([plus, receipt], { opacity: 0, y: 6 });
      gsap.set(sendline, { opacity: 0 });

      const vertical = mobile.matches;
      const PAD = 28;
      const dist = vertical
        ? track.clientHeight - packet.offsetHeight - PAD * 2
        : track.clientWidth - packet.offsetWidth - PAD * 2;
      const travel = vertical ? { y: dist } : { x: dist };

      tl = gsap
        .timeline({ paused: true })
        .to(sendline, { opacity: 1, duration: 0.4 })
        // the coin materializes pixel by pixel…
        .to(fx, { mat: 1, duration: 0.4, ease: "power1.inOut" }, "+=0.2")
        .addLabel("flightStart", "+=0.2")
        // …glitches while it rides the wire…
        .to(fx, { glitch: 1, duration: 0.35 }, "flightStart")
        .to(packet, { ...travel, duration: 1.7, ease: "power1.inOut" }, "flightStart")
        .to(fx, { glitch: 0, duration: 0.3 }, ">-0.3")
        .addLabel("flightEnd")
        // …and dissolves back into pixels on arrival
        .to(fx, { mat: 0, duration: 0.35, ease: "power1.in" })
        .addLabel("reveal")
        .to(plus, { opacity: 1, y: 0, duration: 0.45, ease: "power3.out" }, "<+=0.1")
        .to(state, { bal: BASE + AMOUNT, duration: 0.6, ease: "power2.out" }, "<")
        .to(receipt, { opacity: 1, y: 0, duration: 0.4 }, "-=0.2")
        .to({}, { duration: 0.55 }) // dwell while decrypted
        .addLabel("sealBack")
        .to(plus, { opacity: 0, duration: 0.35 }, "sealBack")
        .to({}, { duration: 0.45 }); // tail
      return tl;
    };

    build();

    const update = () => {
      if (!tl || !scene) return;
      const sp = parseFloat(scene.style.getPropertyValue("--sp") || "0");
      const p = Math.max(0, Math.min(1, (sp - 0.04) / 0.9));
      tl.progress(p, false);

      const t = tl.time();
      const L = tl.labels;
      const flightSpan = Math.max(0.001, L.flightEnd - L.flightStart);
      drawCoin(performance.now() / 1000, Math.max(0, Math.min(1, (t - L.flightStart) / flightSpan)));
      // in film mode the sender encrypts as its screen starts to hand off,
      // so the scramble is still on screen when the money departs
      const senderClear = t < L.flightStart - (film ? 2 * XFADE : 0);
      const receiverClear = t >= L.reveal && t < L.sealBack;

      if (film) {
        // sequential fades, never a cross-dissolve: the scrub can park at any
        // point, and two half-faded screens stacked up read as a glitch
        const ramp = (a: number, b: number) => Math.max(0, Math.min(1, (t - a) / (b - a)));
        setView(vYou, 1, ramp(L.flightStart - 2 * XFADE, L.flightStart - XFADE));
        setView(vRail, ramp(L.flightStart - XFADE, L.flightStart), ramp(L.flightEnd, L.flightEnd + XFADE));
        setView(vMaria, ramp(L.flightEnd + XFADE, L.reveal), 0);
      }

      apply(yBal, senderClear ? "$8,214" : MASK_BAL);
      apply(yAddr, senderClear ? Y_ADDR : MASK_ADDR);
      apply(rBal, receiverClear ? fmt(state.bal) : MASK_BAL, true);
      apply(rAddr, receiverClear ? R_ADDR : MASK_ADDR);

      if (t > L.flightStart && t < L.flightEnd) {
        const now = performance.now();
        if (now - scrambleAt > 70) {
          scrambleAt = now;
          let s = "0x";
          for (let i = 0; i < 8; i++) s += HEX[(Math.random() * HEX.length) | 0];
          netcap.textContent = s;
        }
        current.set(netcap, "");
      } else if (t <= L.flightStart) {
        apply(netcap, IDLE_TX);
      } else {
        apply(netcap, receiverClear ? TX_ID : MASK_TX);
      }
    };
    gsap.ticker.add(update);

    const onBreak = () => build();
    mobile.addEventListener("change", onBreak);

    return () => {
      gsap.ticker.remove(update);
      mobile.removeEventListener("change", onBreak);
      tl?.kill();
      timers.forEach((id) => window.clearInterval(id));
    };
  }, []);

  return (
    <div ref={rootRef} className="psend-inner" aria-label="A private send, scrubbed by scroll">
      <div className="vault-intro psend-eyebrow">
        <span className="rule" />
        <span className="line">Sent over Avalanche</span>
        <span className="rule" />
      </div>
      <h2 className="psend-title display">Watch a send stay private.</h2>

      <div className="psend-stage">
        <div className="pcard pcard-you">
          <span className="pname">You</span>
          <span className="pbal display tnum ps-ybal">$8,214</span>
          <span className="paddr tnum ps-yaddr">{Y_ADDR}</span>
          <span className="psending">
            Sending <b>$120</b> to @maria
          </span>
        </div>

        <div className="prail">
          <div className="rail-track">
            <svg className="rail-logo" viewBox="0 0 639 564" aria-hidden="true">
              <path
                d="M399.885 563.465H613.609C632.467 563.465 644.269 543.041 634.827 526.718L527.966 341.641C518.524 325.318 494.97 325.318 485.529 341.641L378.667 526.718C369.226 543.041 381.027 563.465 399.885 563.465Z"
                fill="#fff"
              />
              <path
                d="M426.609 166.12L338.779 13.9644C329.909 -1.41521 307.697 -1.41521 298.827 13.9644L3.43383 525.589C-6.28089 542.435 5.86872 563.454 25.2982 563.454H201.182C219.94 563.454 237.258 553.441 246.625 537.217L426.609 225.477C437.218 207.116 437.218 184.481 426.609 166.12Z"
                fill="#fff"
              />
            </svg>
            <div className="packet">
              <canvas ref={coinRef} className="coin" aria-hidden="true" />
            </div>
          </div>
          <div className="rail-caption">
            What the network sees <span className="rail-cipher tnum">{IDLE_TX}</span>
          </div>
        </div>

        <div className="pcard pcard-maria">
          <span className="pname">@maria</span>
          <span className="pbal display tnum ps-rbal">{MASK_BAL}</span>
          <span className="paddr tnum ps-raddr">{MASK_ADDR}</span>
          <span className="pplus display tnum">+$120</span>
          <span className="ppriv">✓ Private receipt saved</span>
        </div>
      </div>
    </div>
  );
}
