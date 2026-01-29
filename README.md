# Spreadsheet Intelligence

A web application that allows users to upload Excel spreadsheets and query them using natural language. The system understands spreadsheet structure, performs accurate calculations, and provides transparent, verifiable answers.

![xlsx-demo](https://github.com/user-attachments/assets/aa7030de-f9fe-41ff-a374-67490e8c426c)


## Features

- **Excel Upload**: Drag-and-drop `.xlsx` file upload with automatic structure detection
- **Natural Language Queries**: Ask questions about your data in plain English
- **Exact Numerical Accuracy**: LLM generates SQL queries, DuckDB executes them deterministically
- **Transparency**: See the generated SQL and which sheets were used for each answer
- **Smart Header Detection**: Automatically finds header rows even when not in row 1
- **Matrix Sheet Support**: Handles report-style sheets with automatic normalization and LLM-assisted aggregate detection (avoids double-counting totals)
- **Cross-Sheet Queries**: Automatically detects relationships and supports JOINs
- **Conversation Memory**: Follow-up questions understand previous context

## Quick Start

### Prerequisites

- Node.js 18+ 
- A Groq API key (get one at [console.groq.com](https://console.groq.com))

### Installation

```bash
# Clone the repository
cd xlsx-query

# Install dependencies
npm install

# Create environment file
cp .env.local.example .env.local

# Add your Groq API key to .env.local
# GROQ_API_KEY=gsk_xxxxxxxxxxxxx

# Start the development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Usage

1. **Upload**: Drag and drop an Excel file (`.xlsx`) or click to browse
2. **Explore**: Browse sheets using tabs, preview data in the grid
   - For matrix sheets, toggle between "Original View" and "Normalized View"
   - Aggregate columns (like "H1 Total") are highlighted in amber
3. **Ask**: Type a question in the chat panel (e.g., "What is the total sales revenue?")
4. **Verify**: Expand the SQL section to see exactly how the answer was computed

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend (Next.js + React)                │
│  ┌─────────────────────────────┬───────────────────────────┐ │
│  │    Sheet Preview Panel      │       Chat Panel          │ │
│  │    • Tabs, Grid, Schema     │    • Q&A with SQL         │ │
│  └─────────────────────────────┴───────────────────────────┘ │
├─────────────────────────────────────────────────────────────┤
│                    Backend (API Routes)                      │
│                                                              │
│  POST /api/upload          POST /api/query                   │
│  • Parse XLSX (SheetJS)    • Build schema context            │
│  • Evaluate formulas       • Generate SQL (Groq LLM)         │
│  • Detect headers          • Validate & execute (DuckDB)     │
│  • Load into DuckDB        • Return answer + transparency    │
└─────────────────────────────────────────────────────────────┘
```

### Tech Stack

| Component | Technology | Purpose |
|-----------|------------|---------|
| Framework | Next.js 16 (App Router) | Fullstack React |
| Excel Parsing | SheetJS (xlsx) | Extract cells + formulas |
| Formula Engine | HyperFormula | Evaluate Excel formulas |
| Query Engine | DuckDB | In-memory SQL execution |
| LLM Provider | Groq (gpt-oss-120b) | Natural language to SQL |
| Styling | Tailwind CSS | Modern, responsive UI |

### Processing Pipeline

1. **Parse**: SheetJS extracts cell values and formulas
2. **Evaluate**: HyperFormula computes all formula values
3. **Detect**: Find header rows using scoring heuristics
4. **Classify**: Determine if sheet is table or matrix format
5. **Analyze**: For matrix sheets, LLM identifies aggregate columns/rows by numeric patterns
6. **Normalize**: Convert matrix sheets to queryable long format with `is_aggregate` flag
7. **Load**: Insert data into DuckDB tables
8. **Relate**: Detect foreign key relationships
9. **Query**: Generate SQL from natural language, execute, return results

## Example Queries

With a typical company data Excel file:

- "What is the total sales revenue?"
- "Which product category had the highest sales?"
- "Show me Emily Rodriguez's sales performance"
- "What is the budget variance for Marketing?"
- "Compare Q1 vs Q2 budget for Engineering"

## Project Structure

```
xlsx-query/
├── app/
│   ├── page.tsx              # Main UI
│   └── api/
│       ├── upload/route.ts   # File upload endpoint
│       └── query/route.ts    # Query endpoint
├── lib/
│   ├── excel/                # Excel processing
│   │   ├── parser.ts         # SheetJS wrapper
│   │   ├── formula-evaluator.ts
│   │   ├── header-detector.ts
│   │   ├── sheet-classifier.ts
│   │   └── matrix-normalizer.ts
│   ├── db/                   # Database layer
│   │   ├── duckdb.ts
│   │   ├── loader.ts
│   │   └── relationships.ts
│   ├── llm/                  # LLM integration
│   │   ├── groq-client.ts
│   │   ├── prompts.ts
│   │   ├── schema-context.ts
│   │   └── matrix-analyzer.ts  # LLM-based aggregate detection
│   ├── query/                # Query execution
│   │   ├── validator.ts
│   │   ├── executor.ts
│   │   └── attribution.ts
│   └── session.ts            # Session management
└── components/               # UI components
```

## Known Limitations

1. **Matrix Sheet Detection**: Heuristics may not detect all corporate report formats. Complex multi-level headers are not fully supported. Aggregate detection uses LLM analysis of numeric patterns (language-agnostic).

2. **Formula Support**: HyperFormula supports ~400 functions but not all Excel functions. Complex array formulas may not evaluate correctly.

3. **File Size**: Large files (>100k rows) may be slow. In-memory processing limits practical size.

4. **Query Complexity**: Very complex analytical queries may require multiple attempts. Ambiguous questions may be misinterpreted.

5. **Session Persistence**: Single session only (in-memory). Uploading a new file clears previous data.

6. **Supported Formats**: Only `.xlsx` format is supported (not `.xls`, `.csv`, `.ods`).

## Environment Variables

```bash
# Required
GROQ_API_KEY=gsk_xxxxxxxxxxxxx    # Your Groq API key

# Optional
GROQ_MODEL=openai/gpt-oss-120b   # Model to use (default: openai/gpt-oss-120b)
```

## Development

```bash
# Run development server
npm run dev

# Build for production
npm run build

# Start production server
npm start

# Lint code
npm run lint
```

## License

MIT
