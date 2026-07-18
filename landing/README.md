# Benzo landing page

Scroll-driven landing page for [Benzo](https://github.com/Miny-Labs), private USDC payments on Avalanche.
The protocol, wallet, and console live in the team's protocol repo.

## How the page works

One continuous scroll, three scenes:

1. **The sky.** The brand's hydrangea-sky film plays full bleed in a palindrome loop: the 12-second
   cut forward, then the same film reversed, so it never jump-cuts. The hero reads "Private like
   cash. Fast like crypto." with the two doors right under it, and hovering the masked `$•••••`
   balance de-scrambles it into a demo amount. Scrolling "encrypts" the film itself: a canvas pass
   resamples the video into chunkier mosaic blocks with ink and violet cipher cells as the vault rises.
2. **The vault.** After one viewport of scroll, a deep-ink panel slides over the sky. Inside it,
   still lifes of things that are nobody's business scale in and out, each captioned in the empty
   space beside it. The images were generated with gpt-image-2, style-anchored to a frame of the sky
   film so the whole page reads as one world. Hovering the SHIELD / SEND / PROVE rows reveals a
   matching still that glides after the cursor. The vault closes with a looping demo of a private
   send: the payment crosses an Avalanche-red rail as a ciphered packet the network can't read, and
   unseals only on the recipient's card.
3. **The footer.** An ink slide with an animated dot band, nav columns, and an oversized wordmark.
   Clicking a door plays a short send-off: the label rewrites itself to "Opening privately…", petals
   scatter from the click point, and a violet wave sweeps up before the browser navigates to the
   under-construction page at `/construction` while the apps are still being built.

The header and balance chrome use `mix-blend-mode: exclusion`, which is why the same white type reads
sepia over the sky and cream over the vault.

## Stack

React 19, TypeScript, Vite 6, Tailwind CSS v4, GSAP (ScrollTrigger + TextPlugin), Motion 12.

Every visible layer is `position: fixed`; a spacer div defines the scroll length. A single
`gsap.ticker` loop drives card scaling, wrap translation, header fades, and the footer slide. The
vault entrance is a scrubbed ScrollTrigger.

## Run

```bash
pnpm install
pnpm dev        # http://localhost:5173
pnpm build      # typecheck + production build to dist/
```

Optional env (defaults point at production): `VITE_WALLET_URL`, `VITE_CONSOLE_URL`.

## Assets

- `public/media/sky.mp4` and `sky-rev.mp4`: the brand film, re-encoded with a keyframe every six
  frames so seeking stays cheap, plus a reversed copy for the loop.
- `public/gallery/*.webp`: ten 1024x1536 stills in one visual family (cream paper, violet accents,
  soft morning light).

Reduced motion is respected throughout: no autoplay, no card scaling, no ceremony. The doors become
plain links.
