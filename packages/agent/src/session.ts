/**
 * @alfred/agent - Session Manager
 *
 * Manages conversation sessions: creation, retrieval, message appending,
 * persistence to ALFRED_HOME/sessions/, and archival of inactive sessions.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { nanoid } from 'nanoid';
import { resolveAlfredHome } from '@alfred/core';
import type { Message } from '@alfred/core';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Session {
  /** Unique session identifier */
  id: string;
  /** Agent that owns this session */
  agentId: string;
  /** Channel this session is operating on */
  channel: string;
  /** Conversation messages */
  messages: Message[];
  /** Unix epoch ms when the session was created */
  startedAt: number;
  /** Unix epoch ms of the last activity */
  lastActivity: number;
  /** Arbitrary metadata attached to the session */
  metadata: Record<string, unknown>;
  /** Optional parent session ID (for forked / continued conversations) */
  parentId?: string;
}

export interface SessionManagerOptions {
  /** Override the sessions directory (defaults to ALFRED_HOME/sessions/) */
  sessionsDir?: string;
  /** Timeout in ms after which idle sessions are eligible for archival (default: 24h) */
  archiveTimeout?: number;
}

// ---------------------------------------------------------------------------
// SessionManager
// ---------------------------------------------------------------------------

export class SessionManager {
  private sessions: Map<string, Session> = new Map();
  private sessionsDir: string;
  private archiveTimeout: number;

  constructor(options: SessionManagerOptions = {}) {
    const home = resolveAlfredHome();
    this.sessionsDir = options.sessionsDir ?? join(home, 'sessions');
    this.archiveTimeout = options.archiveTimeout ?? 24 * 60 * 60 * 1000; // 24 hours

    // Ensure directories exist
    if (!existsSync(this.sessionsDir)) {
      mkdirSync(this.sessionsDir, { recursive: true });
    }
    const archiveDir = join(this.sessionsDir, 'archive');
    if (!existsSync(archiveDir)) {
      mkdirSync(archiveDir, { recursive: true });
    }

    // Load existing sessions from disk
    this.loadSessions();
  }

  /**
   * Create a new session.
   */
  create(agentId: string, channel: string, parentId?: string): Session {
    const now = Date.now();
    const session: Session = {
      id: nanoid(),
      agentId,
      channel,
      messages: [],
      startedAt: now,
      lastActivity: now,
      metadata: {},
      parentId,
    };

    this.sessions.set(session.id, session);
    this.persistSession(session);

    return session;
  }

  /**
   * Get a session by ID.
   */
  get(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * List sessions, optionally filtered by agentId.
   */
  list(agentId?: string): Session[] {
    const all = Array.from(this.sessions.values());
    if (agentId) {
      return all.filter((s) => s.agentId === agentId);
    }
    return all;
  }

  /**
   * Add a message to a session.
   */
  addMessage(sessionId: string, message: Message): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    session.messages.push(message);
    session.lastActivity = Date.now();
    this.persistSession(session);
  }

  /**
   * Update session metadata.
   */
  updateMetadata(sessionId: string, metadata: Record<string, unknown>): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    session.metadata = { ...session.metadata, ...metadata };
    session.lastActivity = Date.now();
    this.persistSession(session);
  }

  /**
   * Replace the messages array for a session (used after compaction).
   */
  replaceMessages(sessionId: string, messages: Message[]): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    session.messages = messages;
    session.lastActivity = Date.now();
    this.persistSession(session);
  }

  /**
   * Archive sessions that have been idle longer than the archiveTimeout.
   * Returns the number of sessions archived.
   */
  archiveInactive(): number {
    const now = Date.now();
    let archived = 0;

    for (const [id, session] of this.sessions) {
      if (now - session.lastActivity > this.archiveTimeout) {
        this.archiveSession(session);
        this.sessions.delete(id);
        archived++;
      }
    }

    return archived;
  }

  /**
   * Delete a session entirely (removes from memory and disk).
   */
  delete(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    this.sessions.delete(sessionId);
    this.deleteSessionFile(sessionId);
    return true;
  }

  /**
   * Check if a session is considered active (had recent activity).
   */
  isActive(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    return Date.now() - session.lastActivity < this.archiveTimeout;
  }

  /**
   * Get the path to the sessions directory.
   */
  getSessionsDir(): string {
    return this.sessionsDir;
  }

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  /**
   * Persist a session to disk as JSON.
   */
  private persistSession(session: Session): void {
    const filePath = join(this.sessionsDir, `${session.id}.json`);
    try {
      writeFileSync(filePath, JSON.stringify(session, null, 2), 'utf-8');
    } catch (err) {
      // Log but don't throw -- persistence failure shouldn't crash the agent
      console.error(`Failed to persist session ${session.id}:`, err);
    }
  }

  /**
   * Archive a session by moving its file to the archive subdirectory.
   */
  private archiveSession(session: Session): void {
    const archiveDir = join(this.sessionsDir, 'archive');
    const archivePath = join(archiveDir, `${session.id}.json`);
    const sourcePath = join(this.sessionsDir, `${session.id}.json`);

    try {
      writeFileSync(archivePath, JSON.stringify(session, null, 2), 'utf-8');
      // Remove original file
      this.deleteSessionFile(session.id);
    } catch (err) {
      console.error(`Failed to archive session ${session.id}:`, err);
    }
  }

  /**
   * Delete a session file from the sessions directory.
   */
  private deleteSessionFile(sessionId: string): void {
    const filePath = join(this.sessionsDir, `${sessionId}.json`);
    try {
      if (existsSync(filePath)) {
        unlinkSync(filePath);
      }
    } catch (err) {
      console.error(`Failed to delete session file ${sessionId}:`, err);
    }
  }

  /**
   * Load all sessions from the sessions directory on startup.
   */
  private loadSessions(): void {
    try {
      if (!existsSync(this.sessionsDir)) return;

      const files = readdirSync(this.sessionsDir);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        const filePath = join(this.sessionsDir, file);
        try {
          const data = readFileSync(filePath, 'utf-8');
          const session: Session = JSON.parse(data);
          if (session.id) {
            this.sessions.set(session.id, session);
          }
        } catch (err) {
          console.error(`Failed to load session from ${file}:`, err);
        }
      }
    } catch (err) {
      console.error('Failed to load sessions directory:', err);
    }
  }
}
