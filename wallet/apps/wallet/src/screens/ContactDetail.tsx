/**
 * Contact detail, view-first (critique #57). Opens showing WHO this is: name, handle,
 * and address as separate read-only rows, quick Pay / Request, and the payment history
 * with them. Editing is behind an explicit Edit affordance; Remove is a red, confirmed
 * action and only offered for locally-saved contacts (a BFF-managed contact can't be
 * removed from the device).
 */
import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowDownLeft, Clock, Pencil, Send as SendIcon, Trash2 } from "lucide-react";
import { useWallet } from "../lib/store";
import { listLocal, mergeContacts, normAddress, removeLocalContact, upsertLocalContact } from "../lib/contacts";
import { Screen, Stagger } from "../ui/motion";
import { ScreenHeader } from "../ui/chrome";
import { Avatar, Button, Card, EmptyState, Input, useToast } from "../ui/primitives";
import { ActivityItem } from "../ui/ActivityItem";

/** Compact, human label for a handle/address/receive-code. */
function handleLabel(handle: string): string {
  if (handle.startsWith("bzr_")) return `${handle.slice(0, 10)}…${handle.slice(-8)}`;
  if (handle.length > 24) return `${handle.slice(0, 8)}…${handle.slice(-8)}`;
  return handle;
}

/** Accept an EVM address, a `bzr_` receive code, or an `@handle`. */
function isValidContactHandle(raw: string): boolean {
  const t = raw.trim();
  if (!t) return false;
  if (normAddress(t)) return true;
  return /^@?[a-z0-9_]{2,30}$/i.test(t);
}

/** Bare handles gain their `@`; addresses / receive codes stay verbatim. */
function normalizeSavedHandle(raw: string): string {
  const t = raw.trim();
  if (normAddress(t)) return t;
  if (t.startsWith("@")) return t;
  return `@${t.replace(/^@/, "")}`;
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-0.5">
      <span className="flex-none text-[13px] text-muted">{label}</span>
      <span className={`min-w-0 truncate text-[13.5px] font-medium text-ink ${mono ? "font-mono text-[12.5px]" : ""}`}>{value}</span>
    </div>
  );
}

export function ContactDetail() {
  const nav = useNavigate();
  const toast = useToast();
  const { handle: handleParam = "" } = useParams();
  const { contacts: bff, history, hidden } = useWallet();
  const [version, bump] = useState(0);
  const [editing, setEditing] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const contact = useMemo(
    () => mergeContacts(bff).find((c) => c.handle === handleParam),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bff, handleParam, version],
  );

  // Only a locally-saved contact can be edited / removed from this device; a
  // BFF-managed contact is server-owned, so we don't offer (or fake) a remove.
  const isLocal = useMemo(
    () => !!contact && listLocal().some((c) => c.handle === contact.handle),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [contact, version],
  );

  const [name, setName] = useState(() => contact?.name ?? "");
  const [handle, setHandle] = useState(() => contact?.handle ?? "");

  // ActivityRow only carries a display `name`, so match history to this person by
  // the name it was recorded under OR the handle label, matching on both survives
  // contacts saved without a name (rows keyed by handle) and isn't tied to the live
  // edit field, so history doesn't blank while you're typing a new name.
  const rows = useMemo(() => {
    if (!contact) return [];
    const keys = new Set([contact.name.toLowerCase(), handleLabel(contact.handle).toLowerCase(), contact.handle.toLowerCase()]);
    return history.filter((r) => keys.has((r.name ?? "").toLowerCase()));
  }, [history, contact]);

  const validHandle = isValidContactHandle(handle);
  const dirty = !!contact && (name.trim() !== contact.name || normalizeSavedHandle(handle) !== contact.handle);

  function save() {
    if (!contact || !validHandle) return;
    const nextHandle = normalizeSavedHandle(handle);
    const nextName = name.trim() || contact.name;
    upsertLocalContact(contact.handle, nextHandle, nextName);
    toast({ title: "Contact updated.", tone: "success" });
    setEditing(false);
    if (nextHandle !== contact.handle) {
      nav(`/contacts/${encodeURIComponent(nextHandle)}`, { replace: true });
    } else {
      bump((v) => v + 1);
    }
  }

  function remove() {
    if (!contact || !isLocal) return;
    removeLocalContact(contact.handle);
    toast({ title: "Contact removed from this device." });
    nav("/contacts", { replace: true });
  }

  if (!contact) {
    return (
      <Screen>
        <ScreenHeader title="Contact" />
        <div className="px-8 py-20 text-center" data-testid="contact-detail-missing">
          <div className="text-[14px] text-muted">This contact isn't saved on this device.</div>
          <Button variant="secondary" size="sm" className="mt-4" onClick={() => nav("/contacts")}>
            Back to contacts
          </Button>
        </div>
      </Screen>
    );
  }

  const isAddress = !!normAddress(contact.handle);
  const isHandle = contact.handle.startsWith("@");

  return (
    <Screen>
      <ScreenHeader title={contact.name} />
      <Stagger className="space-y-4 px-5 pb-10 pt-1" data-testid="contact-detail">
        {/* Identity + quick actions */}
        <Stagger.Item index={0}>
          <Card className="p-4">
            <div className="flex items-center gap-3">
              <Avatar name={contact.name} tone={contact.tone} size={48} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[17px] font-semibold">{contact.name}</div>
                <div className="truncate text-[13px] text-muted">{handleLabel(contact.handle)}</div>
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              <Button size="sm" className="flex-1" onClick={() => nav(`/send?to=${encodeURIComponent(contact.handle)}`)} data-testid="contact-detail-pay">
                <SendIcon size={15} /> Pay
              </Button>
              <Button size="sm" variant="secondary" className="flex-1" onClick={() => nav(`/request?to=${encodeURIComponent(contact.handle)}`)} data-testid="contact-detail-request">
                <ArrowDownLeft size={15} /> Request
              </Button>
            </div>
          </Card>
        </Stagger.Item>

        {/* Details, view-first, separated read-only rows; Edit reveals the fields. */}
        <Stagger.Item index={1}>
          <Card className="p-4" data-testid="contact-detail-details">
            <div className="flex items-center justify-between">
              <div className="text-[12px] font-bold uppercase tracking-[0.05em] text-muted">Details</div>
              {isLocal && !editing ? (
                <button
                  onClick={() => setEditing(true)}
                  className="inline-flex items-center gap-1 rounded text-[13px] font-semibold text-accent outline-none transition hover:opacity-80 focus-visible:ring-2 focus-visible:ring-accent/40"
                  data-testid="contact-detail-edit-toggle"
                >
                  <Pencil size={13} /> Edit
                </button>
              ) : null}
            </div>
            {!editing ? (
              <div className="mt-3 space-y-1.5">
                <DetailRow label="Name" value={contact.name} />
                {isHandle ? <DetailRow label="Handle" value={contact.handle} /> : null}
                {isAddress ? <DetailRow label={contact.handle.startsWith("bzr_") ? "Receive code" : "Address"} value={handleLabel(contact.handle)} mono /> : null}
              </div>
            ) : (
              <div className="mt-3 space-y-3" data-testid="contact-detail-edit">
                <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} data-testid="contact-detail-name" />
                <Input
                  label="Address, Receive Code, or @handle"
                  value={handle}
                  onChange={(e) => setHandle(e.target.value)}
                  data-testid="contact-detail-handle"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  error={handle && !validHandle ? "Enter a valid address, receive code, or @handle." : undefined}
                />
                <div className="flex gap-2">
                  <Button size="sm" onClick={save} disabled={!validHandle || !dirty} data-testid="contact-detail-save">
                    Save changes
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setEditing(false);
                      setName(contact.name);
                      setHandle(contact.handle);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </Stagger.Item>

        {/* Remove, red, confirmed, local contacts only. */}
        {isLocal ? (
          <Stagger.Item index={2}>
            {!confirmRemove ? (
              <button
                onClick={() => setConfirmRemove(true)}
                className="inline-flex items-center gap-1.5 rounded-lg px-1 py-1 text-[13.5px] font-semibold text-danger outline-none transition hover:opacity-80 focus-visible:ring-2 focus-visible:ring-danger/40"
                data-testid="contact-detail-remove"
              >
                <Trash2 size={15} /> Remove contact
              </button>
            ) : (
              <Card className="border-danger/30 bg-danger/[0.04] p-4" data-testid="contact-detail-remove-confirm">
                <div className="text-[14px] font-semibold text-ink">Remove {contact.name}?</div>
                <div className="mt-1 text-[13px] text-muted">This only removes them from this device's contacts, your payment history stays.</div>
                <div className="mt-3 flex gap-2">
                  <Button variant="danger" size="sm" onClick={remove} data-testid="contact-detail-remove-confirm-yes">
                    Remove
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setConfirmRemove(false)}>
                    Cancel
                  </Button>
                </div>
              </Card>
            )}
          </Stagger.Item>
        ) : null}

        {/* Payment history with this person. */}
        <Stagger.Item index={3}>
          <div>
            <div className="px-1 pb-1 text-[12px] font-bold uppercase tracking-[0.05em] text-muted">Payments with {contact.name}</div>
            {rows.length === 0 ? (
              <Card>
                <EmptyState icon={<Clock size={26} />} title="No payments yet" hint={`Money you send or receive with ${contact.name} shows up here.`} />
              </Card>
            ) : (
              <Card className="px-4" data-testid="contact-detail-history">
                {rows.map((row, i) => (
                  <ActivityItem key={row.id} row={row} hidden={hidden} last={i === rows.length - 1} />
                ))}
              </Card>
            )}
          </div>
        </Stagger.Item>
      </Stagger>
    </Screen>
  );
}
