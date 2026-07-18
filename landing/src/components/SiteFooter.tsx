import { forwardRef } from "react";
import { motion } from "motion/react";
import { CONSOLE_URL, EXPLORER_URL, GLYPH_PATH, SOCIALS, WALLET_URL } from "../lib/config";
import { reveal } from "../lib/reveal";

/**
 * The last slide: a full-viewport footer in vault ink that slides up over the
 * gallery. Animated dot band, nav grid with the two doors, an oversized
 * wordmark row, and the legal line.
 */
const SiteFooter = forwardRef<HTMLDivElement>(function SiteFooter(_p, ref) {
  return (
    <footer ref={ref} className="site-footer">
      <div className="footer-dots" aria-hidden="true">
        <div className="footer-dots__line" />
      </div>

      <div className="site-footer__inner">
        <div className="site-footer__top">
          <motion.div className="site-footer__lead" {...reveal()}>
            <h2>Private money, for people and for teams.</h2>
          </motion.div>

          <motion.nav className="site-footer__nav" aria-label="Product" {...reveal(0.1)}>
            <a href={WALLET_URL}>
              Wallet <span className="fcta-arrow">↗</span>
            </a>
            <a href={CONSOLE_URL}>
              Console <span className="fcta-arrow">↗</span>
            </a>
            <a href={EXPLORER_URL} target="_blank" rel="noreferrer">
              Testnet explorer <span className="fcta-arrow">↗</span>
            </a>
          </motion.nav>

          <motion.nav className="site-footer__nav" aria-label="Company" {...reveal(0.18)}>
            <a href={SOCIALS.github} target="_blank" rel="noreferrer">
              GitHub <span className="fcta-arrow">↗</span>
            </a>
            <a href={SOCIALS.x} target="_blank" rel="noreferrer">
              Follow us on X <span className="fcta-arrow">↗</span>
            </a>
            <a href={SOCIALS.linkedin} target="_blank" rel="noreferrer">
              LinkedIn <span className="fcta-arrow">↗</span>
            </a>
          </motion.nav>
        </div>

        <motion.div className="site-footer__brand-row" {...reveal(0.15)}>
          <a className="site-footer__brand" href="/" aria-label="Benzo home">
            <span className="site-footer__mark" aria-hidden="true">
              <svg viewBox="0 0 256 256">
                <path d={GLYPH_PATH} />
              </svg>
            </span>
            <span className="site-footer__word display">Benzo</span>
          </a>
          <a className="avax-badge" href="https://www.avax.network" target="_blank" rel="noreferrer">
            <img src="/avax/powered-by-avalanche-red.svg" alt="Powered by Avalanche" />
          </a>
        </motion.div>

        <motion.div className="site-footer__legal" {...reveal(0.28)}>
          <p>© 2026 Benzo. Private by default.</p>
          <a href={SOCIALS.github} target="_blank" rel="noreferrer">
            Apache-2.0
          </a>
          <span className="live">
            <span className="dot" /> Live on Avalanche Fuji testnet
          </span>
        </motion.div>
      </div>
    </footer>
  );
});

export default SiteFooter;
