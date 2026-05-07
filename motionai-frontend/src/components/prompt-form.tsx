"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ArrowUp, Loader2, CheckCircle2 } from "lucide-react";

type RenderStatus =
  | "idle"
  | "submitting"
  | "queued"
  | "progress"
  | "completed"
  | "failed";

export function PromptForm() {
  const [prompt, setPrompt] = useState("");
  const [status, setStatus] = useState<RenderStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number>(0);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [estimatedWait, setEstimatedWait] = useState<number | null>(null);

  // Default to localhost:3000 if not specified in env
  const BACKEND_URL =
    process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3000";

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!prompt.trim()) return;

    setStatus("submitting");
    setError(null);
    setVideoUrl(null);
    setProgress(0);

    try {
      const res = await fetch(`${BACKEND_URL}/api/animation/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        // We omit the complex configurations to keep the UI clean
        // and send standard defaults for an infographic.
        body: JSON.stringify({
          prompt: prompt.trim(),
          duration: 30, // Default duration in seconds
          resolution: "1080p",
          style: "modern",
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to start generation");
      }

      const data = await res.json();
      setEstimatedWait(data.estimatedWaitSeconds || null);
      setStatus("queued");

      // Start polling the job status
      pollStatus(data.jobId);
    } catch (err: unknown) {
      console.error(err);
      setError(
        err instanceof Error ? err.message : "An unexpected error occurred",
      );
      setStatus("failed");
    }
  };

  const pollStatus = async (jobId: string) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/animation/status/${jobId}`);

      if (!res.ok) {
        throw new Error("Failed to fetch status");
      }

      const data = await res.json();

      if (data.status === "completed") {
        setStatus("completed");
        setVideoUrl(data.downloadUrl || null);
        return;
      }

      if (data.status === "failed") {
        setStatus("failed");
        setError(data.error || "Generation failed during processing");
        return;
      }

      // Update progress and wait times if available
      setStatus(data.status); // Usually 'queued' or 'progress'
      if (typeof data.progress === "number") {
        setProgress(data.progress);
      }
      if (typeof data.estimatedWaitSeconds === "number") {
        setEstimatedWait(data.estimatedWaitSeconds);
      }

      // Poll again after 2 seconds
      setTimeout(() => pollStatus(jobId), 2000);
    } catch (err: unknown) {
      console.error("Polling error:", err);
      // In case of a network hiccup, try again after a slightly longer delay
      setTimeout(() => pollStatus(jobId), 4000);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const isWorking =
    status === "submitting" || status === "queued" || status === "progress";

  return (
    <div className="w-full max-w-3xl mx-auto flex flex-col items-center">
      <div className="w-full bg-card border border-border rounded-xl shadow-sm flex flex-col focus-within:ring-1 focus-within:ring-border transition-all duration-300">
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isWorking}
          placeholder="Describe the infographic video you want to generate..."
          className="min-h-[140px] resize-none border-0 focus-visible:ring-0 shadow-none text-base md:text-lg bg-transparent p-5 placeholder:text-muted-foreground/70 disabled:opacity-50"
        />

        <div className="flex items-center justify-between p-3 border-t border-border/50 bg-muted/10 rounded-b-xl">
          <div className="flex items-center gap-2 text-sm font-medium pl-2">
            {status === "submitting" && (
              <span className="text-muted-foreground flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Initializing...
              </span>
            )}
            {status === "queued" && (
              <span className="text-muted-foreground flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Queued. Estimated wait: {estimatedWait ?? "--"}s
              </span>
            )}
            {status === "progress" && (
              <span className="text-primary flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Generating: {Math.round(progress)}%
              </span>
            )}
            {status === "failed" && (
              <span className="text-destructive">Error: {error}</span>
            )}
            {status === "completed" && (
              <span className="text-green-500 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4" />
                Ready!
              </span>
            )}
          </div>

          <Button
            onClick={handleSubmit}
            disabled={!prompt.trim() || isWorking}
            size="icon"
            className="rounded-md w-9 h-9 bg-foreground text-background hover:bg-foreground/90 transition-colors shrink-0"
          >
            {isWorking ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <ArrowUp className="w-4 h-4" />
            )}
          </Button>
        </div>
      </div>

      {videoUrl && (
        <div className="mt-12 w-full overflow-hidden rounded-xl border border-border bg-black shadow-lg animate-in fade-in zoom-in-95 duration-500">
          <video
            src={videoUrl}
            controls
            autoPlay
            className="w-full aspect-video object-contain"
          />
        </div>
      )}
    </div>
  );
}
