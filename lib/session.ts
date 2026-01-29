/**
 * Session state management
 * Maintains in-memory state for uploaded workbooks and conversation history
 */

import { SessionDatabase } from '@/lib/db';
import type {
  ProcessedWorkbook,
  SchemaInfo,
  ConversationEntry,
  SessionState,
} from '@/lib/types';
import { generateId } from '@/lib/utils';

// ============================================================================
// Session Storage
// ============================================================================

interface SessionData {
  db: SessionDatabase;
  workbook: ProcessedWorkbook;
  schema: SchemaInfo;
  conversation: ConversationEntry[];
  lastAccess: Date;
}

// Cleanup old sessions after 30 minutes of inactivity
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Use globalThis to persist sessions across Next.js module re-instantiations
 * This is necessary because Next.js may re-import modules between API route calls
 */
const globalForSessions = globalThis as unknown as {
  sessions: Map<string, SessionData> | undefined;
};

/** In-memory session store (keyed by uploadId) - persisted via globalThis */
const sessions = globalForSessions.sessions ?? new Map<string, SessionData>();
globalForSessions.sessions = sessions;

// ============================================================================
// Session Management
// ============================================================================

/**
 * Create a new session for an uploaded workbook
 */
export async function createSession(
  workbook: ProcessedWorkbook,
  schema: SchemaInfo,
  db: SessionDatabase
): Promise<string> {
  const uploadId = workbook.uploadId;

  console.log(`[Session] Creating session: ${uploadId}`);
  
  sessions.set(uploadId, {
    db,
    workbook,
    schema,
    conversation: [],
    lastAccess: new Date(),
  });

  console.log(`[Session] Session created. Total sessions: ${sessions.size}`);
  console.log(`[Session] Available sessions: ${Array.from(sessions.keys()).join(', ')}`);

  // Schedule cleanup
  scheduleCleanup();

  return uploadId;
}

/**
 * Get an existing session
 */
export function getSession(uploadId: string): SessionData | null {
  console.log(`[Session] getSession called for: ${uploadId}`);
  console.log(`[Session] Available sessions: ${Array.from(sessions.keys()).join(', ') || '(none)'}`);
  
  const session = sessions.get(uploadId);
  
  if (session) {
    session.lastAccess = new Date();
    return session;
  }
  
  return null;
}

/**
 * Check if a session exists
 */
export function hasSession(uploadId: string): boolean {
  return sessions.has(uploadId);
}

/**
 * Delete a session and cleanup resources
 */
export async function deleteSession(uploadId: string): Promise<void> {
  const session = sessions.get(uploadId);
  
  if (session) {
    await session.db.close();
    sessions.delete(uploadId);
  }
}

// ============================================================================
// Conversation Management
// ============================================================================

/**
 * Add a conversation entry to a session
 */
export function addConversationEntry(
  uploadId: string,
  entry: Omit<ConversationEntry, 'id' | 'timestamp'>
): ConversationEntry | null {
  const session = sessions.get(uploadId);
  
  if (!session) {
    return null;
  }

  const fullEntry: ConversationEntry = {
    ...entry,
    id: generateId(),
    timestamp: new Date(),
  };

  session.conversation.push(fullEntry);

  // Keep only last 10 entries
  if (session.conversation.length > 10) {
    session.conversation = session.conversation.slice(-10);
  }

  return fullEntry;
}

/**
 * Get conversation history for a session
 */
export function getConversationHistory(uploadId: string): ConversationEntry[] {
  const session = sessions.get(uploadId);
  return session?.conversation || [];
}

/**
 * Clear conversation history for a session
 */
export function clearConversationHistory(uploadId: string): void {
  const session = sessions.get(uploadId);
  if (session) {
    session.conversation = [];
  }
}

// ============================================================================
// Cleanup
// ============================================================================

let cleanupScheduled = false;

/**
 * Schedule cleanup of expired sessions
 */
function scheduleCleanup(): void {
  if (cleanupScheduled) return;
  
  cleanupScheduled = true;
  
  setTimeout(async () => {
    cleanupScheduled = false;
    await cleanupExpiredSessions();
    
    // Reschedule if there are still sessions
    if (sessions.size > 0) {
      scheduleCleanup();
    }
  }, 60000); // Check every minute
}

/**
 * Clean up expired sessions
 */
async function cleanupExpiredSessions(): Promise<void> {
  const now = Date.now();
  const expiredIds: string[] = [];

  sessions.forEach((session, uploadId) => {
    const age = now - session.lastAccess.getTime();
    if (age > SESSION_TIMEOUT_MS) {
      expiredIds.push(uploadId);
    }
  });

  for (const uploadId of expiredIds) {
    console.log(`[Session] Cleaning up expired session: ${uploadId}`);
    await deleteSession(uploadId);
  }
}

/**
 * Get session statistics (for debugging)
 */
export function getSessionStats(): {
  activeCount: number;
  totalQueries: number;
} {
  let totalQueries = 0;
  
  sessions.forEach((session) => {
    totalQueries += session.conversation.length;
  });

  return {
    activeCount: sessions.size,
    totalQueries,
  };
}
