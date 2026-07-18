/**
 * Activity - the full feed, grouped by day (Today / Yesterday / date). Filter
 * chips (All / Sent / Received / Deposits) and an optional search narrow it;
 * pull-down empty + skeleton states; everything in plain English. As a top-level
 * tab it shows no back button (critique #53).
 */
import { useMemo, useState } from "react";
import { Clock, Search } from "lucide-react";
import { useWallet } from "../lib/store";
import { dayBucket } from "../lib/format";
import { Screen, Stagger } from "../ui/motion";
import { ScreenHeader } from "../ui/chrome";
import { EmptyState } from "../ui/primitives";
import { ActivityItem, activityCategory } from "../ui/ActivityItem";
import type { ActivityRow } from "../lib/api";

type Filter = "all" | "sent" | "received" | "deposit";
const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "All" },
  { id: "sent", label: "Sent" },
  { id: "received", label: "Received" },
  { id: "deposit", label: "Deposits" },
];

export function Activity() {
  const { history, loading, hidden } = useWallet();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return history.filter((row) => {
      if (filter !== "all" && activityCategory(row) !== filter) return false;
      if (q && !`${row.name} ${row.note}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [history, filter, query]);

  const groups = useMemo(() => {
    const m = new Map<string, ActivityRow[]>();
    for (const row of filtered) {
      const k = dayBucket(row.timestamp);
      (m.get(k) ?? m.set(k, []).get(k)!).push(row);
    }
    return [...m.entries()];
  }, [filtered]);

  const hasHistory = history.length > 0;

  return (
    <Screen>
      {/* Activity is a top-level tab (reachable from the BottomNav and Home's
          "Activity" button), a top-level destination shows no back button. */}
      <ScreenHeader title="Activity" back={false} />
      <div className="px-5">
        {hasHistory ? (
          <>
            <div className="mt-1 flex items-center gap-2 rounded-full border border-hair bg-card px-3.5 py-2">
              <Search size={15} className="flex-none text-muted" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search name or note"
                aria-label="Search activity"
                data-testid="activity-search"
                className="w-full bg-transparent text-[14px] text-ink outline-none placeholder:text-muted"
              />
            </div>
            <div className="no-scrollbar -mx-1 mt-2.5 flex gap-2 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Filter activity">
              {FILTERS.map((f) => {
                const on = f.id === filter;
                return (
                  <button
                    key={f.id}
                    type="button"
                    role="tab"
                    aria-selected={on}
                    onClick={() => setFilter(f.id)}
                    data-testid={`activity-filter-${f.id}`}
                    className={`flex-none rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
                      on ? "bg-accent text-white shadow-[var(--shadow-glow)]" : "bg-ink/[0.05] text-muted hover:text-ink"
                    }`}
                  >
                    {f.label}
                  </button>
                );
              })}
            </div>
          </>
        ) : null}

        {loading ? (
          <div className="space-y-3 px-2 pt-4">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="skeleton h-10 w-10 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <div className="skeleton h-3.5 w-32 rounded" />
                  <div className="skeleton h-3 w-24 rounded" />
                </div>
                <div className="skeleton h-4 w-16 rounded" />
              </div>
            ))}
          </div>
        ) : !hasHistory ? (
          <EmptyState icon={<Clock size={28} />} title="No activity yet" hint="Money you send, receive, or add will show up here." />
        ) : groups.length === 0 ? (
          <EmptyState
            icon={<Search size={26} />}
            title="Nothing here"
            hint={query ? "No activity matches your search." : "No activity in this filter yet."}
          />
        ) : (
          groups.map(([label, rows], gi) => (
            <Stagger key={label} className="mb-2">
              <div className="px-1 pb-1 pt-3 text-[12px] font-bold uppercase tracking-[0.05em] text-muted">{label}</div>
              <div className="rounded-[var(--radius-compact)] bg-card px-4 shadow-[var(--shadow-card)]">
                {rows.map((row, i) => (
                  <Stagger.Item key={row.id} index={Math.min(gi * 2 + i, 6)}>
                    <ActivityItem row={row} hidden={hidden} last={i === rows.length - 1} />
                  </Stagger.Item>
                ))}
              </div>
            </Stagger>
          ))
        )}
        <div className="h-6" />
      </div>
    </Screen>
  );
}
