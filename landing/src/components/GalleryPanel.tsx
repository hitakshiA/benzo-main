import { forwardRef, useMemo, useSyncExternalStore } from "react";
import PrivateSend from "./PrivateSend";
import { GALLERY_IMAGES } from "../lib/config";

/**
 * Scattered-grid layout (structure from the archive spec):
 * row r puts an image at column (r*2 + r%2) % cols; every 3rd row gets a
 * second image two columns over. Everything else stays empty air.
 */
export function buildLayout(count: number, cols: number): number[] {
  const cells: number[] = [];
  let placed = 0;
  for (let r = 0; placed < count; r++) {
    const row = new Array<number>(cols).fill(-1);
    const a = (r * 2 + (r % 2)) % cols;
    row[a] = placed++;
    if (r % 3 === 0 && placed < count) {
      let b = (a + 2) % cols;
      if (b === a) b = (a + 1) % cols;
      row[b] = placed++;
    }
    cells.push(...row);
  }
  return cells;
}

function subscribeCols(cb: () => void) {
  const m1 = window.matchMedia("(max-width: 639px)");
  const m2 = window.matchMedia("(max-width: 1023px)");
  m1.addEventListener("change", cb);
  m2.addEventListener("change", cb);
  return () => {
    m1.removeEventListener("change", cb);
    m2.removeEventListener("change", cb);
  };
}
function getCols() {
  if (window.matchMedia("(max-width: 639px)").matches) return 2;
  if (window.matchMedia("(max-width: 1023px)").matches) return 3;
  return 4;
}

type Props = { wrapRef: React.Ref<HTMLDivElement> };

/* the ghost numerals are Roman: plain upright bars, drawn as outlines —
   no curves, no font-glyph notches, just strokes in the pixel language */
function Ghost({ num }: { num: string }) {
  const n = Math.max(1, parseInt(num, 10) || 1);
  const BAR = 24;
  const STEP = 52;
  const width = (n - 1) * STEP + BAR + 20;
  return (
    <svg className="ghost" viewBox={`0 0 ${width} 140`} aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <path key={i} d={`M${10 + i * STEP},10 H${10 + i * STEP + BAR} V130 H${10 + i * STEP} Z`} />
      ))}
    </svg>
  );
}

const STEPS = [
  {
    num: "01",
    verb: "Shield it.",
    sub: "Deposit public USDC and it becomes an encrypted balance only your key can open. On-chain, what you hold stops being anyone's business.",
  },
  {
    num: "02",
    verb: "Send it quietly.",
    sub: "Pay an @handle like you'd text a friend, payroll and invoices too. The amount stays between the two of you.",
  },
  {
    num: "03",
    verb: "Prove what you choose.",
    sub: "Show someone a single payment or balance. A proof reveals just that number, and everything else stays sealed.",
  },
];

/**
 * The vault: a sequence of full-screen scenes, Apple-keynote style. Each
 * .scene is a tall section whose .scene-pin (100vh stage) the scroll engine
 * pins to the viewport, fades in on arrival, feeds a --sp progress while
 * pinned, and lifts away at the end. The card grid between scenes flows
 * freely with its own scale choreography.
 */
const GalleryPanel = forwardRef<HTMLDivElement, Props>(function GalleryPanel({ wrapRef }, panelRef) {
  const cols = useSyncExternalStore(subscribeCols, getCols, () => 4);
  const cells = useMemo(() => buildLayout(GALLERY_IMAGES.length, cols), [cols]);
  // On phones the three stage scenes collapse into one screen — full-bleed
  // ghost numerals don't earn three viewports of scroll on a 400px canvas.
  const phone = cols === 2;

  return (
    <div ref={panelRef} className="vault" role="region" aria-label="What stays private">
      <div ref={wrapRef} className="vault-wrap">
        <section className="scene scene-send">
          <div className="scene-pin">
            <PrivateSend />
          </div>
        </section>

        <section className="scene scene-statement">
          <div className="scene-pin">
            <p className="statement display">
              Nobody's business
              <br />
              but yours.
            </p>
          </div>
        </section>

        <div className="vault-grid">
          {cells.map((idx, i) => {
            if (idx === -1) return <div key={i} className="vault-cell" aria-hidden="true" />;
            const col = i % cols;
            const origin = col < cols / 2 ? "right bottom" : "left bottom";
            const img = GALLERY_IMAGES[idx];
            return (
              <div key={i} className="vault-cell">
                <div className="bp-card" style={{ transformOrigin: origin }}>
                  <img src={img.src} alt={img.alt} loading="lazy" draggable={false} />
                </div>
                <span className={`cell-tag ${col < cols / 2 ? "side-right" : "side-left"}`}>
                  <span className="tag-num">{String(idx + 1).padStart(2, "0")}</span>
                  {img.caption}
                </span>
              </div>
            );
          })}
        </div>

        {phone ? (
          <section className="scene scene-stepstack">
            <div className="scene-pin">
              <div className="steps-stack">
                {STEPS.map((s) => (
                  <div className="stack-row" key={s.num}>
                    <span className="stack-num tnum">{s.num}</span>
                    <h2 className="stack-verb display">{s.verb}</h2>
                    <p className="stack-sub">{s.sub}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>
        ) : (
          STEPS.map((s, i) => (
            <section key={s.num} className="scene scene-stage">
              <div className="scene-pin">
                <div className="stage-step step">
                  {i === 0 && (
                    <div className="vault-intro stage-eyebrow">
                      <span className="rule" />
                      <span className="line">Private, yet provable</span>
                      <span className="rule" />
                    </div>
                  )}
                  <Ghost num={s.num} />
                  <h2 className="stage-verb display">{s.verb}</h2>
                  <p className="stage-sub">{s.sub}</p>
                </div>
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
});

export default GalleryPanel;
