import { useEffect, useRef, useState } from "react";
import { Check, CloudOff, Crown, Loader2, LogOut, Mail, RefreshCw, UserRound, X } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import type { SyncStatus } from "@/lib/useAccount";

interface Props {
  user: User | null;
  isPro: boolean;
  googleOn: boolean;
  status: SyncStatus;
  lastSync: number | null;
  onEmail: (email: string) => Promise<string | null>;
  onGoogle: () => Promise<string | null>;
  onSignOut: () => void;
  onSyncNow: () => void;
}

function ago(t: number | null) {
  if (!t) return "";
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString();
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" aria-hidden>
      <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.8-5.5 3.8-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.2.8 3.9 1.5l2.7-2.6C16.9 3 14.7 2 12 2 6.5 2 2 6.5 2 12s4.5 10 10 10c5.8 0 9.6-4.1 9.6-9.8 0-.7-.1-1.2-.2-1.7H12z" />
    </svg>
  );
}

/** Top-right account button: sign in to sync favourites, stations and tracks */
export default function AccountMenu(p: Props) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const box = useRef<HTMLDivElement>(null);

  // Close when tapping elsewhere
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("pointerdown", away);
    return () => window.removeEventListener("pointerdown", away);
  }, [open]);

  const sendLink = async () => {
    if (!/^\S+@\S+\.\S+$/.test(email)) return setMsg({ ok: false, text: "That doesn't look like an email address." });
    setBusy(true);
    const err = await p.onEmail(email);
    setBusy(false);
    setMsg(err ? { ok: false, text: err } : { ok: true, text: "Check your email for a sign-in link. It works on any device." });
  };

  const dot =
    p.status === "error" ? "bg-red-400" : p.status === "syncing" ? "bg-amber-300 animate-pulse" : p.user ? "bg-emerald-400" : "";

  return (
    <div ref={box} className="relative pointer-events-auto">
      <button
        onClick={() => setOpen(!open)}
        className={`relative w-10 h-10 rounded-full flex items-center justify-center ring-1 backdrop-blur-xl transition active:scale-95 ${
          p.user ? "bg-primary/20 ring-primary/50 text-primary" : "bg-popover/70 ring-white/15 text-foreground/80 hover:text-foreground"
        }`}
        aria-label={p.user ? "Your account" : "Sign in"}
        title={p.user ? "Your account" : "Sign in to sync across devices"}
      >
        {p.user ? <span className="font-semibold text-sm">{(p.user.email ?? "?")[0].toUpperCase()}</span> : <UserRound className="w-5 h-5" />}
        {dot && <span className={`absolute top-0.5 right-0.5 w-2.5 h-2.5 rounded-full ring-2 ring-background ${dot}`} />}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-[min(320px,calc(100vw-24px))] rounded-2xl bg-popover/95 backdrop-blur-xl ring-1 ring-white/10 shadow-2xl p-4 animate-in fade-in zoom-in-95 duration-150 origin-top-right">
          <div className="flex items-start justify-between gap-2 mb-3">
            <div className="font-display italic text-lg leading-tight">{p.user ? "Your account" : "Sign in"}</div>
            <button onClick={() => setOpen(false)} className="p-1 -m-1 rounded-full hover:bg-white/10 text-muted-foreground" aria-label="Close">
              <X className="w-4 h-4" />
            </button>
          </div>

          {p.user ? (
            <div className="space-y-3 text-sm">
              <div className="text-muted-foreground break-all">{p.user.email}</div>
              <div className="flex items-center gap-2 text-[13px]">
                {p.status === "syncing" && (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> Syncing…
                  </>
                )}
                {p.status === "synced" && (
                  <>
                    <Check className="w-4 h-4 text-emerald-400" /> Synced {ago(p.lastSync)}
                  </>
                )}
                {p.status === "error" && (
                  <>
                    <CloudOff className="w-4 h-4 text-red-300" /> Couldn't sync. Your changes are kept here.
                  </>
                )}
                <button onClick={p.onSyncNow} className="ml-auto p-1.5 rounded-full hover:bg-white/10 text-muted-foreground" aria-label="Sync now" title="Sync now">
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              </div>
              <p className="text-[12px] text-muted-foreground">Favourites, stations you've added and tracks heard follow you to any device you sign in on.</p>
              <div className="flex items-center gap-2 rounded-xl ring-1 ring-white/10 px-3 py-2 text-[13px]">
                <Crown className={`w-4 h-4 ${p.isPro ? "text-amber-300" : "text-muted-foreground"}`} />
                {p.isPro ? "Pro: thank you!" : "Pro upgrade coming soon"}
              </div>
              <button
                onClick={() => {
                  p.onSignOut();
                  setOpen(false);
                }}
                className="flex items-center gap-2 text-[13px] text-muted-foreground hover:text-foreground"
              >
                <LogOut className="w-4 h-4" /> Sign out (your stations stay on this device)
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-[13px] text-muted-foreground">
                Keep your favourites, added stations and tracks heard on all your devices. No password: we email you a link.
              </p>
              <div className="flex gap-2">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setMsg(null);
                  }}
                  onKeyDown={(e) => e.key === "Enter" && sendLink()}
                  placeholder="you@example.com"
                  className="flex-1 min-w-0 bg-white/5 ring-1 ring-white/10 focus:ring-white/30 rounded-lg px-3 py-2 text-sm outline-none"
                  autoComplete="email"
                />
                <button
                  onClick={sendLink}
                  disabled={busy}
                  className="shrink-0 flex items-center gap-1.5 px-3 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
                >
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
                  Send
                </button>
              </div>
              {msg && <p className={`text-[12px] ${msg.ok ? "text-emerald-300" : "text-amber-300"}`}>{msg.text}</p>}
              {p.googleOn && (
                <>
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span className="h-px flex-1 bg-white/10" /> or <span className="h-px flex-1 bg-white/10" />
                  </div>
                  <button
                    onClick={async () => {
                      const err = await p.onGoogle();
                      if (err) setMsg({ ok: false, text: err });
                    }}
                    className="w-full flex items-center justify-center gap-2 rounded-lg ring-1 ring-white/15 hover:ring-white/30 py-2 text-sm"
                  >
                    <GoogleMark /> Continue with Google
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
