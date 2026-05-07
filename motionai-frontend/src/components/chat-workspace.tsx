"use client";

import Image from "next/image";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import {
  ArrowUp,
  CheckCircle2,
  Clapperboard,
  FolderClock,
  ImagePlus,
  LockKeyhole,
  Loader2,
  MessageSquareText,
  Plus,
  PlayCircle,
  Sparkles,
  X,
  SlidersHorizontal,
  Wifi,
  WifiOff,
  User,
} from "lucide-react";
import { useAuth } from "@/components/auth-provider";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
  created_at?: string;
  updated_at?: string;
  user_id?: string | null;
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

type SelectedAttachment = {
  id: string;
  name: string;
  dataUrl: string;
};

const DURATION_OPTIONS = [15, 30, 45, 60] as const;
const RESOLUTION_OPTIONS = [
  { value: "720p", label: "Standard" },
  { value: "1080p", label: "High" },
] as const;
const STYLE_OPTIONS = [
  { value: "modern", label: "Modern" }
] as const;

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3000";
const MAX_ATTACHMENTS = 4;
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const PLACEHOLDER_PROMPTS = [
  "Generate a smooth 3D logo reveal with neon lighting.",
  "Animate my product photo into a cinematic 5-second ad.",
  "Create a minimal motion poster with floating typography.",
  "Make a bold kinetic text intro for my YouTube channel.",
  "Turn these images into a seamless parallax animation.",
  "Design a corporate explainer scene with clean transitions.",
  "Create a looping background animation for a landing page.",
] as const;

function useTypingPlaceholder({
  prompts,
  enabled,
}: {
  prompts: readonly string[];
  enabled: boolean;
}): string {
  const [text, setText] = useState("");
  const stateRef = useRef({
    promptIndex: 0,
    charIndex: 0,
    isDeleting: false,
  });
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      stateRef.current = { promptIndex: 0, charIndex: 0, isDeleting: false };
      return;
    }

    const safePrompts = prompts.filter((prompt) => prompt.trim().length > 0);
    if (safePrompts.length === 0) return;

    const tick = () => {
      const state = stateRef.current;
      const currentPrompt = safePrompts[state.promptIndex] ?? safePrompts[0]!;

      const typingDelayMs = 22 + Math.floor(Math.random() * 26); // 22..47
      const deletingDelayMs = 12 + Math.floor(Math.random() * 18); // 12..29
      const holdFullMs = 900;
      const holdEmptyMs = 250;

      if (!state.isDeleting) {
        state.charIndex = Math.min(state.charIndex + 1, currentPrompt.length);
        setText(currentPrompt.slice(0, state.charIndex));

        if (state.charIndex >= currentPrompt.length) {
          state.isDeleting = true;
          timeoutRef.current = window.setTimeout(tick, holdFullMs);
          return;
        }

        timeoutRef.current = window.setTimeout(tick, typingDelayMs);
        return;
      }

      state.charIndex = Math.max(state.charIndex - 1, 0);
      setText(currentPrompt.slice(0, state.charIndex));

      if (state.charIndex <= 0) {
        state.isDeleting = false;
        state.promptIndex = (state.promptIndex + 1) % safePrompts.length;
        timeoutRef.current = window.setTimeout(tick, holdEmptyMs);
        return;
      }

      timeoutRef.current = window.setTimeout(tick, deletingDelayMs);
    };

    tick();

    return () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [enabled, prompts]);

  return enabled && text.length > 0 ? text : "";
}

function getWebSocketUrl(baseUrl: string, accessToken?: string): string {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  url.search = "";
  if (accessToken) {
    url.searchParams.set("access_token", accessToken);
  }
  return url.toString();
}

function formatProjectTimestamp(value: string | undefined): string {
  if (!value) {
    return "Recently updated";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
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
      return "text-foreground";
    case "rendering":
    case "queued":
    case "creating":
      return "text-foreground";
    case "idle":
      return "text-muted-foreground";
  }
}

export function ChatWorkspace() {
  const { authAvailable, isAuthReady, session, user } = useAuth();
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<SelectedAttachment[]>([]);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [duration, setDuration] =
    useState<(typeof DURATION_OPTIONS)[number]>(30);
  const [resolution, setResolution] = useState<Project["resolution"]>("1080p");
  const [style, setStyle] = useState<Project["style"]>("modern");
  const [project, setProject] = useState<Project | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [pendingMessages, setPendingMessages] = useState<PendingMessage[]>([]);
  const [jobStatus, setJobStatus] = useState<LatestJobStatus>({
    status: "idle",
  });
  const [videoByJobId, setVideoByJobId] = useState<Record<string, string>>({});
  const [savedProjects, setSavedProjects] = useState<Project[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<
    "idle" | "connecting" | "connected" | "reconnecting" | "error"
  >("idle");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const messageEndRef = useRef<HTMLDivElement | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const animatedPlaceholder = useTypingPlaceholder({
    prompts: PLACEHOLDER_PROMPTS,
    enabled: !isSubmitting && draft.trim().length === 0,
  });

  const authHeaders = useMemo<Record<string, string>>(() => {
    if (!session?.access_token) {
      return {};
    }

    const headers: Record<string, string> = {};
    headers.Authorization = `Bearer ${session.access_token}`;
    return headers;
  }, [session?.access_token]);

  const visibleMessages = useMemo(
    () => [
      ...messages.map((message) => ({ ...message, isPending: false })),
      ...pendingMessages.map((message) => ({
        id: message.id,
        project_id: projectId ?? "pending",
        created_at: new Date().toISOString(),
        role: "user" as const,
        content: message.content,
        job_id: null,
        message_type: projectId
          ? ("edit" as const)
          : ("initial_generate" as const),
        isPending: true,
      })),
    ],
    [messages, pendingMessages, projectId],
  );

  const latestVideoUrl =
    jobStatus.status === "completed"
      ? jobStatus.downloadUrl
      : project?.latest_job_id && videoByJobId[project.latest_job_id]
        ? videoByJobId[project.latest_job_id]
        : (project?.latest_video_url ?? null);

  const isJobActive =
    jobStatus.status === "creating" ||
    jobStatus.status === "queued" ||
    jobStatus.status === "rendering";
  const showRenderingPlaceholder =
    jobStatus.status === "creating" ||
    jobStatus.status === "queued" ||
    jobStatus.status === "rendering";
  const canEditCurrentProject = !project?.user_id || project.user_id === user?.id;
  const accessRestrictionMessage =
    !user && project?.user_id
      ? "Sign back in to continue editing this saved project, or start a new guest project."
      : null;
  const displayError = error ?? accessRestrictionMessage;

  const resetWorkspace = () => {
    setWorkspaceOpen(false);
    setDraft("");
    setProject(null);
    setProjectId(null);
    setMessages([]);
    setPendingMessages([]);
    setJobStatus({ status: "idle" });
    setVideoByJobId({});
    setError(null);
    setConnectionState("idle");
    setAttachments([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const openProject = (nextProjectId: string) => {
    setWorkspaceOpen(true);
    setProjectId(nextProjectId);
    setProject(null);
    setMessages([]);
    setPendingMessages([]);
    setJobStatus({ status: "idle" });
    setError(null);
  };

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [visibleMessages, jobStatus]);

  useEffect(() => {
    if (!isAuthReady) {
      return;
    }

    if (!user || !session?.access_token) {
      return;
    }

    let cancelled = false;

    const loadSavedProjects = async () => {
      setIsHistoryLoading(true);
      setHistoryError(null);
      setSavedProjects([]);

      try {
        const response = await fetch(`${BACKEND_URL}/api/projects?limit=12`, {
          headers: {
            ...authHeaders,
          },
        });

        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload.error || "Failed to load saved projects");
        }

        const payload = (await response.json()) as { projects?: Project[] };
        if (!cancelled) {
          setSavedProjects(payload.projects ?? []);
        }
      } catch (historyLoadError) {
        if (!cancelled) {
          setHistoryError(
            historyLoadError instanceof Error
              ? historyLoadError.message
              : "Failed to load saved projects.",
          );
        }
      } finally {
        if (!cancelled) {
          setIsHistoryLoading(false);
        }
      }
    };

    void loadSavedProjects();

    return () => {
      cancelled = true;
    };
  }, [authHeaders, isAuthReady, session?.access_token, user]);

  const handleRealtimeEvent = useEffectEvent((event: RealtimeEvent) => {
    if (event.type === "error") {
      setError(event.error);
      return;
    }

    if (event.type === "project.snapshot") {
      setProject(event.project);
      setMessages(event.messages);
      setSavedProjects((current) => {
        if (!event.project.user_id) {
          return current;
        }

        const nextProjects = current.filter(
          (savedProject) => savedProject.id !== event.project.id,
        );
        return [event.project, ...nextProjects].slice(0, 12);
      });

      const latestJobId = event.project.latest_job_id;
      const latestVideoUrl = event.project.latest_video_url;
      if (
        typeof latestJobId === "string" &&
        latestJobId.length > 0 &&
        typeof latestVideoUrl === "string" &&
        latestVideoUrl.length > 0
      ) {
        setVideoByJobId((current) => ({
          ...current,
          [latestJobId]: latestVideoUrl,
        }));
      }

      const latestStatus = event.latestJobStatus;
      if (!latestStatus) {
      } else if (latestStatus.status === "queued") {
        setJobStatus({
          jobId: latestStatus.jobId,
          status: "queued",
          position: latestStatus.position,
        });
      } else if (latestStatus.status === "rendering") {
        setJobStatus({
          jobId: latestStatus.jobId,
          status: "rendering",
          progress: latestStatus.progress,
        });
      } else if (latestStatus.status === "completed") {
        setJobStatus(latestStatus);
        setVideoByJobId((current) => ({
          ...current,
          [latestStatus.jobId]: latestStatus.downloadUrl,
        }));
      } else {
        setJobStatus(latestStatus);
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
      setSavedProjects((current) => {
        if (!event.project.user_id) {
          return current;
        }

        const nextProjects = current.filter(
          (savedProject) => savedProject.id !== event.project.id,
        );
        return [event.project, ...nextProjects].slice(0, 12);
      });
      const latestJobId = event.project.latest_job_id;
      const latestVideoUrl = event.project.latest_video_url;
      if (
        typeof latestJobId === "string" &&
        latestJobId.length > 0 &&
        typeof latestVideoUrl === "string" &&
        latestVideoUrl.length > 0
      ) {
        setVideoByJobId((current) => ({
          ...current,
          [latestJobId]: latestVideoUrl,
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
          current.filter(
            (pending) => pending.content !== event.message.content,
          ),
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

      const socket = new WebSocket(
        getWebSocketUrl(BACKEND_URL, session?.access_token),
      );
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
  }, [projectId, session?.access_token]);

  const submitPrompt = async () => {
    const content = draft.trim();
    if (!content || isSubmitting || !canEditCurrentProject) {
      return;
    }

    let submitted = false;
    const referenceImages = attachments.map((attachment) => ({
      name: attachment.name,
      dataUrl: attachment.dataUrl,
    }));
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
            ...authHeaders,
          },
          body: JSON.stringify({
            prompt: content,
            duration,
            resolution,
            style,
            referenceImages,
          }),
        });

        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload.error || "Failed to create project");
        }

        const payload = await response.json();
        setProjectId(payload.projectId);
        if (user) {
          setSavedProjects((current) => {
            const draftProject: Project = {
              id: payload.projectId as string,
              title: content.slice(0, 60),
              style,
              duration,
              resolution,
              latest_job_id: payload.jobId as string,
              latest_video_url: null,
              user_id: user.id,
              updated_at: new Date().toISOString(),
            };

            const nextProjects = current.filter(
              (savedProject) => savedProject.id !== draftProject.id,
            );
            return [draftProject, ...nextProjects].slice(0, 12);
          });
        }
        setJobStatus({
          jobId: payload.jobId,
          status: "queued",
          position: 0,
          estimatedWaitSeconds: payload.estimatedWaitSeconds,
        });
        submitted = true;
      } else {
        const response = await fetch(
          `${BACKEND_URL}/api/projects/${projectId}/chat`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...authHeaders,
            },
            body: JSON.stringify({
              message: content,
              referenceImages,
            }),
          },
        );

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
        submitted = true;
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
      setJobStatus((previous) => ({
        jobId:
          "jobId" in previous && typeof previous.jobId === "string"
            ? previous.jobId
            : "unknown",
        status: "failed",
        error: message,
      }));
    } finally {
      if (submitted) {
        setAttachments([]);
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      }
      setIsSubmitting(false);
    }
  };

  const handleAttachmentPick = async (files: FileList | null) => {
    if (!files?.length) {
      return;
    }

    const fileList = Array.from(files);
    const remainingSlots = MAX_ATTACHMENTS - attachments.length;

    if (remainingSlots <= 0) {
      setError(`You can attach up to ${MAX_ATTACHMENTS} images per prompt.`);
      return;
    }

    const nextFiles = fileList.slice(0, remainingSlots);
    if (fileList.length > remainingSlots) {
      setError(`Only the first ${remainingSlots} image${remainingSlots === 1 ? "" : "s"} were added.`);
    } else {
      setError(null);
    }

    try {
      const prepared = await Promise.all(
        nextFiles.map(
          (file) =>
            new Promise<SelectedAttachment>((resolve, reject) => {
              if (!ACCEPTED_IMAGE_TYPES.has(file.type)) {
                reject(new Error(`${file.name} is not a supported image type.`));
                return;
              }

              if (file.size > MAX_ATTACHMENT_BYTES) {
                reject(new Error(`${file.name} exceeds the 5MB size limit.`));
                return;
              }

              const reader = new FileReader();
              reader.onload = () => {
                if (typeof reader.result !== "string") {
                  reject(new Error(`Could not read ${file.name}.`));
                  return;
                }

                resolve({
                  id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`,
                  name: file.name,
                  dataUrl: reader.result,
                });
              };
              reader.onerror = () => {
                reject(new Error(`Could not read ${file.name}.`));
              };
              reader.readAsDataURL(file);
            }),
        ),
      );

      setAttachments((current) => [...current, ...prepared]);
    } catch (attachmentError) {
      setError(
        attachmentError instanceof Error
          ? attachmentError.message
          : "Failed to attach image.",
      );
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const removeAttachment = (attachmentId: string) => {
    setAttachments((current) =>
      current.filter((attachment) => attachment.id !== attachmentId),
    );
    setError(null);
  };

  const attachmentSummary =
    attachments.length === 0
      ? `Attach up to ${MAX_ATTACHMENTS} images`
      : `${attachments.length}/${MAX_ATTACHMENTS} image${attachments.length === 1 ? "" : "s"} attached`;

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
          <div className="inline-flex items-center gap-2 rounded-md border border-white/10 bg-white/5 px-4 py-1.5 text-sm font-medium text-foreground uppercase tracking-widest shadow-sm">
            <Sparkles className="h-4 w-4 text-primary" />
            Live generation in chat
          </div>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight text-foreground">
            What do you want to create?
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto">
            Turn ideas into stunning infographic and animation videos in seconds. Our AI-powered SaaS transforms simple prompts into professional, engaging visual stories.
          </p>
        </div>

        <div className="w-full max-w-3xl mx-auto animate-in fade-in zoom-in-95 duration-700 delay-150 fill-mode-both">
          <div className="w-full overflow-hidden rounded-xl border border-white/10 bg-[#0a0a0a] shadow-2xl">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              multiple
              className="hidden"
              onChange={(event) => void handleAttachmentPick(event.target.files)}
            />
            <Textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isSubmitting}
              placeholder={animatedPlaceholder}
              style={{
                maxHeight: "30vh",
                overflow: "auto",
              }}
              className="min-h-[140px] resize-none border-0 bg-transparent p-6 text-base md:text-lg shadow-none focus-visible:ring-0 text-foreground placeholder:text-muted-foreground/60"
            />

            <div className="border-t border-white/5 bg-[#111] px-5 py-4">
              <div className="flex flex-col gap-5">
                <div className="rounded-xl border border-white/10 bg-black/25 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="space-y-1">
                      <div className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                        Attachments
                      </div>
                      <div className="text-sm text-muted-foreground/80">
                        {attachmentSummary}
                      </div>
                    </div>

                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isSubmitting || attachments.length >= MAX_ATTACHMENTS}
                      className="h-9 rounded-full border-white/10 bg-white/5 px-4 text-foreground hover:bg-white/10"
                    >
                      <ImagePlus className="mr-2 h-4 w-4" />
                      Upload images
                    </Button>
                  </div>

                  {attachments.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-3">
                      {attachments.map((attachment) => (
                        <div
                          key={attachment.id}
                          className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]"
                        >
                          <Image
                            src={attachment.dataUrl}
                            alt={attachment.name}
                            width={80}
                            height={80}
                            className="h-20 w-20 object-cover"
                          />
                          <button
                            type="button"
                            onClick={() => removeAttachment(attachment.id)}
                            className="absolute right-1.5 top-1.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-white opacity-0 transition-opacity group-hover:opacity-100"
                            aria-label={`Remove ${attachment.name}`}
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-4">
                  <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                    <SlidersHorizontal className="h-3.5 w-3.5" />
                    Settings
                  </div>

                  <div className="flex flex-wrap items-center gap-1 rounded-md border border-white/10 bg-black/40 p-1">
                    {DURATION_OPTIONS.map((option) => (
                      <button
                        key={option}
                        type="button"
                        onClick={() => setDuration(option)}
                        className={`rounded-[4px] px-3 py-1.5 text-xs font-medium transition-all ${
                          duration === option
                            ? "bg-white text-black shadow-sm"
                            : "bg-transparent text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {option}s
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <label className="space-y-2">
                    <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                      <Clapperboard className="h-3.5 w-3.5" />
                      Resolution
                    </div>
                    <Select
                      value={resolution}
                      onValueChange={(value) =>
                        setResolution(value as Project["resolution"])
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {RESOLUTION_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}{" "}
                            <span className="opacity-50 ml-1">
                              · {option.value}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>

                  <label className="space-y-2">
                    <div className="text-xs font-medium text-muted-foreground">
                      Art Style
                    </div>
                    <Select
                      value={style}
                      onValueChange={(value) =>
                        setStyle(value as Project["style"])
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {STYLE_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                </div>

                <div className="flex items-center justify-between gap-4 border-t border-white/5 pt-4 mt-2">
                  <div className="text-xs text-muted-foreground/80">
                  </div>
                  <Button
                    onClick={() => void submitPrompt()}
                    disabled={!draft.trim() || isSubmitting}
                    className="h-10 rounded-md bg-white px-6 font-medium text-black hover:bg-neutral-200 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 disabled:hover:scale-100"
                  >
                    {isSubmitting ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Sparkles className="mr-2 h-4 w-4" />
                    )}
                    Generate Video
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>

      </main>
    );
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col px-4 py-6 md:px-8">
      <div className="mx-auto flex min-h-0 w-full max-w-[1500px] flex-1 flex-col gap-6 xl:grid xl:grid-cols-[minmax(0,1.3fr)_420px]">
        <Card className="flex min-h-0 border-white/10 bg-neutral-950/70 shadow-[0_25px_80px_rgba(0,0,0,0.35)] backdrop-blur xl:h-[calc(100dvh-8rem)]">
          <CardHeader className="border-b border-white/10">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="space-y-1">
                <CardTitle className="text-xl">
                  {project?.title || "New MotionAI project"}
                </CardTitle>
                <CardDescription className="text-sm text-muted-foreground">
                  {project?.user_id
                    ? "Saved to your account history."
                    : "Guest project. Sign in before creating to save future projects."}
                </CardDescription>
              </div>

              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  onClick={resetWorkspace}
                  className="h-9 rounded-full border-white/10 bg-white/5 px-4 text-foreground hover:bg-white/10"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  New project
                </Button>
                <div
                  className={`inline-flex items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-sm font-medium ${statusTone(jobStatus)}`}
                >
                  {statusLabel(jobStatus)}
                </div>
              </div>
            </div>
          </CardHeader>

          <CardContent className="flex min-h-0 flex-1 flex-col px-0">
            <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 py-5 md:px-6">
              {visibleMessages.map((message) => {
                const isAssistant = message.role === "assistant";
                const videoUrl = message.job_id
                  ? videoByJobId[message.job_id]
                  : null;

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
                      className={`max-w-[85%] space-y-3 rounded-xl px-5 py-4 ${
                        isAssistant
                          ? "bg-white/[0.03] text-foreground border border-white/10 shadow-sm"
                          : "bg-neutral-100 text-neutral-950 shadow-sm"
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
                        <AvatarFallback>
                          <User className="h-4 w-4" aria-hidden="true" />
                        </AvatarFallback>
                      </Avatar>
                    )}
                  </div>
                );
              })}

              {showRenderingPlaceholder && (
                <div className="flex items-start gap-3">
                  <Avatar className="mt-1">
                    <AvatarFallback>AI</AvatarFallback>
                  </Avatar>
                  <div className="max-w-[85%] space-y-3 rounded-xl border border-white/10 bg-white/[0.03] px-5 py-4 shadow-sm">
                    <div className="flex items-center gap-3 text-sm leading-6 text-foreground">
                      <Loader2 className="h-4 w-4 animate-spin text-primary" />
                      <span>Generating your video preview. This may take a few moments.</span>
                    </div>
                  </div>
                </div>
              )}

              {displayError && (
                <div className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  {displayError}
                </div>
              )}

              <div ref={messageEndRef} />
            </div>

            <div className="border-t border-white/10 px-4 py-4 md:px-6 bg-[#0a0a0a]">
              <div className="rounded-xl border border-white/10 bg-[#111] shadow-sm">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  multiple
                  className="hidden"
                  onChange={(event) => void handleAttachmentPick(event.target.files)}
                />
                <Textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={isSubmitting || isJobActive || !canEditCurrentProject}
                  placeholder={
                    !canEditCurrentProject
                      ? "Sign in again to continue editing this saved project, or start a new guest project."
                      : isJobActive
                      ? "Wait for the current render to finish before sending another edit…"
                      : "Ask for an edit, a new scene, or a refinement…"
                  }
                  className="min-h-[120px] resize-none border-0 bg-transparent p-5 shadow-none focus-visible:ring-0 text-foreground placeholder:text-muted-foreground/60"
                />

                <div className="border-t border-white/5 bg-black/20 px-4 py-3 rounded-b-xl">
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground/80">
                        <MessageSquareText className="h-4 w-4" />
                        {project
                          ? `${project.style} · ${project.duration}s · ${project.resolution}`
                          : "Preparing your project"}
                      </div>

                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => fileInputRef.current?.click()}
                          disabled={
                            isSubmitting ||
                            isJobActive ||
                            !canEditCurrentProject ||
                            attachments.length >= MAX_ATTACHMENTS
                          }
                          className="h-9 rounded-full border-white/10 bg-white/5 px-4 text-foreground hover:bg-white/10"
                        >
                          <ImagePlus className="mr-2 h-4 w-4" />
                          Add images
                        </Button>

                        <Button
                          onClick={() => void submitPrompt()}
                          disabled={
                            !draft.trim() ||
                            isSubmitting ||
                            isJobActive ||
                            !canEditCurrentProject
                          }
                          className="h-9 rounded-md bg-white text-black hover:bg-neutral-200 px-4 font-medium"
                        >
                          {isSubmitting ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <ArrowUp className="mr-2 h-4 w-4" />
                          )}
                          Send
                        </Button>
                      </div>
                    </div>

                    {attachments.length > 0 && (
                      <div className="flex flex-wrap gap-3">
                        {attachments.map((attachment) => (
                          <div
                            key={attachment.id}
                            className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]"
                          >
                            <Image
                              src={attachment.dataUrl}
                              alt={attachment.name}
                              width={64}
                              height={64}
                              className="h-16 w-16 object-cover"
                            />
                            <button
                              type="button"
                              onClick={() => removeAttachment(attachment.id)}
                              className="absolute right-1 top-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white opacity-0 transition-opacity group-hover:opacity-100"
                              aria-label={`Remove ${attachment.name}`}
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                        <div className="flex items-center text-xs text-muted-foreground/75">
                          {attachmentSummary}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="border-white/10 bg-neutral-950/70 shadow-[0_25px_80px_rgba(0,0,0,0.35)] backdrop-blur">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                <PlayCircle className="h-5 w-5 text-foreground" />
                Latest Render
              </CardTitle>
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
                <div className="flex aspect-video items-center justify-center rounded-2xl border border-dashed border-white/15 bg-white/[0.03] text-sm text-muted-foreground p-3 text-center">
                  Your video preview will appear here once rendering completes.
                </div>
              )}

              <div
                className={`flex items-center gap-2 text-sm ${statusTone(jobStatus)}`}
              >
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


        </div>
      </div>
    </main>
  );
}
