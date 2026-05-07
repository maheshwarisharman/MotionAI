/**
 * DatabaseService — all Supabase read/write operations for projects and messages.
 *
 * Keeps all SQL-level concerns in one place so controllers stay thin.
 */

import { getSupabaseClient } from "./supabase.service.js";
import { logger } from "../utils/logger.js";
import type { Project, Message, EnrichedBrief } from "../types/index.js";

export class DatabaseService {
  // -------------------------------------------------------------------------
  // Projects
  // -------------------------------------------------------------------------

  /**
   * Creates a new project row.
   */
  async createProject(data: {
    title: string;
    style: Project["style"];
    duration: number;
    resolution: Project["resolution"];
  }): Promise<Project> {
    const db = getSupabaseClient();
    const { data: row, error } = await db
      .from("projects")
      .insert({
        title: data.title,
        style: data.style,
        duration: data.duration,
        resolution: data.resolution,
      })
      .select()
      .single();

    if (error) {
      logger.error({ msg: "DB: createProject failed", error: error.message });
      throw new Error(`Database error: ${error.message}`);
    }
    return row as Project;
  }

  /**
   * Retrieves a single project by ID.
   */
  async getProject(projectId: string): Promise<Project | null> {
    const db = getSupabaseClient();
    const { data: row, error } = await db
      .from("projects")
      .select("*")
      .eq("id", projectId)
      .single();

    if (error) {
      if (error.code === "PGRST116") return null; // row not found
      logger.error({ msg: "DB: getProject failed", error: error.message });
      throw new Error(`Database error: ${error.message}`);
    }
    return row as Project;
  }

  /**
   * Lists all projects ordered by most recently updated.
   */
  async listProjects(limit = 20, offset = 0): Promise<Project[]> {
    const db = getSupabaseClient();
    const { data: rows, error } = await db
      .from("projects")
      .select("*")
      .order("updated_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      logger.error({ msg: "DB: listProjects failed", error: error.message });
      throw new Error(`Database error: ${error.message}`);
    }
    return (rows ?? []) as Project[];
  }

  /**
   * Updates a project after a successful render:
   *  - stores the enriched brief for future edit calls (token saving)
   *  - records the latest job ID and video URL
   */
  async updateProjectAfterRender(
    projectId: string,
    data: {
      latestJobId: string;
      latestVideoUrl: string;
      enrichedBrief: EnrichedBrief;
    },
  ): Promise<void> {
    const db = getSupabaseClient();
    const { error } = await db
      .from("projects")
      .update({
        latest_job_id: data.latestJobId,
        latest_video_url: data.latestVideoUrl,
        enriched_brief: data.enrichedBrief,
        updated_at: new Date().toISOString(),
      })
      .eq("id", projectId);

    if (error) {
      logger.error({
        msg: "DB: updateProjectAfterRender failed",
        error: error.message,
      });
      throw new Error(`Database error: ${error.message}`);
    }
  }

  /**
   * Updates only the latest render metadata while preserving the stored enriched brief.
   */
  async updateProjectLatestRender(
    projectId: string,
    data: {
      latestJobId: string;
      latestVideoUrl: string;
    },
  ): Promise<void> {
    const db = getSupabaseClient();
    const { error } = await db
      .from("projects")
      .update({
        latest_job_id: data.latestJobId,
        latest_video_url: data.latestVideoUrl,
        updated_at: new Date().toISOString(),
      })
      .eq("id", projectId);

    if (error) {
      logger.error({
        msg: "DB: updateProjectLatestRender failed",
        error: error.message,
      });
      throw new Error(`Database error: ${error.message}`);
    }
  }

  // -------------------------------------------------------------------------
  // Messages
  // -------------------------------------------------------------------------

  /**
   * Inserts a new message row.
   */
  async createMessage(data: {
    projectId: string;
    role: Message["role"];
    content: string;
    jobId?: string;
    messageType: Message["message_type"];
  }): Promise<Message> {
    const db = getSupabaseClient();
    const { data: row, error } = await db
      .from("messages")
      .insert({
        project_id: data.projectId,
        role: data.role,
        content: data.content,
        job_id: data.jobId ?? null,
        message_type: data.messageType,
      })
      .select()
      .single();

    if (error) {
      logger.error({ msg: "DB: createMessage failed", error: error.message });
      throw new Error(`Database error: ${error.message}`);
    }
    return row as Message;
  }

  /**
   * Retrieves all messages for a project in chronological order.
   */
  async getMessages(projectId: string): Promise<Message[]> {
    const db = getSupabaseClient();
    const { data: rows, error } = await db
      .from("messages")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true });

    if (error) {
      logger.error({ msg: "DB: getMessages failed", error: error.message });
      throw new Error(`Database error: ${error.message}`);
    }
    return (rows ?? []) as Message[];
  }

  /**
   * Updates a message's job_id after the render job has been enqueued.
   */
  async setMessageJobId(messageId: string, jobId: string): Promise<void> {
    const db = getSupabaseClient();
    const { error } = await db
      .from("messages")
      .update({ job_id: jobId })
      .eq("id", messageId);

    if (error) {
      logger.error({ msg: "DB: setMessageJobId failed", error: error.message });
      // Non-fatal — log and continue
    }
  }

  /**
   * Appends an assistant "completion" message once a render finishes.
   */
  async recordCompletion(
    projectId: string,
    jobId: string,
    videoUrl: string,
  ): Promise<Message> {
    return this.createMessage({
      projectId,
      role: "assistant",
      content: `Render complete.`,
      jobId,
      messageType: "completion",
    });
  }

  /**
   * Appends an assistant "error" message when a render fails.
   */
  async recordError(
    projectId: string,
    jobId: string,
    reason: string,
  ): Promise<Message> {
    return this.createMessage({
      projectId,
      role: "assistant",
      content: `Render failed: ${reason}`,
      jobId,
      messageType: "error",
    });
  }
}

export const databaseService = new DatabaseService();
