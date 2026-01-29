/**
 * POST /api/upload
 * Handle Excel file upload, processing, and database loading
 */

import { NextRequest, NextResponse } from 'next/server';
import { processExcelFile } from '@/lib/excel';
import { SessionDatabase, loadWorkbookIntoDatabase, enrichSchemaWithSamples, detectRelationships } from '@/lib/db';
import { createSession } from '@/lib/session';
import type { UploadResponse } from '@/lib/types';

export async function POST(request: NextRequest): Promise<NextResponse<UploadResponse>> {
  try {
    // Get form data
    const formData = await request.formData();
    const file = formData.get('file');

    // Validate file
    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { success: false, error: 'No file provided' },
        { status: 400 }
      );
    }

    // Validate file type
    const fileName = file.name;
    if (!fileName.toLowerCase().endsWith('.xlsx')) {
      return NextResponse.json(
        { success: false, error: 'Only .xlsx files are supported' },
        { status: 400 }
      );
    }

    // Validate file size (max 50MB)
    const MAX_SIZE = 50 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { success: false, error: 'File too large. Maximum size is 50MB.' },
        { status: 400 }
      );
    }

    console.log(`[Upload] Processing file: ${fileName} (${file.size} bytes)`);

    // Read file buffer
    const buffer = await file.arrayBuffer();

    // Step 1: Process Excel file
    console.log('[Upload] Step 1: Processing Excel file...');
    const workbook = await processExcelFile(buffer, fileName);

    // Step 2: Initialize database and load data
    console.log('[Upload] Step 2: Loading data into database...');
    const db = new SessionDatabase();
    await db.initialize();

    const schema = await loadWorkbookIntoDatabase(db, workbook);

    // Step 3: Detect relationships between tables
    console.log('[Upload] Step 3: Detecting relationships...');
    const relationships = await detectRelationships(db, schema);
    schema.relationships = relationships;

    // Step 4: Enrich schema with sample values
    console.log('[Upload] Step 4: Enriching schema with samples...');
    const enrichedSchema = await enrichSchemaWithSamples(db, schema);

    // Step 5: Create session
    console.log('[Upload] Step 5: Creating session...');
    const uploadId = await createSession(workbook, enrichedSchema, db);

    console.log(`[Upload] Complete. Upload ID: ${uploadId}`);

    // Build response
    const response: UploadResponse = {
      success: true,
      uploadId,
      schema: enrichedSchema,
      sheets: workbook.sheets.map((sheet) => ({
        name: sheet.name,
        sheetType: sheet.sheetType,
        rowCount: sheet.rowCount,
        columns: sheet.columns,
        previewData: sheet.previewData,
        // For matrix sheets, include original layout for display
        originalPreviewData: sheet.originalPreviewData,
      })),
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('[Upload] Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { success: false, error: `Failed to process file: ${message}` },
      { status: 500 }
    );
  }
}
