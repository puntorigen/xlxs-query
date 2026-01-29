/**
 * POST /api/query
 * Handle natural language queries against uploaded spreadsheet data
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession, addConversationEntry, getConversationHistory } from '@/lib/session';
import { executeQuery } from '@/lib/query';
import type { QueryResponse } from '@/lib/types';

// Request validation schema
const querySchema = z.object({
  uploadId: z.string().min(1, 'Upload ID is required'),
  question: z.string().min(1, 'Question is required').max(1000, 'Question too long'),
});

export async function POST(request: NextRequest): Promise<NextResponse<QueryResponse>> {
  try {
    // Parse request body
    const body = await request.json();

    // Validate request
    const validation = querySchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: validation.error.errors[0].message },
        { status: 400 }
      );
    }

    const { uploadId, question } = validation.data;

    // Get session
    const session = getSession(uploadId);
    if (!session) {
      return NextResponse.json(
        { success: false, error: 'Session not found. Please upload your file again.' },
        { status: 404 }
      );
    }

    console.log(`[Query] Processing question: "${question.substring(0, 50)}..."`);

    // Get conversation history for context
    const conversationHistory = getConversationHistory(uploadId);

    // Execute query
    const result = await executeQuery(
      question,
      session.db,
      session.schema,
      conversationHistory
    );

    // Add to conversation history
    addConversationEntry(uploadId, {
      question,
      sql: result.sql || null,
      answer: result.answer || result.error || 'No answer',
      tablesUsed: result.tablesUsed || [],
      error: result.error,
    });

    // Build response
    const response: QueryResponse = {
      success: result.success,
      answer: result.answer,
      sql: result.sql,
      tablesUsed: result.tablesUsed,
      resultPreview: result.resultPreview,
      columnNames: result.columnNames,
      assumptions: result.assumptions,
      error: result.error,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('[Query] Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { success: false, error: `Query failed: ${message}` },
      { status: 500 }
    );
  }
}
