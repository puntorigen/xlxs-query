'use client';

import { useState, useCallback } from 'react';
import { FileSpreadsheet, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { UploadZone } from '@/components/upload-zone';
import { SheetTabs } from '@/components/sheet-tabs';
import { DataGrid } from '@/components/data-grid';
import { SchemaPanel } from '@/components/schema-panel';
import { ChatPanel } from '@/components/chat-panel';
import type { UploadResponse, QueryResponse, CellValue, ColumnInfo, Relationship, SheetType } from '@/lib/types';

// ============================================================================
// Types
// ============================================================================

interface SheetData {
  name: string;
  sheetType: SheetType;
  rowCount: number;
  columns: ColumnInfo[];
  previewData: CellValue[][];
  /** Original layout for matrix sheets (before normalization) */
  originalPreviewData?: CellValue[][];
}

interface AppState {
  uploadId: string | null;
  fileName: string | null;
  sheets: SheetData[];
  relationships: Relationship[];
  activeSheet: string | null;
  isLoading: boolean;
  error: string | null;
}

// ============================================================================
// Main Component
// ============================================================================

export default function Home() {
  const [state, setState] = useState<AppState>({
    uploadId: null,
    fileName: null,
    sheets: [],
    relationships: [],
    activeSheet: null,
    isLoading: false,
    error: null,
  });

  // Get current sheet data
  const currentSheet = state.sheets.find((s) => s.name === state.activeSheet);

  // Handle file upload
  const handleUpload = useCallback(async (file: File) => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      const result: UploadResponse = await response.json();

      if (!result.success || !result.uploadId) {
        throw new Error(result.error || 'Upload failed');
      }

      setState({
        uploadId: result.uploadId,
        fileName: file.name,
        sheets: result.sheets || [],
        relationships: result.schema?.relationships || [],
        activeSheet: result.sheets?.[0]?.name || null,
        isLoading: false,
        error: null,
      });
    } catch (error) {
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Upload failed',
      }));
    }
  }, []);

  // Handle query
  const handleQuery = useCallback(
    async (question: string): Promise<QueryResponse> => {
      if (!state.uploadId) {
        return { success: false, error: 'No file uploaded' };
      }

      try {
        const response = await fetch('/api/query', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            uploadId: state.uploadId,
            question,
          }),
        });

        const result: QueryResponse = await response.json();
        return result;
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Query failed',
        };
      }
    },
    [state.uploadId]
  );

  // Handle new upload (reset state)
  const handleNewUpload = useCallback(() => {
    setState({
      uploadId: null,
      fileName: null,
      sheets: [],
      relationships: [],
      activeSheet: null,
      isLoading: false,
      error: null,
    });
  }, []);

  // Render upload view
  if (!state.uploadId) {
    return (
      <main className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100">
        {/* Header */}
        <header className="border-b bg-white/80 backdrop-blur-sm sticky top-0 z-50">
          <div className="container mx-auto px-4 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary/10 rounded-lg">
                <FileSpreadsheet className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h1 className="text-xl font-semibold text-slate-900">
                  Spreadsheet Intelligence
                </h1>
                <p className="text-sm text-slate-500">
                  Query your Excel data with natural language
                </p>
              </div>
            </div>
          </div>
        </header>

        {/* Upload Zone */}
        <div className="container mx-auto px-4 py-16">
          <UploadZone
            onUpload={handleUpload}
            isLoading={state.isLoading}
            error={state.error}
          />
        </div>
      </main>
    );
  }

  // Render main view
  return (
    <main className="min-h-screen bg-slate-100 flex flex-col">
      {/* Header */}
      <header className="border-b bg-white sticky top-0 z-50">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-lg">
              <FileSpreadsheet className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-slate-900">
                Spreadsheet Intelligence
              </h1>
              <p className="text-xs text-slate-500">{state.fileName}</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={handleNewUpload}>
            <Upload className="h-4 w-4 mr-2" />
            Upload New File
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 container mx-auto p-4">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 h-[calc(100vh-8rem)]">
          {/* Left Panel: Sheet Preview */}
          <div className="lg:col-span-2 flex flex-col gap-4">
            {/* Sheet Tabs */}
            <SheetTabs
              sheets={state.sheets.map((s) => ({
                name: s.name,
                sheetType: s.sheetType,
                rowCount: s.rowCount,
              }))}
              activeSheet={state.activeSheet || ''}
              onSheetChange={(name) =>
                setState((prev) => ({ ...prev, activeSheet: name }))
              }
            />

            {/* Data Grid */}
            <Card className="flex-1 overflow-hidden">
              <CardHeader className="py-3 px-4 border-b">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">
                    {currentSheet?.name || 'No sheet selected'}
                    {currentSheet?.sheetType === 'matrix' && (
                      <span className="ml-2 text-xs font-normal text-slate-500">
                        (matrix format - normalized for queries)
                      </span>
                    )}
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {currentSheet ? (
                  // Show original layout for matrix sheets, normalized for tables
                  <DataGrid
                    data={
                      currentSheet.sheetType === 'matrix' && currentSheet.originalPreviewData
                        ? currentSheet.originalPreviewData
                        : currentSheet.previewData
                    }
                  />
                ) : (
                  <div className="flex items-center justify-center h-48 text-slate-500">
                    Select a sheet to preview
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Schema Panel */}
            {currentSheet && (
              <Card>
                <CardHeader className="py-3 px-4 border-b">
                  <CardTitle className="text-base">Schema</CardTitle>
                </CardHeader>
                <CardContent className="p-4">
                  <SchemaPanel
                    columns={currentSheet.columns}
                    rowCount={currentSheet.rowCount}
                    relationships={state.relationships}
                    tableName={currentSheet.name}
                    sheetType={currentSheet.sheetType}
                  />
                </CardContent>
              </Card>
            )}
          </div>

          {/* Right Panel: Chat */}
          <Card className="flex flex-col overflow-hidden">
            <ChatPanel onQuery={handleQuery} disabled={!state.uploadId} />
          </Card>
        </div>
      </div>
    </main>
  );
}
