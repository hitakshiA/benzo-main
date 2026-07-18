/**
 * Central consumer copy for the wallet's shared layer. One voice, one file, so
 * the privacy vocabulary (A), the amount / denomination context (A3), and the
 * send-ceremony processing copy (D) never drift into scattered string literals.
 *
 * Rules of the house:
 *   • Say "Private on-chain", never the absolute "Only you can see this".
 *   • Cryptographic nouns (witness, prover, circuit, block height) live behind an
 *     "Advanced details" disclosure, the everyday copy stays plain English.
 *   • Nothing here claims a payment is reversible or that test funds are real.
 */
export const COPY = {
  // ---------------------------------------------------------------- privacy
  /** The ambient privacy chip everywhere (replaces "Only you can see this"). */
  privateOnChain: "Private on-chain",
  /** Under the balance, what "private" means for the figure above it. */
  balancePrivacy: "Your balance is hidden from the public blockchain and visible in your wallet",
  /** A settled/queued payment between two Benzo users. */
  paymentPrivacy: (name: string) =>
    `You and ${name} can view this in Benzo; the amount and recipient are hidden from the public blockchain`,
  /** Deposits / receive. */
  depositPrivacy: "Deposits move into your private balance after confirmation",
  /** Received balance chip on the Receive screen. */
  receivedPrivate: "Received balance stays private",
  /** What a shared proof reveals (and what it doesn't). */
  proofPrivacy: "Verifiable on-chain without exposing the private details",

  // ---------------------------------------------------------------- send flow
  /** Confirmation reality, no "instant/undo" hand-waving. */
  irreversible: "This payment cannot be reversed after submission",
  /** Proof-of-balance / proof-of-funds entry point. */
  createProofOfFunds: "Create proof of funds",
  /** Where proving happens (the honest, non-jargon version). */
  proofOnDevice: "Proof generation · On this device",
  /** Settings row label, the environment is the "Network", never the "Mode". */
  networkLabel: "Network",

  // ------------------------------------------------------ send ceremony (D)
  // Consumer-facing stage copy. The honest state machine still drives WHICH stage
  // is on screen; this only supplies the words. Cryptographic detail is deferred
  // to the ceremony's "Advanced details" disclosure.
  ceremony: {
    /** proving / building → "encrypt" */
    preparing: {
      title: "Preparing your private payment",
      sub: "Creating your proof on this device",
    },
    /** submitting → "settle" (sub is network-aware) */
    confirming: {
      title: "Waiting for confirmation",
      sub: (network: string) => `${network} is confirming`,
    },
    /** confirmed → "verify" */
    complete: {
      title: "Payment complete",
      sub: "Here's your receipt",
    },
    /** failed → "error" (the sub comes from the real error on state) */
    failed: {
      title: "Couldn't send",
    },
    /** Label for the disclosure that hides witness / prover / proof-time / block. */
    advancedDetails: "Advanced details",
  },
} as const;
