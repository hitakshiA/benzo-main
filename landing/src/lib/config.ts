export const WALLET_URL = import.meta.env.VITE_WALLET_URL ?? "https://wallet.benzo.space";
export const CONSOLE_URL = import.meta.env.VITE_CONSOLE_URL ?? "https://console.benzo.space";

export const SOCIALS = {
  x: "https://x.com/b3nz0X",
  github: "https://github.com/Miny-Labs",
  linkedin: "https://www.linkedin.com/in/hitakshiaroraa/",
};

/** Avalanche Fuji testnet explorer; point at the pool contract once deployed. */
export const EXPLORER_URL = "https://explorer.benzo.space";

/** Fired when a door CTA is clicked; TransitionWave listens and navigates. */
export const LEAVE_EVENT = "benzo:leave";
/** fired by the door card so the balance uncensors while either side is hovered */
export const BALANCE_EVENT = "benzo:balance";

/** The hero cover line. */
export const HEADLINE = "Private like cash. Fast like crypto.";

/** Benzo brand glyph. */
export const GLYPH_PATH =
  "M 64 128 L 64.5 128 L 32 95 L 0 64 L 0 0 L 64 0 L 128 64 L 128 64.5 L 161 32 L 192 0 L 256 0 L 256 64 L 192 128 L 128 128 L 128 192 L 96 223 L 63.5 256 L 0 256 L 0 192 Z M 256 192 L 224 223 L 191.5 256 L 128 256 L 128 192 L 192 128 L 256 128 Z";

export const GALLERY_IMAGES = Array.from({ length: 10 }, (_, i) => ({
  src: `/gallery/${String(i + 1).padStart(2, "0")}.webp`,
  alt: [
    "A sealed cream envelope with a violet wax seal",
    "A receipt with its lines quietly redacted",
    "A pay envelope with banknotes tucked inside",
    "A stack of invoices tied with violet ribbon",
    "A single coin standing on its edge",
    "A small padlock resting on folded ledger pages",
    "Two coffee cups with a folded note between them",
    "A paper crane standing among scattered coins",
    "A linen curtain drawn across a bright window",
    "A tiny cream safe with a violet dial, slightly open",
  ][i],
  caption: [
    "Your salary",
    "Your receipts",
    "Your payday",
    "Your invoices",
    "Your savings",
    "Your balance",
    "Your dinner split",
    "Your gifts",
    "Your home",
    "Your books",
  ][i],
}));
