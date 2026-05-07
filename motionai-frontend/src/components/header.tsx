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

      </div>

    </header>
  );
}
