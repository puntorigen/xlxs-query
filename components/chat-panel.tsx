'use client';

import { useState, useRef, useEffect } from 'react';
import { Send, Loader2, MessageSquare, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AnswerCard } from './answer-card';
import type { CellValue } from '@/lib/types';

interface ConversationMessage {
  id: string;
  question: string;
  answer?: string;
  sql?: string;
  tablesUsed?: string[];
  resultPreview?: CellValue[][];
  columnNames?: string[];
  error?: string;
}

interface ChatPanelProps {
  onQuery: (question: string) => Promise<{
    success: boolean;
    answer?: string;
    sql?: string;
    tablesUsed?: string[];
    resultPreview?: CellValue[][];
    columnNames?: string[];
    error?: string;
  }>;
  disabled?: boolean;
}

/**
 * Chat interface for querying the spreadsheet
 * Sticky input at bottom, natural conversation order (oldest first)
 */
export function ChatPanel({ onQuery, disabled }: ChatPanelProps) {
  const [question, setQuestion] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const trimmedQuestion = question.trim();
    if (!trimmedQuestion || isLoading || disabled) return;

    setIsLoading(true);
    setQuestion('');

    // Add pending message at the end (natural order)
    const messageId = Date.now().toString();
    setMessages((prev) => [
      ...prev,
      { id: messageId, question: trimmedQuestion },
    ]);

    try {
      const result = await onQuery(trimmedQuestion);

      // Update message with result
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === messageId
            ? {
                ...msg,
                answer: result.answer,
                sql: result.sql,
                tablesUsed: result.tablesUsed,
                resultPreview: result.resultPreview,
                columnNames: result.columnNames,
                error: result.error,
              }
            : msg
        )
      );
    } catch (error) {
      // Update message with error
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === messageId
            ? {
                ...msg,
                error: error instanceof Error ? error.message : 'Unknown error',
              }
            : msg
        )
      );
    } finally {
      setIsLoading(false);
      inputRef.current?.focus();
    }
  };

  // Handle Enter key (Shift+Enter for newline)
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header - sticky top */}
      <div className="flex-shrink-0 flex items-center gap-2 p-4 border-b bg-white">
        <Sparkles className="h-5 w-5 text-primary" />
        <h2 className="font-semibold text-slate-900">Ask about your data</h2>
      </div>

      {/* Messages - scrollable area */}
      <div 
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4"
      >
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-8">
            <MessageSquare className="h-10 w-10 text-slate-300 mb-3" />
            <p className="text-slate-500 mb-2">No questions yet</p>
            <p className="text-sm text-slate-400 max-w-xs">
              Ask questions about your spreadsheet data using natural language
            </p>
            <div className="mt-4 space-y-2 text-sm text-slate-500">
              <p className="font-medium">Try asking:</p>
              <div className="space-y-1 text-left">
                <p className="text-slate-400">&quot;What is the total sales revenue?&quot;</p>
                <p className="text-slate-400">&quot;Show top 5 products by quantity&quot;</p>
                <p className="text-slate-400">&quot;Which region had the highest sales?&quot;</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Messages in natural order (oldest first) */}
            {messages.map((msg, index) => (
              <AnswerCard
                key={msg.id}
                question={msg.question}
                answer={msg.answer}
                sql={msg.sql}
                tablesUsed={msg.tablesUsed}
                resultPreview={msg.resultPreview}
                columnNames={msg.columnNames}
                error={msg.error}
                isLatest={index === messages.length - 1}
              />
            ))}

            {/* Loading indicator at bottom */}
            {isLoading && (
              <div className="flex items-center gap-2 text-slate-500 py-2 px-3 bg-slate-100 rounded-lg">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm">Analyzing your question...</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Input - sticky bottom */}
      <form onSubmit={handleSubmit} className="flex-shrink-0 p-4 border-t bg-white">
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask a question about your data..."
            disabled={disabled || isLoading}
            rows={2}
            className="flex-1 px-3 py-2 border rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50 disabled:cursor-not-allowed"
          />
          <Button
            type="submit"
            disabled={!question.trim() || disabled || isLoading}
            size="icon"
            className="h-auto"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
        <p className="text-xs text-slate-400 mt-2">
          Press Enter to send, Shift+Enter for new line
        </p>
      </form>
    </div>
  );
}
