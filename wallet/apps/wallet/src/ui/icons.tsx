/**
 * Shared iconography. The app previously mixed an up-right arrow and a paper-plane
 * for "Send"; this is the ONE Send glyph, a paper-plane, used everywhere (the
 * FAB, Home's action row, confirm CTAs, contact "Pay"). 22–24px, consistent
 * stroke. Wraps lucide's `Send` so a future swap is one edit.
 */
import { Send } from "lucide-react";

export function SendGlyph({ size = 22, className = "" }: { size?: number; className?: string }) {
  return <Send size={size} className={className} aria-hidden />;
}
