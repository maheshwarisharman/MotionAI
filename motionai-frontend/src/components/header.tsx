import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Play } from "lucide-react";

export default function Header() {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
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
          <Button
            render={<Link href="/signup" />}
            className="rounded-md px-6 h-9 bg-blue-600 hover:bg-blue-700 text-white border-0"
          >
            Sign Up
          </Button>
        </div>
      </div>
    </header>
  );
}
