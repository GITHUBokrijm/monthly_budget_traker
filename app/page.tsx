"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@/database.types";

type TxnType = "expense" | "income";

type DbCategory = Tables<"categories">;
type DbTransaction = Tables<"transactions">;

type Txn = {
  id: string;
  date: string; // YYYY-MM-DD
  description: string;
  type: TxnType;
  amount: number; // positive
  categoryId: string | null;
};

type TxnWithCategory = Txn & { categoryName: string };

type TxnDraft = {
  date: string;
  description: string;
  categoryName: string;
  type: TxnType;
  amount: string; // keep as string for input UX
};

type TxnErrors = Partial<Record<keyof TxnDraft, string>>;

function clampToMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addMonths(d: Date, delta: number) {
  return new Date(d.getFullYear(), d.getMonth() + delta, 1);
}

function formatMonth(d: Date) {
  return new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(d);
}

function formatMoney(n: number) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function formatCompactMoney(n: number) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
    notation: "compact",
  }).format(n);
}

function formatShortDate(iso: string) {
  const d = new Date(`${iso}T00:00:00`);
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(d);
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function toISODate(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function daysInMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

function sum(nums: number[]) {
  let s = 0;
  for (const n of nums) s += n;
  return s;
}

function validateDraft(draft: TxnDraft): { ok: boolean; errors: TxnErrors } {
  const errors: TxnErrors = {};

  if (!draft.date) errors.date = "Date is required.";
  if (!draft.description.trim()) errors.description = "Description is required.";
  if (!draft.categoryName.trim()) errors.categoryName = "Category is required.";

  const amount = Number(draft.amount);
  if (!draft.amount.trim()) {
    errors.amount = "Amount is required.";
  } else if (!Number.isFinite(amount)) {
    errors.amount = "Amount must be a number.";
  } else if (amount <= 0) {
    errors.amount = "Amount must be greater than 0.";
  }

  return { ok: Object.keys(errors).length === 0, errors };
}

function monthRange(month: Date) {
  const start = new Date(month.getFullYear(), month.getMonth(), 1);
  const end = new Date(month.getFullYear(), month.getMonth() + 1, 0);
  return { startISO: toISODate(start), endISO: toISODate(end) };
}

function TrendChart({ month, expenses }: { month: Date; expenses: TxnWithCategory[] }) {
  const series = useMemo(() => {
    const dim = daysInMonth(month);
    const totals = Array.from({ length: dim }, () => 0);

    for (const t of expenses) {
      const day = Number(t.date.slice(8, 10));
      if (!Number.isFinite(day) || day < 1 || day > dim) continue;
      totals[day - 1] += t.amount;
    }

    const max = totals.reduce((m, v) => (v > m ? v : m), 0);
    const total = sum(totals);
    return { dim, totals, max, total };
  }, [expenses, month]);

  const svg = useMemo(() => {
    const w = 720;
    const h = 170;
    const p = 14;

    const n = series.totals.length;
    const usableW = w - p * 2;
    const usableH = h - p * 2;
    const max = series.max;

    const xAt = (i: number) => (n <= 1 ? w / 2 : p + (i / (n - 1)) * usableW);
    const yAt = (v: number) => {
      if (max <= 0) return h - p;
      const t = Math.max(0, v) / max;
      return p + (1 - t) * usableH;
    };

    const points = series.totals.map((v, i) => `${xAt(i)},${yAt(v)}`).join(" ");
    const firstX = xAt(0);
    const lastX = xAt(Math.max(0, n - 1));
    const baselineY = h - p;

    const areaPath =
      n === 0 ? "" : `M ${firstX} ${baselineY} L ${points.replaceAll(",", " ")} L ${lastX} ${baselineY} Z`;

    return { w, h, p, points, areaPath };
  }, [series.max, series.totals]);

  if (expenses.length === 0) {
    return (
      <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
        <div>
          <h3 className="text-sm font-semibold tracking-tight">Spend trend</h3>
          <p className="mt-1 text-sm text-zinc-400">Daily expenses for the selected month.</p>
        </div>
        <div className="mt-4 rounded-2xl border border-dashed border-white/15 bg-white/5 p-6">
          <div className="text-sm font-medium">No expenses yet</div>
          <div className="mt-1 text-sm text-zinc-400">Add an expense to see your daily spend trend.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold tracking-tight">Spend trend</h3>
          <p className="mt-1 text-sm text-zinc-400">Daily expenses for the selected month.</p>
        </div>
        <div className="text-right">
          <div className="text-xs text-zinc-400">Total spend</div>
          <div className="text-sm font-semibold text-rose-200">{formatCompactMoney(series.total)}</div>
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-white/5 to-transparent">
        <svg viewBox={`0 0 ${svg.w} ${svg.h}`} className="h-[170px] w-full" role="img" aria-label="Daily spend trend">
          <line
            x1={svg.p}
            y1={svg.h - svg.p}
            x2={svg.w - svg.p}
            y2={svg.h - svg.p}
            stroke="rgba(255,255,255,0.08)"
            strokeWidth={1}
          />
          <line
            x1={svg.p}
            y1={svg.p}
            x2={svg.w - svg.p}
            y2={svg.p}
            stroke="rgba(255,255,255,0.06)"
            strokeWidth={1}
          />

          {svg.areaPath ? <path d={svg.areaPath} fill="rgba(244,63,94,0.12)" /> : null}

          <polyline
            points={svg.points}
            fill="none"
            stroke="rgba(251,113,133,0.95)"
            strokeWidth={2.25}
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {series.totals.map((v, i) => {
            if (series.max <= 0) return null;
            const x =
              (svg.w - svg.p * 2) * (series.totals.length <= 1 ? 0.5 : i / (series.totals.length - 1)) + svg.p;
            const y = (() => {
              const t = Math.max(0, v) / series.max;
              return svg.p + (1 - t) * (svg.h - svg.p * 2);
            })();
            return (
              <circle
                key={i}
                cx={x}
                cy={y}
                r={v > 0 ? 2.5 : 0}
                fill="rgba(251,113,133,0.95)"
                stroke="rgba(0,0,0,0.35)"
                strokeWidth={1}
              />
            );
          })}
        </svg>
      </div>

      <div className="mt-3 flex items-center justify-between text-xs text-zinc-500">
        <span>Day 1</span>
        <span>Day {series.dim}</span>
      </div>
    </div>
  );
}

function CategoryBreakdown({ expenses }: { expenses: TxnWithCategory[] }) {
  const palette = [
    "bg-rose-400",
    "bg-amber-400",
    "bg-emerald-400",
    "bg-sky-400",
    "bg-violet-400",
    "bg-fuchsia-400",
    "bg-zinc-300",
  ] as const;

  const data = useMemo(() => {
    const byCat = new Map<string, number>();
    for (const t of expenses) {
      const key = t.categoryName || "Uncategorized";
      byCat.set(key, (byCat.get(key) ?? 0) + t.amount);
    }
    const entries = Array.from(byCat.entries())
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount);

    const total = entries.reduce((s, e) => s + e.amount, 0);
    const top = entries.slice(0, 6);
    const rest = entries.slice(6);
    const restSum = rest.reduce((s, e) => s + e.amount, 0);
    const final = restSum > 0 ? [...top, { category: "Other", amount: restSum }] : top;

    return { total, entries: final };
  }, [expenses]);

  if (expenses.length === 0) {
    return (
      <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
        <h3 className="text-sm font-semibold tracking-tight">Category breakdown</h3>
        <p className="mt-1 text-sm text-zinc-400">Where your money is going this month.</p>
        <div className="mt-4 rounded-2xl border border-dashed border-white/15 bg-white/5 p-6">
          <div className="text-sm font-medium">Nothing to break down yet</div>
          <div className="mt-1 text-sm text-zinc-400">Add an expense to see top categories.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold tracking-tight">Category breakdown</h3>
          <p className="mt-1 text-sm text-zinc-400">Where your money is going this month.</p>
        </div>
        <div className="text-right">
          <div className="text-xs text-zinc-400">Expenses</div>
          <div className="text-sm font-semibold text-rose-200">{formatCompactMoney(data.total)}</div>
        </div>
      </div>

      <ul className="mt-4 space-y-3">
        {data.entries.map((e, idx) => {
          const pct = data.total > 0 ? e.amount / data.total : 0;
          const color = palette[idx % palette.length];
          return (
            <li key={e.category} className="rounded-2xl border border-white/10 bg-white/5 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${color}`} />
                    <span className="truncate text-sm font-medium">{e.category}</span>
                    <span className="shrink-0 text-xs text-zinc-500">{Math.round(pct * 100)}%</span>
                  </div>
                </div>
                <div className="shrink-0 text-sm font-semibold text-zinc-100">{formatCompactMoney(e.amount)}</div>
              </div>

              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/5">
                <div className={`h-full ${color}`} style={{ width: `${Math.max(2, Math.round(pct * 100))}%` }} />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function Home() {
  // Avoid creating the browser Supabase client during SSR render of this client component.
  const supabase = useMemo(() => (typeof window === "undefined" ? null : createClient()), []);

  const [month, setMonth] = useState<Date>(() => clampToMonth(new Date()));

  const [authReady, setAuthReady] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  const [categories, setCategories] = useState<DbCategory[]>([]);
  const [allTxns, setAllTxns] = useState<Txn[]>([]);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Filters (list-only)
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  // Modal + form state (add/edit)
  const [txnModalOpen, setTxnModalOpen] = useState(false);
  const [txnModalMode, setTxnModalMode] = useState<"add" | "edit">("add");
  const [editingId, setEditingId] = useState<string | null>(null);

  const [draft, setDraft] = useState<TxnDraft>({
    date: "",
    description: "",
    categoryName: "",
    type: "expense",
    amount: "",
  });
  const [errors, setErrors] = useState<TxnErrors>({});

  // Category manager modal
  const [catModalOpen, setCatModalOpen] = useState(false);
  const [catNewName, setCatNewName] = useState("");
  const [catError, setCatError] = useState<string | null>(null);
  const [catSaving, setCatSaving] = useState(false);

  const monthDefaultDate = useMemo(() => {
    const now = new Date();
    const sameMonth = now.getFullYear() === month.getFullYear() && now.getMonth() === month.getMonth();
    return toISODate(sameMonth ? now : new Date(month.getFullYear(), month.getMonth(), 1));
  }, [month]);

  // Prevent duplicate initial loads if auth state changes quickly
  const didBootRef = useRef(false);

  useEffect(() => {
    if (!supabase) return;

    let cancelled = false;

    async function boot() {
      if (didBootRef.current) return;
      didBootRef.current = true;

      // Ensure we have a user session. Prefer anonymous auth for a frictionless demo.
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) {
        if (!cancelled) {
          setLoadError(sessionError.message);
          setAuthReady(true);
          setLoading(false);
        }
        return;
      }

      if (!sessionData.session) {
        const { data, error } = await supabase.auth.signInAnonymously();
        if (error) {
          if (!cancelled) {
            setLoadError(
              `Auth required. Enable Anonymous Sign-Ins in Supabase Auth settings (or add a login flow). (${error.message})`
            );
            setAuthReady(true);
            setLoading(false);
          }
          return;
        }
        if (!cancelled) setUserId(data.user?.id ?? null);
      } else {
        if (!cancelled) setUserId(sessionData.session.user.id);
      }

      if (!cancelled) setAuthReady(true);
    }

    void boot();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user?.id ?? null);
      setAuthReady(true);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [supabase]);

  async function loadCategories() {
    if (!supabase) throw new Error("Supabase client not ready.");
    const { data, error } = await supabase.from("categories").select("*").order("name", { ascending: true });
    if (error) throw error;
    return data ?? [];
  }

  async function ensureDefaultCategories(existing: DbCategory[]) {
    if (!supabase) throw new Error("Supabase client not ready.");
    const defaults = ["Groceries", "Dining", "Transport", "Housing", "Subscriptions", "Health", "Shopping", "Utilities"];
    const have = new Set(existing.map((c) => c.name.trim().toLowerCase()));
    const missing = defaults.filter((n) => !have.has(n.toLowerCase()));
    if (missing.length === 0) return;

    const { error } = await supabase.from("categories").insert(missing.map((name) => ({ name })));
    if (error) {
      // If unique constraint races, ignore and proceed to re-fetch
      return;
    }
  }

  async function loadTransactionsForMonth(m: Date) {
    if (!supabase) throw new Error("Supabase client not ready.");
    const { startISO, endISO } = monthRange(m);
    const { data, error } = await supabase
      .from("transactions")
      .select("*")
      .gte("date", startISO)
      .lte("date", endISO)
      .order("date", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) throw error;

    const txns: Txn[] =
      (data ?? []).map((t: DbTransaction) => ({
        id: t.id,
        date: t.date,
        description: t.description,
        type: (t.type === "income" ? "income" : "expense") as TxnType,
        amount: Number(t.amount),
        categoryId: t.category_id,
      })) ?? [];

    return txns;
  }

  // Load categories + month transactions when user is ready / month changes.
  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!supabase) return;
      if (!authReady || !userId) return;
      setLoading(true);
      setLoadError(null);

      try {
        const cats = await loadCategories();
        await ensureDefaultCategories(cats);
        const cats2 = await loadCategories();
        const tx = await loadTransactionsForMonth(month);

        if (!cancelled) {
          setCategories(cats2);
          setAllTxns(tx);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to load data.";
        if (!cancelled) setLoadError(msg);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [authReady, month, supabase, userId]);

  const categoryById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of categories) m.set(c.id, c.name);
    return m;
  }, [categories]);

  const monthTxns = useMemo(() => {
    // allTxns already loaded for month; keep as-is.
    return allTxns.slice();
  }, [allTxns]);

  const txnsWithCategory = useMemo<TxnWithCategory[]>(() => {
    return monthTxns.map((t) => ({
      ...t,
      categoryName: t.categoryId ? categoryById.get(t.categoryId) ?? "Uncategorized" : "Uncategorized",
    }));
  }, [categoryById, monthTxns]);

  const summary = useMemo(() => {
    let spend = 0;
    let income = 0;
    for (const t of txnsWithCategory) {
      if (t.type === "expense") spend += t.amount;
      else income += t.amount;
    }
    return { spend, income, net: income - spend };
  }, [txnsWithCategory]);

  const expenseTxns = useMemo(() => txnsWithCategory.filter((t) => t.type === "expense"), [txnsWithCategory]);

  const filteredTxns = useMemo(() => {
    const q = query.trim().toLowerCase();
    return txnsWithCategory.filter((t) => {
      if (categoryFilter !== "all" && t.categoryId !== categoryFilter) return false;
      if (!q) return true;
      return (
        t.description.toLowerCase().includes(q) ||
        t.categoryName.toLowerCase().includes(q) ||
        t.type.toLowerCase().includes(q)
      );
    });
  }, [categoryFilter, query, txnsWithCategory]);

  async function getOrCreateCategoryIdByName(nameRaw: string): Promise<string> {
    if (!supabase) throw new Error("Supabase client not ready.");
    const name = nameRaw.trim();
    const lower = name.toLowerCase();
    const existing = categories.find((c) => c.name.trim().toLowerCase() === lower);
    if (existing) return existing.id;

    const { data, error } = await supabase.from("categories").insert({ name }).select("*").single();
    if (!error && data) {
      setCategories((prev) => {
        const next = [...prev, data].sort((a, b) => a.name.localeCompare(b.name));
        return next;
      });
      return data.id;
    }

    // Possible uniqueness race; re-fetch and try to find
    const cats = await loadCategories();
    setCategories(cats);
    const found = cats.find((c) => c.name.trim().toLowerCase() === lower);
    if (!found) throw new Error(error?.message ?? "Failed to create category.");
    return found.id;
  }

  function openAdd() {
    setTxnModalMode("add");
    setEditingId(null);
    setErrors({});
    setDraft({
      date: monthDefaultDate,
      description: "",
      categoryName: "",
      type: "expense",
      amount: "",
    });
    setTxnModalOpen(true);
  }

  function openEdit(t: TxnWithCategory) {
    setTxnModalMode("edit");
    setEditingId(t.id);
    setErrors({});
    setDraft({
      date: t.date,
      description: t.description,
      categoryName: t.categoryName === "Uncategorized" ? "" : t.categoryName,
      type: t.type,
      amount: String(t.amount),
    });
    setTxnModalOpen(true);
  }

  function closeTxnModal() {
    setTxnModalOpen(false);
    setErrors({});
  }

  async function upsertTransaction() {
    if (!supabase) return;
    const v = validateDraft(draft);
    if (!v.ok) {
      setErrors(v.errors);
      return;
    }

    try {
      setCatError(null);

      const categoryId = await getOrCreateCategoryIdByName(draft.categoryName);

      const payload = {
        date: draft.date,
        description: draft.description.trim(),
        type: draft.type,
        amount: Number(draft.amount),
        category_id: categoryId,
      } satisfies Omit<Tables<"transactions">, "id" | "created_at" | "user_id">;

      if (txnModalMode === "add") {
        const { data, error } = await supabase.from("transactions").insert(payload).select("*").single();
        if (error) throw error;
        const newTxn: Txn = {
          id: data.id,
          date: data.date,
          description: data.description,
          type: (data.type === "income" ? "income" : "expense") as TxnType,
          amount: Number(data.amount),
          categoryId: data.category_id,
        };
        setAllTxns((prev) => [newTxn, ...prev]);
        closeTxnModal();
        return;
      }

      if (!editingId) return;

      const { data, error } = await supabase
        .from("transactions")
        .update(payload)
        .eq("id", editingId)
        .select("*")
        .single();

      if (error) throw error;

      const updated: Txn = {
        id: data.id,
        date: data.date,
        description: data.description,
        type: (data.type === "income" ? "income" : "expense") as TxnType,
        amount: Number(data.amount),
        categoryId: data.category_id,
      };

      setAllTxns((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      closeTxnModal();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to save transaction.";
      setErrors((prev) => ({ ...prev, amount: prev.amount })); // keep shape stable
      setLoadError(msg);
    }
  }

  async function deleteTransaction(id: string) {
    if (!supabase) return;
    const ok = window.confirm("Delete this transaction? This can't be undone.");
    if (!ok) return;

    const { error } = await supabase.from("transactions").delete().eq("id", id);
    if (error) {
      setLoadError(error.message);
      return;
    }
    setAllTxns((prev) => prev.filter((t) => t.id !== id));
  }

  async function addCategory() {
    const name = catNewName.trim();
    if (!name) {
      setCatError("Category name is required.");
      return;
    }

    try {
      setCatSaving(true);
      setCatError(null);
      const _id = await getOrCreateCategoryIdByName(name);
      setCatNewName("");
      setCategoryFilter((prev) => (prev === "all" ? prev : prev)); // no-op; keeps UI stable
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to add category.";
      setCatError(msg);
    } finally {
      setCatSaving(false);
    }
  }

  async function renameCategory(id: string, nextNameRaw: string) {
    if (!supabase) return;
    const nextName = nextNameRaw.trim();
    if (!nextName) {
      setCatError("Category name can't be empty.");
      return;
    }
    setCatError(null);

    const { error } = await supabase.from("categories").update({ name: nextName }).eq("id", id);
    if (error) {
      setCatError(error.message);
      return;
    }

    setCategories((prev) => prev.map((c) => (c.id === id ? { ...c, name: nextName } : c)).sort((a, b) => a.name.localeCompare(b.name)));
  }

  async function removeCategory(id: string) {
    if (!supabase) return;
    const ok = window.confirm("Delete this category? Transactions using it will become Uncategorized.");
    if (!ok) return;

    const { error } = await supabase.from("categories").delete().eq("id", id);
    if (error) {
      setCatError(error.message);
      return;
    }

    setCategories((prev) => prev.filter((c) => c.id !== id));
    setAllTxns((prev) => prev.map((t) => (t.categoryId === id ? { ...t, categoryId: null } : t)));
    setCategoryFilter((prev) => (prev === id ? "all" : prev));
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
        <header className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-zinc-200">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Budget Tracker
            </div>
            <h1 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
              Monthly spending, at a glance.
            </h1>
            <p className="max-w-2xl text-sm leading-relaxed text-zinc-300">
              Search, filter, and manage categories. Data is now persisted in Supabase.
            </p>
          </div>

          <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 p-2">
            <button
              type="button"
              onClick={() => setMonth((m) => addMonths(m, -1))}
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-zinc-100 transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-emerald-400/40"
              aria-label="Previous month"
            >
              <span className="text-lg leading-none">‹</span>
            </button>

            <div className="px-2 text-center">
              <div className="text-xs text-zinc-400">Selected month</div>
              <div className="text-sm font-medium">{formatMonth(month)}</div>
            </div>

            <button
              type="button"
              onClick={() => setMonth((m) => addMonths(m, 1))}
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-zinc-100 transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-emerald-400/40"
              aria-label="Next month"
            >
              <span className="text-lg leading-none">›</span>
            </button>
          </div>
        </header>

        {loadError ? (
          <div className="mt-6 rounded-3xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-100">
            <div className="font-semibold">Something went wrong</div>
            <div className="mt-1 text-rose-100/90">{loadError}</div>
          </div>
        ) : null}

        {!authReady ? (
          <div className="mt-6 rounded-3xl border border-white/10 bg-white/5 p-6 text-sm text-zinc-300">
            Connecting…
          </div>
        ) : !userId ? (
          <div className="mt-6 rounded-3xl border border-white/10 bg-white/5 p-6 text-sm text-zinc-300">
            Not signed in. Enable anonymous auth in Supabase (or add a login flow) to use the database features.
          </div>
        ) : (
          <main className="mt-8 grid gap-6 lg:grid-cols-12">
            <section className="grid gap-4 lg:col-span-12 lg:grid-cols-3">
              <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-b from-white/10 to-white/5 p-5">
                <div className="text-sm text-zinc-300">Total spend</div>
                <div className="mt-2 text-3xl font-semibold tracking-tight">
                  {loading ? "—" : formatMoney(summary.spend)}
                </div>
                <div className="mt-4 text-xs text-zinc-400">For {formatMonth(month)} • Expenses only</div>
                <div className="pointer-events-none absolute -right-14 -top-14 h-44 w-44 rounded-full bg-rose-500/15 blur-2xl" />
              </div>

              <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-b from-white/10 to-white/5 p-5">
                <div className="text-sm text-zinc-300">Total income</div>
                <div className="mt-2 text-3xl font-semibold tracking-tight">
                  {loading ? "—" : formatMoney(summary.income)}
                </div>
                <div className="mt-4 text-xs text-zinc-400">For {formatMonth(month)} • Income only</div>
                <div className="pointer-events-none absolute -right-14 -top-14 h-44 w-44 rounded-full bg-emerald-500/15 blur-2xl" />
              </div>

              <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-b from-white/10 to-white/5 p-5">
                <div className="text-sm text-zinc-300">Net</div>
                <div className="mt-2 text-3xl font-semibold tracking-tight">
                  <span className={summary.net >= 0 ? "text-emerald-300" : "text-rose-300"}>
                    {loading ? "—" : formatMoney(summary.net)}
                  </span>
                </div>
                <div className="mt-4 text-xs text-zinc-400">Income − spend</div>
                <div className="pointer-events-none absolute -right-14 -top-14 h-44 w-44 rounded-full bg-sky-500/15 blur-2xl" />
              </div>
            </section>

            <section className="grid gap-6 lg:col-span-12 lg:grid-cols-12">
              <div className="lg:col-span-7">
                <TrendChart month={month} expenses={expenseTxns} />
              </div>
              <div className="lg:col-span-5">
                <CategoryBreakdown expenses={expenseTxns} />
              </div>
            </section>

            <section className="lg:col-span-12">
              <div className="rounded-3xl border border-white/10 bg-white/5">
                <div className="border-b border-white/10 p-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h2 className="text-lg font-semibold tracking-tight">Transactions</h2>
                      <p className="text-sm text-zinc-400">
                        {loading ? "Loading…" : `Showing ${filteredTxns.length} of ${txnsWithCategory.length} for ${formatMonth(month)}`}
                      </p>
                    </div>

                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <button
                        type="button"
                        onClick={() => setCatModalOpen(true)}
                        className="inline-flex items-center justify-center rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-zinc-50 transition hover:bg-white/10"
                      >
                        Manage categories
                      </button>
                      <button
                        type="button"
                        onClick={openAdd}
                        className="inline-flex items-center justify-center rounded-2xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/40"
                      >
                        Add transaction
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-2 sm:grid-cols-12">
                    <div className="sm:col-span-7">
                      <label className="block">
                        <div className="mb-1 text-xs font-medium text-zinc-300">Search</div>
                        <input
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                          placeholder="Search description or category…"
                          className="h-11 w-full rounded-2xl border border-white/10 bg-white/5 px-3 text-sm text-zinc-50 outline-none transition focus:border-emerald-400/40 focus:ring-2 focus:ring-emerald-400/20"
                        />
                      </label>
                    </div>

                    <div className="sm:col-span-5">
                      <label className="block">
                        <div className="mb-1 text-xs font-medium text-zinc-300">Category</div>
                        <select
                          value={categoryFilter}
                          onChange={(e) => setCategoryFilter(e.target.value)}
                          className="h-11 w-full rounded-2xl border border-white/10 bg-white/5 px-3 text-sm text-zinc-50 outline-none transition focus:border-emerald-400/40 focus:ring-2 focus:ring-emerald-400/20"
                        >
                          <option value="all">All categories</option>
                          {categories.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  </div>
                </div>

                {loading ? (
                  <div className="p-8">
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-sm text-zinc-400">
                      Loading transactions…
                    </div>
                  </div>
                ) : txnsWithCategory.length === 0 ? (
                  <div className="p-8">
                    <div className="rounded-2xl border border-dashed border-white/15 bg-white/5 p-6">
                      <div className="text-sm font-medium">No transactions yet</div>
                      <div className="mt-1 text-sm text-zinc-400">
                        Add your first transaction to start tracking {formatMonth(month)}.
                      </div>
                      <div className="mt-4">
                        <button
                          type="button"
                          onClick={openAdd}
                          className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-semibold text-zinc-50 transition hover:bg-white/15 focus:outline-none focus:ring-2 focus:ring-emerald-400/40"
                        >
                          Add one now
                        </button>
                      </div>
                    </div>
                  </div>
                ) : filteredTxns.length === 0 ? (
                  <div className="p-8">
                    <div className="rounded-2xl border border-dashed border-white/15 bg-white/5 p-6">
                      <div className="text-sm font-medium">No matches</div>
                      <div className="mt-1 text-sm text-zinc-400">Try clearing your search or category filter.</div>
                      <div className="mt-4 flex gap-2">
                        <button
                          type="button"
                          onClick={() => setQuery("")}
                          className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-zinc-50 transition hover:bg-white/10"
                        >
                          Clear search
                        </button>
                        <button
                          type="button"
                          onClick={() => setCategoryFilter("all")}
                          className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-zinc-50 transition hover:bg-white/10"
                        >
                          All categories
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <ul className="divide-y divide-white/10">
                    {filteredTxns.map((t) => {
                      const isExpense = t.type === "expense";
                      return (
                        <li key={t.id} className="p-5">
                          <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm font-medium text-zinc-50">{t.description}</span>
                                <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-zinc-300">
                                  {t.categoryName}
                                </span>
                                <span className="text-xs text-zinc-500">{formatShortDate(t.date)}</span>
                              </div>
                              <div className="mt-2 flex items-center gap-2 text-xs text-zinc-400">
                                <span className="rounded-full bg-white/5 px-2 py-0.5">
                                  {isExpense ? "Expense" : "Income"}
                                </span>
                              </div>
                            </div>

                            <div className="shrink-0 text-right">
                              <div className={`text-sm font-semibold ${isExpense ? "text-rose-300" : "text-emerald-300"}`}>
                                {isExpense ? "-" : "+"}
                                {formatMoney(t.amount)}
                              </div>
                              <div className="mt-2 flex justify-end gap-2">
                                <button
                                  type="button"
                                  onClick={() => openEdit(t)}
                                  className="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-zinc-200 transition hover:bg-white/10"
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void deleteTransaction(t.id)}
                                  className="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-zinc-200 transition hover:bg-white/10"
                                >
                                  Delete
                                </button>
                              </div>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </section>
          </main>
        )}
      </div>

      {/* Transaction modal */}
      {txnModalOpen ? (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={closeTxnModal} aria-hidden="true" />
          <div className="absolute inset-0 flex items-end justify-center p-3 sm:items-center">
            <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-zinc-950 shadow-2xl shadow-black/50">
              <div className="flex items-start justify-between gap-4 border-b border-white/10 p-5">
                <div>
                  <div className="text-xs text-zinc-400">
                    {txnModalMode === "add" ? "New transaction" : "Edit transaction"}
                  </div>
                  <h3 className="mt-1 text-lg font-semibold tracking-tight">
                    {txnModalMode === "add" ? "Add a transaction" : "Update details"}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={closeTxnModal}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-zinc-100 transition hover:bg-white/10"
                  aria-label="Close"
                >
                  <span className="text-lg leading-none">×</span>
                </button>
              </div>

              <form
                className="p-5"
                onSubmit={(e) => {
                  e.preventDefault();
                  void upsertTransaction();
                }}
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block">
                    <div className="mb-1 text-xs font-medium text-zinc-300">Type</div>
                    <select
                      className="h-11 w-full rounded-2xl border border-white/10 bg-white/5 px-3 text-sm text-zinc-50 outline-none transition focus:border-emerald-400/40 focus:ring-2 focus:ring-emerald-400/20"
                      value={draft.type}
                      onChange={(e) => {
                        const type = e.target.value as TxnType;
                        setDraft((d) => ({ ...d, type }));
                      }}
                    >
                      <option value="expense">Expense</option>
                      <option value="income">Income</option>
                    </select>
                  </label>

                  <label className="block">
                    <div className="mb-1 text-xs font-medium text-zinc-300">Date</div>
                    <input
                      type="date"
                      className={`h-11 w-full rounded-2xl border px-3 text-sm text-zinc-50 outline-none transition focus:ring-2 ${
                        errors.date
                          ? "border-rose-400/40 bg-rose-500/5 focus:border-rose-400/60 focus:ring-rose-400/20"
                          : "border-white/10 bg-white/5 focus:border-emerald-400/40 focus:ring-emerald-400/20"
                      }`}
                      value={draft.date}
                      onChange={(e) => {
                        setDraft((d) => ({ ...d, date: e.target.value }));
                        setErrors((prev) => ({ ...prev, date: undefined }));
                      }}
                    />
                    {errors.date ? <div className="mt-1 text-xs text-rose-300">{errors.date}</div> : null}
                  </label>

                  <label className="block sm:col-span-2">
                    <div className="mb-1 text-xs font-medium text-zinc-300">Description</div>
                    <input
                      type="text"
                      placeholder="e.g., Trader Joe's"
                      className={`h-11 w-full rounded-2xl border px-3 text-sm text-zinc-50 outline-none transition focus:ring-2 ${
                        errors.description
                          ? "border-rose-400/40 bg-rose-500/5 focus:border-rose-400/60 focus:ring-rose-400/20"
                          : "border-white/10 bg-white/5 focus:border-emerald-400/40 focus:ring-emerald-400/20"
                      }`}
                      value={draft.description}
                      onChange={(e) => {
                        setDraft((d) => ({ ...d, description: e.target.value }));
                        setErrors((prev) => ({ ...prev, description: undefined }));
                      }}
                    />
                    {errors.description ? <div className="mt-1 text-xs text-rose-300">{errors.description}</div> : null}
                  </label>

                  <label className="block">
                    <div className="mb-1 text-xs font-medium text-zinc-300">Category</div>
                    <input
                      type="text"
                      placeholder="e.g., Groceries"
                      className={`h-11 w-full rounded-2xl border px-3 text-sm text-zinc-50 outline-none transition focus:ring-2 ${
                        errors.categoryName
                          ? "border-rose-400/40 bg-rose-500/5 focus:border-rose-400/60 focus:ring-rose-400/20"
                          : "border-white/10 bg-white/5 focus:border-emerald-400/40 focus:ring-emerald-400/20"
                      }`}
                      value={draft.categoryName}
                      onChange={(e) => {
                        setDraft((d) => ({ ...d, categoryName: e.target.value }));
                        setErrors((prev) => ({ ...prev, categoryName: undefined }));
                      }}
                    />
                    {errors.categoryName ? (
                      <div className="mt-1 text-xs text-rose-300">{errors.categoryName}</div>
                    ) : (
                      <div className="mt-1 text-xs text-zinc-500">New categories are created automatically.</div>
                    )}
                  </label>

                  <label className="block">
                    <div className="mb-1 text-xs font-medium text-zinc-300">Amount</div>
                    <div className="relative">
                      <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-zinc-400">
                        $
                      </div>
                      <input
                        inputMode="decimal"
                        placeholder="0.00"
                        className={`h-11 w-full rounded-2xl border py-0 pl-7 pr-3 text-sm text-zinc-50 outline-none transition focus:ring-2 ${
                          errors.amount
                            ? "border-rose-400/40 bg-rose-500/5 focus:border-rose-400/60 focus:ring-rose-400/20"
                            : "border-white/10 bg-white/5 focus:border-emerald-400/40 focus:ring-emerald-400/20"
                        }`}
                        value={draft.amount}
                        onChange={(e) => {
                          setDraft((d) => ({ ...d, amount: e.target.value }));
                          setErrors((prev) => ({ ...prev, amount: undefined }));
                        }}
                      />
                    </div>
                    {errors.amount ? <div className="mt-1 text-xs text-rose-300">{errors.amount}</div> : null}
                  </label>
                </div>

                <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={closeTxnModal}
                    className="inline-flex items-center justify-center rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-zinc-50 transition hover:bg-white/10"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="inline-flex items-center justify-center rounded-2xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/40"
                  >
                    {txnModalMode === "add" ? "Add transaction" : "Save changes"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      ) : null}

      {/* Category manager modal */}
      {catModalOpen ? (
        <div className="fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => {
              setCatModalOpen(false);
              setCatError(null);
            }}
            aria-hidden="true"
          />
          <div className="absolute inset-0 flex items-end justify-center p-3 sm:items-center">
            <div className="w-full max-w-xl rounded-3xl border border-white/10 bg-zinc-950 shadow-2xl shadow-black/50">
              <div className="flex items-start justify-between gap-4 border-b border-white/10 p-5">
                <div>
                  <div className="text-xs text-zinc-400">Categories</div>
                  <h3 className="mt-1 text-lg font-semibold tracking-tight">Manage categories</h3>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setCatModalOpen(false);
                    setCatError(null);
                  }}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-zinc-100 transition hover:bg-white/10"
                  aria-label="Close"
                >
                  <span className="text-lg leading-none">×</span>
                </button>
              </div>

              <div className="p-5">
                {catError ? (
                  <div className="mb-4 rounded-2xl border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-100">
                    {catError}
                  </div>
                ) : null}

                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    value={catNewName}
                    onChange={(e) => setCatNewName(e.target.value)}
                    placeholder="New category name…"
                    className="h-11 flex-1 rounded-2xl border border-white/10 bg-white/5 px-3 text-sm text-zinc-50 outline-none transition focus:border-emerald-400/40 focus:ring-2 focus:ring-emerald-400/20"
                  />
                  <button
                    type="button"
                    onClick={() => void addCategory()}
                    disabled={catSaving}
                    className="h-11 rounded-2xl bg-emerald-500 px-4 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    Add
                  </button>
                </div>

                <div className="mt-4 overflow-hidden rounded-2xl border border-white/10">
                  <ul className="divide-y divide-white/10">
                    {categories.map((c) => (
                      <li key={c.id} className="flex items-center gap-2 bg-white/5 p-3">
                        <input
                          defaultValue={c.name}
                          className="h-10 flex-1 rounded-xl border border-white/10 bg-zinc-950/40 px-3 text-sm text-zinc-50 outline-none transition focus:border-emerald-400/40 focus:ring-2 focus:ring-emerald-400/20"
                          onBlur={(e) => {
                            const next = e.target.value;
                            if (next.trim() !== c.name.trim()) void renameCategory(c.id, next);
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => void removeCategory(c.id)}
                          className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-zinc-100 transition hover:bg-white/10"
                        >
                          Delete
                        </button>
                      </li>
                    ))}
                    {categories.length === 0 ? (
                      <li className="p-4 text-sm text-zinc-400">No categories yet.</li>
                    ) : null}
                  </ul>
                </div>

                <div className="mt-4 text-xs text-zinc-500">
                  Tip: Rename by editing a row and clicking outside. Deleting a category sets affected transactions to
                  "Uncategorized".
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
