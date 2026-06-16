"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Loader2, RefreshCw, RotateCw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";

type Env = {
  NEXT_PUBLIC_SUPABASE_URL: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY: string;
  ANTHROPIC_API_KEY: string;
  OPENAI_API_KEY: string;
  VOYAGE_API_KEY: string;
  EMBEDDINGS_PROVIDER: string;
  DATABASE_URL: string;
};

const EMPTY: Env = {
  NEXT_PUBLIC_SUPABASE_URL: "",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
  ANTHROPIC_API_KEY: "",
  OPENAI_API_KEY: "",
  VOYAGE_API_KEY: "",
  EMBEDDINGS_PROVIDER: "local",
  DATABASE_URL: "",
};

const FIELDS: { key: keyof Env; label: string; desc: string; secret?: boolean; placeholder?: string }[] = [
  { key: "NEXT_PUBLIC_SUPABASE_URL", label: "Supabase URL", desc: "Project Settings → API.", placeholder: "https://xxxx.supabase.co" },
  { key: "NEXT_PUBLIC_SUPABASE_ANON_KEY", label: "Supabase anon key", desc: "Project Settings → API (public anon key).", secret: true },
  { key: "ANTHROPIC_API_KEY", label: "Anthropic API key", desc: "Powers Ask, Daily Brief, Study plan.", secret: true, placeholder: "sk-ant-…" },
  { key: "OPENAI_API_KEY", label: "OpenAI API key", desc: "Only if embeddings provider = openai.", secret: true },
  { key: "VOYAGE_API_KEY", label: "Voyage API key", desc: "Only if embeddings provider = voyage.", secret: true },
  { key: "DATABASE_URL", label: "Cloud database URL", desc: "Supabase → Database → Connection string. Enables cloud sync. Blank = local-only.", secret: true, placeholder: "postgresql://postgres:…@db.xxxx.supabase.co:5432/postgres" },
];

const PROVIDERS = [
  { id: "local", label: "Local (on-device, no key)" },
  { id: "openai", label: "OpenAI" },
  { id: "voyage", label: "Voyage" },
];

type SyncSummary = {
  ok: boolean;
  finishedAt?: string;
  pulled: number;
  pushed: number;
  deletesApplied: number;
  deletesPushed: number;
  skipped: number;
  error?: string;
};

function Field({ children, label, desc }: { children: React.ReactNode; label: string; desc: string }) {
  return (
    <div className="py-3">
      <div className="text-sm font-medium">{label}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{desc}</div>
      <div className="mt-2">{children}</div>
    </div>
  );
}

export function DesktopSettings() {
  const [env, setEnv] = useState<Env>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedNeedsRestart, setSavedNeedsRestart] = useState(false);

  const [status, setStatus] = useState<{ running: boolean; last: SyncSummary | null } | null>(null);
  const [syncing, setSyncing] = useState(false);
  // Which secret keys are already set on disk (the API never returns the values).
  const [configured, setConfigured] = useState<Record<string, boolean>>({});

  useEffect(() => {
    fetch("/api/desktop/settings")
      .then((r) => r.json())
      .then((d) => {
        if (d?.env) setEnv({ ...EMPTY, ...d.env });
        if (d?.configured) setConfigured(d.configured);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  const refreshStatus = useCallback(() => {
    fetch("/api/sync")
      .then((r) => r.json())
      .then((d) => setStatus(d))
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshStatus();
    const id = setInterval(refreshStatus, 5000);
    return () => clearInterval(id);
  }, [refreshStatus]);

  function set<K extends keyof Env>(key: K, value: Env[K]) {
    setEnv((e) => ({ ...e, [key]: value }));
    setDirty(true);
    setSavedNeedsRestart(false);
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/desktop/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ env }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `HTTP ${res.status}`);
      setDirty(false);
      setSavedNeedsRestart(true);
      toast.success("Settings saved — restart to apply");
    } catch (e) {
      toast.error(`Save failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      setSaving(false);
    }
  }

  function restart() {
    const d = (window as unknown as { desktop?: { relaunch?: () => void } }).desktop;
    if (d?.relaunch) d.relaunch();
    else toast.message("Use the menu: Tools → Restart app (apply settings)");
  }

  async function syncNow() {
    setSyncing(true);
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      const s = (await res.json()) as SyncSummary;
      if (s.ok) {
        toast.success(`Synced — pulled ${s.pulled}, pushed ${s.pushed}` + (s.skipped ? `, ${s.skipped} skipped` : ""));
      } else {
        toast.error(`Sync failed: ${s.error || "unknown"}`);
      }
      refreshStatus();
    } catch (e) {
      toast.error(`Sync failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      setSyncing(false);
    }
  }

  if (!loaded) return <div className="h-48" />;

  const last = status?.last;
  const cloudConfigured = env.DATABASE_URL.trim().length > 0;

  return (
    <div className="divide-y divide-border">
      {/* Cloud sync */}
      <section className="pb-4">
        <h2 className="pb-1 pt-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Cloud sync
        </h2>
        <div className="flex items-center justify-between gap-4 py-3">
          <div className="min-w-0 text-xs text-muted-foreground">
            {!cloudConfigured ? (
              <>Local-only — add a cloud database URL below to sync across devices.</>
            ) : status?.running ? (
              <span className="inline-flex items-center gap-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Syncing…
              </span>
            ) : last ? (
              <>
                Last sync {last.finishedAt ? new Date(last.finishedAt).toLocaleString() : "—"} ·{" "}
                {last.ok ? (
                  <span className="text-foreground">
                    pulled {last.pulled}, pushed {last.pushed}, deletes{" "}
                    {last.deletesApplied + last.deletesPushed}
                    {last.skipped ? `, ${last.skipped} skipped` : ""}
                  </span>
                ) : (
                  <span className="text-red-500">failed: {last.error}</span>
                )}
              </>
            ) : (
              <>Background sync runs every 5 min.</>
            )}
          </div>
          <Button size="sm" variant="outline" onClick={syncNow} disabled={syncing || !cloudConfigured}>
            {syncing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
            Sync now
          </Button>
        </div>
      </section>

      {/* Keys & connection */}
      <section className="pt-2">
        <h2 className="pb-1 pt-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Keys &amp; connection
        </h2>

        <Field label="Embeddings provider" desc="Local runs on-device with no key (best for offline). Switching providers requires re-embedding.">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" className="h-8 min-w-[14rem] justify-between gap-2">
                {PROVIDERS.find((p) => p.id === env.EMBEDDINGS_PROVIDER)?.label ?? env.EMBEDDINGS_PROVIDER}
                <ChevronDown className="h-3.5 w-3.5 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              {PROVIDERS.map((p) => (
                <DropdownMenuItem key={p.id} onClick={() => set("EMBEDDINGS_PROVIDER", p.id)} className="flex items-center justify-between gap-2">
                  <span className="text-sm">{p.label}</span>
                  {env.EMBEDDINGS_PROVIDER === p.id && <Check className="h-3.5 w-3.5 shrink-0" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </Field>

        <Separator />

        {FIELDS.map((f, i) => (
          <div key={f.key}>
            {i > 0 && <Separator />}
            <Field label={f.label} desc={f.desc}>
              <Input
                type={f.secret ? "password" : "text"}
                value={env[f.key]}
                placeholder={
                  f.secret && configured[f.key] && !env[f.key]
                    ? "•••• configured — leave blank to keep"
                    : f.placeholder
                }
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => set(f.key, e.target.value)}
                className="font-mono text-xs"
              />
            </Field>
          </div>
        ))}
      </section>

      {/* Save / restart */}
      <section className="pt-4">
        <div className="flex items-center justify-end gap-2 py-3">
          {savedNeedsRestart && (
            <Button size="sm" onClick={restart}>
              <RotateCw className="mr-1.5 h-3.5 w-3.5" />
              Restart now
            </Button>
          )}
          <Button size="sm" variant={savedNeedsRestart ? "outline" : "default"} onClick={save} disabled={saving || !dirty}>
            {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
            Save
          </Button>
        </div>
      </section>
    </div>
  );
}
