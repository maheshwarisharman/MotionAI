"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  Loader2,
  LogOut,
  Play,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuGroup,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";

function getInitials(email: string | undefined): string {
  if (!email) {
    return "AI";
  }

  const localPart = email.split("@")[0] ?? "";
  return localPart.slice(0, 2).toUpperCase() || "AI";
}

export default function Header() {
  const {
    authAvailable,
    isAuthReady,
    user,
    signInWithPassword,
    signOut,
    signUpWithPassword,
  } = useAuth();
  const [modalOpen, setModalOpen] = useState(false);
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const authDescription = useMemo(() => {
    if (!authAvailable) {
      return "Guest rendering is live. Add Supabase env vars to enable project history.";
    }

    return "Sign in to save every project to your history. You can still create as a guest anytime.";
  }, [authAvailable]);

  const handleSubmit = async () => {
    if (!authAvailable || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setFeedback(null);

    try {
      if (mode === "sign-in") {
        const result = await signInWithPassword(email.trim(), password);
        if (result.error) {
          setError(result.error);
          return;
        }

        setModalOpen(false);
        setPassword("");
        setFeedback(null);
        return;
      }

      const result = await signUpWithPassword(email.trim(), password);
      if (result.error) {
        setError(result.error);
        return;
      }

      setFeedback(
        result.needsEmailConfirmation
          ? "Account created. Check your email to confirm your address, then sign in."
          : "Account created. You’re signed in and ready to save projects.",
      );
      if (!result.needsEmailConfirmation) {
        setModalOpen(false);
        setPassword("");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <header className="sticky top-0 z-50 w-full">
      <div className="flex h-16 items-center justify-between px-4 md:px-8 max-w-[1600px] mx-auto w-full">
        <div className="flex items-center gap-8 md:gap-10">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary">
              <Play className="h-3.5 w-3.5 text-primary-foreground fill-current" />
            </div>
            <span className="font-semibold text-lg tracking-tight text-foreground">
              MotionAI
            </span>
          </Link>
        </div>

        <div className="flex items-center gap-6">
          <Link
            href="/pricing"
            className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors hidden sm:block"
          >
            Pricing
          </Link>

          {!isAuthReady ? (
            <div className="flex h-9 items-center rounded-full border border-white/10 bg-white/5 px-4 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading account
            </div>
          ) : user ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <button
                    type="button"
                    className="flex items-center gap-3 rounded-full border border-white/10 bg-black/30 px-2.5 py-1.5 text-left shadow-[0_10px_30px_rgba(0,0,0,0.2)] backdrop-blur transition hover:border-white/15 hover:bg-white/[0.08]"
                  />
                }
              >
                <Avatar className="h-8 w-8 border border-white/10 bg-white/[0.06]">
                  <AvatarFallback>{getInitials(user.email)}</AvatarFallback>
                </Avatar>
                <div className="hidden min-w-0 sm:block">
                  <div className="max-w-[180px] truncate text-sm font-medium text-foreground">
                    {user.email}
                  </div>
                  <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                    Saved history on
                  </div>
                </div>
              </DropdownMenuTrigger>
<DropdownMenuContent
  align="end"
  className="w-72 rounded-2xl border border-white/10 bg-neutral-950/95 p-2 text-foreground shadow-[0_25px_80px_rgba(0,0,0,0.45)] backdrop-blur"
>
  <DropdownMenuGroup>
    <DropdownMenuLabel className="px-3 py-2">
      <div className="text-sm font-medium text-foreground">
        {user.email}
      </div>

      <div className="mt-1 text-xs leading-5 text-muted-foreground">
        New renders created while signed in are saved to your MotionAI history.
      </div>
    </DropdownMenuLabel>
  </DropdownMenuGroup>

  <DropdownMenuSeparator className="bg-white/10" />

  <DropdownMenuItem
    className="rounded-xl px-3 py-2.5 text-foreground focus:bg-white/8"
    onClick={() => {
      void signOut();
    }}
  >
    <LogOut className="h-4 w-4" />
    Sign out
  </DropdownMenuItem>
</DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button
              onClick={() => setModalOpen(true)}
              className="h-9 rounded-full border border-white/10 bg-white px-5 text-black hover:bg-white/88"
            >
              <ShieldCheck className="mr-2 h-4 w-4" />
              Sign in
            </Button>
          )}
        </div>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center px-4 py-10">
          <button
            type="button"
            aria-label="Close sign in modal"
            className="absolute inset-0 bg-black/72 backdrop-blur-sm"
            onClick={() => setModalOpen(false)}
          />
          <div className="relative w-full max-w-md overflow-hidden rounded-[28px] border border-white/10 bg-neutral-950/90 shadow-[0_35px_120px_rgba(0,0,0,0.55)] backdrop-blur-xl">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 opacity-60"
              style={{
                background:
                  "radial-gradient(circle at top, rgba(255,255,255,0.15), transparent 30%), radial-gradient(circle at 20% 80%, rgba(255,120,45,0.18), transparent 35%)",
              }}
            />
            <div className="relative space-y-6 p-6 sm:p-7">
              <div className="space-y-3">
                <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
                  <ShieldCheck className="h-3.5 w-3.5 text-white" />
                  Project history
                </div>
                <div className="space-y-2">
                  <h2 className="text-2xl font-semibold tracking-tight text-foreground">
                    Save your MotionAI workspace
                  </h2>
                  <p className="text-sm leading-6 text-muted-foreground">
                    {authDescription}
                  </p>
                </div>
              </div>

              <div className="inline-flex rounded-full border border-white/10 bg-white/[0.04] p-1">
                <button
                  type="button"
                  onClick={() => {
                    setMode("sign-in");
                    setError(null);
                    setFeedback(null);
                  }}
                  className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                    mode === "sign-in"
                      ? "bg-white text-black"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Sign in
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode("sign-up");
                    setError(null);
                    setFeedback(null);
                  }}
                  className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                    mode === "sign-up"
                      ? "bg-white text-black"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Create account
                </button>
              </div>

              <div className="space-y-4">
                <label className="space-y-2">
                  <div className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
                    Email
                  </div>
                  <Input
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@studio.com"
                    className="h-11 rounded-2xl border-white/10 bg-white/[0.04] px-4 text-foreground placeholder:text-muted-foreground/50"
                  /><br/>
                </label>

                <label className="space-y-2">
                  <div className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
                    Password
                  </div>
                  <Input
                    type="password"
                    autoComplete={
                      mode === "sign-in" ? "current-password" : "new-password"
                    }
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="At least 6 characters"
                    className="h-11 rounded-2xl border-white/10 bg-white/[0.04] px-4 text-foreground placeholder:text-muted-foreground/50"
                  />
                </label>
              </div>

              {error && (
                <div className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  {error}
                </div>
              )}

              {feedback && (
                <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-foreground">
                  {feedback}
                </div>
              )}

              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="text-sm text-muted-foreground transition hover:text-foreground"
                >
                  Continue as guest
                </button>
                <Button
                  onClick={() => void handleSubmit()}
                  disabled={
                    !authAvailable ||
                    isSubmitting ||
                    email.trim().length === 0 ||
                    password.length < 6
                  }
                  className="h-11 rounded-full px-5 text-sm font-medium"
                >
                  {isSubmitting ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <UserRound className="mr-2 h-4 w-4" />
                  )}
                  {mode === "sign-in" ? "Sign in" : "Create account"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
