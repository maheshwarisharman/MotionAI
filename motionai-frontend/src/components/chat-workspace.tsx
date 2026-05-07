"use client";

import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import type { KeyboardEvent } from "react";
import {
  ArrowUp,
  CheckCircle2,
  Loader2,
  MessageSquareText,
  PlayCircle,
  Sparkles,
  Wifi,
  WifiOff,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

type Message = {
  id: string;
  project_id: string;
  created_at: string;
  role: "user" | "assistant";
  content: string;
  job_id: string | null;
  message_type: "initial_generate" | "edit" | "completion" | "error";
};

type Project = {
  id: string;
  title: string;
  style: "modern" | "minimal" | "bold" | "corporate";
  duration: number;
  resolution: "720p" | "1080p";
  latest_job_id: string | null;
  latest_video_url: string | null;
};

type LatestJobStatus =
  | {
      jobId: string;
      status: "queued";
      position: number;
      estimatedWaitSeconds?: number;
    }
  | {
      jobId: string;
      status: "rendering";
      progress: number;
    }
  | {
      jobId: string;
      status: "completed";
      downloadUrl: string;
      duration: number;
      resolution: string;
    }
  | {
      jobId: string;
      status: "failed";
      error: string;
    }
  | {
      jobId?: string;
      status: "creating";
    }
  | {
      jobId?: string;
      status: "idle";
    };

type ProjectSnapshotEvent = {
  type: "project.snapshot";
  projectId: string;
  project: Project;
  messages: Message[];
  latestJobStatus:
    | {
        jobId: string;
        status: "queued";
        position: number;
      }
    | {
        jobId: string;
        status: "rendering";
        progress: number;
      }
    | {
        jobId: string;
        status: "completed";
        downloadUrl: string;
        duration: number;
        resolution: string;
      }
    | {
        jobId: string;
        status: "failed";
        error: string;
      }
    | null;
};

type RealtimeEvent =
  | {
      type: "connection.ready";
      connectionId: string;
      timestamp: string;
    }
  | {
      type: "subscription.confirmed";
      scope: "job" | "project";
      projectId?: string;
      jobId?: string;
      timestamp: string;
    }
  | {
      type: "error";
      error: string;
      timestamp: string;
    }
  | ProjectSnapshotEvent
  | {
      type: "project.updated";
      projectId: string;
      project: Project;
      timestamp: string;
    }
  | {
      type: "project.message.created";
      projectId: string;
      message: Message;
      timestamp: string;
    }
  | {
      type: "render.job.queued";
      jobId: string;
      projectId?: string;
      status: "queued";
      position: number;
      estimatedWaitSeconds: number;
      timestamp: string;
    }
  | {
      type: "render.job.progress";
      jobId: string;
      projectId?: string;
      status: "rendering";
      progress: number;
      stage: string;
      timestamp: string;
    }
  | {
      type: "render.job.completed";
      jobId: string;
      projectId?: string;
      status: "completed";
      downloadUrl: string;
      duration: number;
      resolution: string;
      timestamp: string;
    }
  | {
      type: "render.job.failed";
      jobId: string;
      projectId?: string;
      status: "failed";
      error: string;
      timestamp: string;
    };

type PendingMessage = {
  id: string;
  content: string;
};

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3000";

function getWebSocketUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  url.search = "";
  return url.toString();
}

function statusLabel(jobStatus: LatestJobStatus): string {
  switch (jobStatus.status) {
    case "creating":
      return "Creating your project…";
    case "queued":
      return `Queued. ETA ${jobStatus.estimatedWaitSeconds ?? "--"}s`;
    case "rendering":
      return `Generating video: ${Math.round(jobStatus.progress)}%`;
    case "completed":
      return "Render complete";
    case "failed":
      return jobStatus.error;
    case "idle":
      return "Ready for your next edit";
  }
}

function statusTone(jobStatus: LatestJobStatus): string {
  switch (jobStatus.status) {
    case "failed":
      return "text-destructive";
    case "completed":
      return "text-emerald-400";
    case "rendering":
    case "queued":
    case "creating":
      return "text-sky-300";
    case "idle":
      return "text-muted-foreground";
  }
}

export function ChatWorkspace() {
  const [draft, setDraft] = useState("");
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [project, setProject] = useState<Project | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [pendingMessages, setPendingMessages] = useState<PendingMessage[]>([]);
  const [jobStatus, setJobStatus] = useState<LatestJobStatus>({
    status: "idle",
  });
  const [videoByJobId, setVideoByJobId] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<
    "idle" | "connecting" | "connected" | "reconnecting" | "error"
  >("idle");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const messageEndRef = useRef<HTMLDivElement | null>(null);
  const socketRef = useRef<WebSocket | null>(null);

  const visibleMessages = [
    ...messages.map((message) => ({ ...message, isPending: false })),
    ...pendingMessages.map((message) => ({
      id: message.id,
      project_id: projectId ?? "pending",
      created_at: new Date().toISOString(),
      role: "user" as const,
      content: message.content,
      job_id: null,
      message_type: projectId ? "edit" as const : "initial_generate" as const,
      isPending: true,
    })),
  ];

  const latestVideoUrl =
    jobStatus.status === "completed"
      ? jobStatus.downloadUrl
      : project?.latest_job_id && videoByJobId[project.latest_job_id]
        ? videoByJobId[project.latest_job_id]
        : project?.latest_video_url ?? null;

  const isJobActive =
    jobStatus.status === "creating" ||
    jobStatus.status === "queued" ||
    jobStatus.status === "rendering";

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [visibleMessages, jobStatus]);

  const handleRealtimeEvent = useEffectEvent((event: RealtimeEvent) => {
    if (event.type === "error") {
      setError(event.error);
      return;
    }

    if (event.type === "project.snapshot") {
      setProject(event.project);
      setMessages(event.messages);

      if (event.project.latest_job_id && event.project.latest_video_url) {
        setVideoByJobId((current) => ({
          ...current,
          [event.project.latest_job_id]: event.project.latest_video_url,
        }));
      }

      if (!event.latestJobStatus) {
        setJobStatus({ status: "idle" });
      } else if (event.latestJobStatus.status === "queued") {
        setJobStatus({
          jobId: event.latestJobStatus.jobId,
          status: "queued",
          position: event.latestJobStatus.position,
        });
      } else if (event.latestJobStatus.status === "rendering") {
        setJobStatus({
          jobId: event.latestJobStatus.jobId,
          status: "rendering",
          progress: event.latestJobStatus.progress,
        });
      } else if (event.latestJobStatus.status === "completed") {
        setJobStatus(event.latestJobStatus);
        setVideoByJobId((current) => ({
          ...current,
          [event.latestJobStatus.jobId]: event.latestJobStatus.downloadUrl,
        }));
      } else {
        setJobStatus(event.latestJobStatus);
      }

      setPendingMessages((current) =>
        current.filter(
          (pending) =>
            !event.messages.some(
              (message) =>
                message.role === "user" && message.content === pending.content,
            ),
        ),
      );

      return;
    }

    if (event.type === "project.updated") {
      setProject(event.project);
      if (event.project.latest_job_id && event.project.latest_video_url) {
        setVideoByJobId((current) => ({
          ...current,
          [event.project.latest_job_id]: event.project.latest_video_url,
        }));
      }
      return;
    }

    if (event.type === "project.message.created") {
      setMessages((current) => {
        if (current.some((message) => message.id === event.message.id)) {
          return current;
        }
        return [...current, event.message];
      });

      if (event.message.role === "user") {
        setPendingMessages((current) =>
          current.filter((pending) => pending.content !== event.message.content),
        );
      }
      return;
    }

    if (event.type === "render.job.queued") {
      setJobStatus({
        jobId: event.jobId,
        status: "queued",
        position: event.position,
        estimatedWaitSeconds: event.estimatedWaitSeconds,
      });
      return;
    }

    if (event.type === "render.job.progress") {
      setJobStatus({
        jobId: event.jobId,
        status: "rendering",
        progress: event.progress,
      });
      return;
    }

    if (event.type === "render.job.completed") {
      setJobStatus(event);
      setVideoByJobId((current) => ({
        ...current,
        [event.jobId]: event.downloadUrl,
      }));
      return;
    }

    if (event.type === "render.job.failed") {
      setJobStatus(event);
    }
  });

  useEffect(() => {
    if (!projectId) {
      return;
    }

    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      setConnectionState((current) =>
        current === "connected" ? current : "connecting",
      );

      const socket = new WebSocket(getWebSocketUrl(BACKEND_URL));
      socketRef.current = socket;

      socket.addEventListener("open", () => {
        if (cancelled) {
          socket.close();
          return;
        }

        setConnectionState("connected");
        socket.send(
          JSON.stringify({
            type: "subscribe_project",
            projectId,
          }),
        );
      });

      socket.addEventListener("message", (rawEvent) => {
        try {
          const event = JSON.parse(rawEvent.data) as RealtimeEvent;
          handleRealtimeEvent(event);
        } catch {
          setError("Received an invalid realtime update from the server.");
        }
      });

      socket.addEventListener("close", () => {
        if (cancelled) {
          return;
        }

        setConnectionState("reconnecting");
        reconnectTimer = setTimeout(connect, 1500);
      });

      socket.addEventListener("error", () => {
        setConnectionState("error");
      });
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [projectId, handleRealtimeEvent]);

  const submitPrompt = async () => {
    const content = draft.trim();
    if (!content || isSubmitting) {
      return;
    }

    const pendingId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setWorkspaceOpen(true);
    setPendingMessages((current) => [...current, { id: pendingId, content }]);
    setDraft("");
    setError(null);
    setIsSubmitting(true);

    try {
      if (!projectId) {
        setJobStatus({ status: "creating" });

        const response = await fetch(`${BACKEND_URL}/api/projects`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            prompt: content,
            duration: 30,
            resolution: "1080p",
            style: "modern",
          }),
        });

        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload.error || "Failed to create project");
        }

        const payload = await response.json();
        setProjectId(payload.projectId);
        setJobStatus({
          jobId: payload.jobId,
          status: "queued",
          position: 0,
          estimatedWaitSeconds: payload.estimatedWaitSeconds,
        });
      } else {
        const response = await fetch(`${BACKEND_URL}/api/projects/${projectId}/chat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: content,
          }),
        });

        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload.error || "Failed to send edit request");
        }

        const payload = await response.json();
        setJobStatus({
          jobId: payload.jobId,
          status: "queued",
          position: 0,
          estimatedWaitSeconds: payload.estimatedWaitSeconds,
        });
      }
    } catch (submissionError) {
      setPendingMessages((current) =>
        current.filter((message) => message.id !== pendingId),
      );
      setDraft(content);
      const message =
        submissionError instanceof Error
          ? submissionError.message
          : "Something went wrong while sending your request.";
      setError(message);
      setJobStatus({
        status: "failed",
        error: message,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submitPrompt();
    }
  };

  if (!workspaceOpen) {
    return (
      <main className="flex-1 flex flex-col items-center justify-center px-4 md:px-8 py-20">
        <div className="text-center max-w-4xl w-full space-y-6 mb-12 animate-in fade-in slide-in-from-bottom-4 duration-1000">
          <div className="inline-flex items-center gap-2 rounded-full border border-sky-400/20 bg-sky-500/10 px-4 py-1.5 text-sm text-sky-200">
            <Sparkles className="h-4 w-4" />
            Live generation in chat
          </div>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight text-foreground">
            What do you want to create?
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto">
            Start with a prompt, then continue in the full chat while MotionAI
            streams progress and delivers the finished video in place.
          </p>
        </div>

        <div className="w-full max-w-3xl mx-auto animate-in fade-in zoom-in-95 duration-700 delay-150 fill-mode-both">
          <div className="w-full rounded-[28px] border border-white/10 bg-neutral-950/80 shadow-[0_30px_120px_rgba(0,0,0,0.45)] backdrop-blur">
            <Textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isSubmitting}
              placeholder="Describe the animation you want to generate..."
              className="min-h-[160px] resize-none border-0 bg-transparent p-6 text-base md:text-lg shadow-none focus-visible:ring-0"
            />

            <div className="flex items-center justify-between border-t border-white/10 px-4 py-3">
              <div className="pl-2 text-sm text-muted-foreground">
                The full chat opens as soon as you generate.
              </div>
              <Button
                onClick={() => void submitPrompt()}
                disabled={!draft.trim() || isSubmitting}
                size="icon"
                className="h-10 w-10 rounded-xl bg-sky-400 text-slate-950 hover:bg-sky-300"
              >
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ArrowUp className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex-1 px-4 md:px-8 py-6">
      <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-6 xl:grid xl:grid-cols-[minmax(0,1.3fr)_420px]">
        <Card className="min-h-[calc(100vh-9rem)] border-white/10 bg-neutral-950/70 shadow-[0_25px_80px_rgba(0,0,0,0.35)] backdrop-blur">
          <CardHeader className="border-b border-white/10">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="space-y-1">
                <CardTitle className="text-xl">
                  {project?.title || "New MotionAI project"}
                </CardTitle>
                <CardDescription>
                  Stay in chat while the backend streams progress and drops the
                  rendered video here as soon as it finishes.
                </CardDescription>
              </div>

              <div className="flex items-center gap-3">
                <div
                  className={`inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1 text-sm ${statusTone(jobStatus)}`}
                >
                  {connectionState === "connected" ? (
                    <Wifi className="h-4 w-4" />
                  ) : (
                    <WifiOff className="h-4 w-4" />
                  )}
                  {statusLabel(jobStatus)}
                </div>
              </div>
            </div>
          </CardHeader>

          <CardContent className="flex h-full flex-1 flex-col px-0">
            <div className="flex-1 space-y-6 overflow-y-auto px-4 py-5 md:px-6">
              {visibleMessages.map((message) => {
                const isAssistant = message.role === "assistant";
                const videoUrl =
                  message.job_id ? videoByJobId[message.job_id] : null;

                return (
                  <div
                    key={message.id}
                    className={`flex items-start gap-3 ${isAssistant ? "" : "justify-end"}`}
                  >
                    {isAssistant && (
                      <Avatar className="mt-1">
                        <AvatarFallback>AI</AvatarFallback>
                      </Avatar>
                    )}

                    <div
                      className={`max-w-[85%] space-y-3 rounded-3xl px-4 py-3 ${
                        isAssistant
                          ? "bg-white/5 text-foreground ring-1 ring-white/10"
                          : "bg-sky-400 text-slate-950"
                      } ${"isPending" in message && message.isPending ? "opacity-75" : ""}`}
                    >
                      <p className="whitespace-pre-wrap text-sm leading-6 md:text-[15px]">
                        {message.content}
                      </p>

                      {videoUrl && (
                        <div className="overflow-hidden rounded-2xl border border-white/10 bg-black">
                          <video
                            src={videoUrl}
                            controls
                            className="aspect-video w-full object-contain"
                          />
                        </div>
                      )}

                      {"isPending" in message && message.isPending && (
                        <div className="flex items-center gap-2 text-xs opacity-80">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Sending…
                        </div>
                      )}
                    </div>

                    {!isAssistant && (
                      <Avatar className="mt-1">
                        <AvatarFallback>YU</AvatarFallback>
                      </Avatar>
                    )}
                  </div>
                );
              })}

              {error && (
                <div className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  {error}
                </div>
              )}

              <div ref={messageEndRef} />
            </div>

            <div className="border-t border-white/10 px-4 py-4 md:px-6">
              <div className="rounded-[24px] border border-white/10 bg-black/30">
                <Textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={isSubmitting || isJobActive}
                  placeholder={
                    isJobActive
                      ? "Wait for the current render to finish before sending another edit…"
                      : "Ask for an edit, a new scene, or a refinement…"
                  }
                  className="min-h-[120px] resize-none border-0 bg-transparent p-5 shadow-none focus-visible:ring-0"
                />

                <div className="flex items-center justify-between border-t border-white/10 px-4 py-3">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <MessageSquareText className="h-4 w-4" />
                    {project
                      ? `${project.style} · ${project.duration}s · ${project.resolution}`
                      : "Preparing your project"}
                  </div>

                  <Button
                    onClick={() => void submitPrompt()}
                    disabled={!draft.trim() || isSubmitting || isJobActive}
                    size="icon"
                    className="h-10 w-10 rounded-xl bg-sky-400 text-slate-950 hover:bg-sky-300"
                  >
                    {isSubmitting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <ArrowUp className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="border-white/10 bg-neutral-950/70 shadow-[0_25px_80px_rgba(0,0,0,0.35)] backdrop-blur">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                <PlayCircle className="h-5 w-5 text-sky-300" />
                Latest Render
              </CardTitle>
              <CardDescription>
                The newest completed video appears here automatically from the
                websocket stream.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {latestVideoUrl ? (
                <div className="overflow-hidden rounded-2xl border border-white/10 bg-black">
                  <video
                    src={latestVideoUrl}
                    controls
                    className="aspect-video w-full object-contain"
                  />
                </div>
              ) : (
                <div className="flex aspect-video items-center justify-center rounded-2xl border border-dashed border-white/15 bg-white/[0.03] text-sm text-muted-foreground">
                  Your video preview will appear here once rendering completes.
                </div>
              )}

              <div className={`flex items-center gap-2 text-sm ${statusTone(jobStatus)}`}>
                {jobStatus.status === "completed" ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : (
                  <Loader2
                    className={`h-4 w-4 ${isJobActive ? "animate-spin" : ""}`}
                  />
                )}
                {statusLabel(jobStatus)}
              </div>
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-neutral-950/70 shadow-[0_25px_80px_rgba(0,0,0,0.35)] backdrop-blur">
            <CardHeader>
              <CardTitle>Realtime Connection</CardTitle>
              <CardDescription>
                Frontend is now listening on the backend websocket instead of
                polling a status endpoint.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <div>Connection: {connectionState}</div>
              <div>Project ID: {projectId ?? "Creating..."}</div>
              <div>Messages: {messages.length + pendingMessages.length}</div>
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}
