# Testing Guide

This document provides instructions for testing Spreadsheet Intelligence, including sample queries and expected results.

## Quick Start

```bash
# Install dependencies
npm install

# Set up environment
cp .env.local.example .env.local
# Add your GROQ_API_KEY to .env.local

# Start the server
npm run dev

# Open http://localhost:3000
```

## Test File

Upload any `.xlsx` file through the web interface. A typical company data file might contain:

| Sheet | Type | Rows | Description |
|-------|------|------|-------------|
| Sales | Table | 23 | Sales transactions with dates, products, reps |
| Products | Table | 5 | Product catalog with categories and prices |
| Employees | Table | 5 | Sales rep information |
| Budgets | Matrix | 39 | Departmental budgets by quarter (normalized) |
| Actuals | Table | 9 | Actual spending vs budget |

## Test Scenarios

### 1. Basic Table Queries

**Query**: "What is the total sales revenue?"

**Expected**: A sum of all sales amounts (~$47,500 range)

**Verification**: Check SQL uses `SUM(amount)` or similar from sales table

---

**Query**: "How many products do we have?"

**Expected**: 5 products

**Verification**: SQL should be `SELECT COUNT(*) FROM products`

---

**Query**: "Show me all sales from January 2024"

**Expected**: List of sales transactions from January 2024

**Verification**: SQL includes date filter

### 2. Join Queries (Cross-Sheet)

**Query**: "What are the sales by product category?"

**Expected**: Breakdown by category (Electronics, Software, Services)

**Verification**: SQL joins sales with products table

---

**Query**: "Which sales rep had the highest total sales?"

**Expected**: Name of top performer with their total

**Verification**: SQL joins sales with employees, uses GROUP BY

---

**Query**: "Show Emily Rodriguez's sales performance"

**Expected**: Details of Emily's sales

**Verification**: SQL filters by rep name or joins to employees

### 3. Matrix Sheet Queries (Budgets)

**Query**: "What is the total budget for Engineering?"

**Expected**: Sum of Engineering budget (~$500,000 range, NOT double-counted)

**Verification**: 
- SQL should include `WHERE is_aggregate = false`
- The "H1 Total" column should NOT be included in sum

---

**Query**: "What is the Q1 budget for Sales?"

**Expected**: Sum of Sales department Q1 budget items

**Verification**: SQL filters by period = 'Q1 Budget' and department

---

**Query**: "Compare Q1 vs Q2 budgets for Marketing"

**Expected**: Side-by-side or comparison of both quarters

**Verification**: SQL groups by period, filters by department

### 4. Aggregate Detection Test

This is the key test for the aggregate detection feature:

**Setup**: Look at the Budgets sheet in Original View
- You should see column E (H1 Total) highlighted in amber
- Banner should say "1 aggregate column detected: H1 Total"

**Query**: "What is the total budget across all departments and periods?"

**Expected**: 
- Sum that does NOT double-count H1 Total values
- If Q1=100, Q2=200, H1 Total=300, the sum should be 300, not 600

**Verification**:
- SQL should include `WHERE is_aggregate = false`
- Or it should only sum Q1 and Q2 periods, not H1 Total

### 5. Conversation Memory

**Query 1**: "How many employees do we have?"

**Expected**: 5 employees

**Query 2**: "What are their names?"

**Expected**: Should understand "their" refers to employees from previous query

**Verification**: Second query correctly uses context from first

### 6. Edge Cases

**Query**: "Show me the data" (vague)

**Expected**: Reasonable interpretation (maybe shows first table) or asks for clarification

---

**Query**: "What is the average budget per department per quarter?"

**Expected**: Calculated average with proper grouping

**Verification**: Uses AVG() with GROUP BY

---

**Query**: "Which department is over budget?"

**Expected**: Compares budgets table with actuals table

**Verification**: Joins budgets with actuals

## UI Verification Checklist

### Upload Flow
- [ ] Drag-and-drop works
- [ ] Click to browse works
- [ ] File name displayed after upload
- [ ] All 5 sheets appear as tabs
- [ ] Budgets tab shows matrix icon (different from table icon)

### Data Grid
- [ ] Data displays correctly in grid
- [ ] Numbers are formatted with commas
- [ ] Scrolling works (horizontal and vertical)
- [ ] Row numbers shown on left
- [ ] Column letters shown on top (A, B, C...)

### Matrix Sheet (Budgets)
- [ ] "Original View" toggle visible
- [ ] Amber banner shows detected aggregates
- [ ] Column E (H1 Total) highlighted in amber
- [ ] Toggle switches to "Normalized View"
- [ ] Normalized view shows 5 columns: department, category, period, amount, is_aggregate
- [ ] Rows with is_aggregate=true highlighted in normalized view

### Schema Panel
- [ ] Shows column names and types
- [ ] Shows row count
- [ ] Shows relationships (if any)
- [ ] Matrix sheets show note about aggregate column

### Chat Panel
- [ ] Input field works
- [ ] Questions appear in chat
- [ ] Answers render with markdown
- [ ] SQL section expandable
- [ ] Tables used displayed
- [ ] Error messages show clearly (if query fails)

## Error Handling Tests

### Invalid File
- Upload a `.txt` file
- **Expected**: Error message "Only .xlsx files are supported"

### Large File
- Upload a file > 50MB (if you have one)
- **Expected**: Error message about file size

### Invalid Query
- Ask something completely unrelated: "What's the weather?"
- **Expected**: Graceful response (no crash), possibly noting data doesn't contain weather info

### No Data Match
- Ask about a non-existent department: "What is the budget for HR?"
- **Expected**: Empty result or "no data found" message

## Performance Benchmarks

| Operation | Expected Time | Acceptable Range |
|-----------|--------------|------------------|
| File upload (company_data.xlsx) | 2-4s | <10s |
| Simple query (COUNT) | 0.5-1s | <3s |
| Join query | 1-2s | <5s |
| Matrix query | 1-2s | <5s |

## Regression Tests

After any code changes, verify:

1. **Upload still works**: Upload company_data.xlsx successfully
2. **All sheets detected**: 5 tabs appear
3. **Matrix detection works**: Budgets shows as matrix type
4. **Aggregate detection works**: H1 Total column highlighted
5. **Basic query works**: "How many products?" returns 5
6. **Join query works**: "Sales by category" returns grouped results
7. **Aggregate exclusion works**: "Total Engineering budget" doesn't double-count

## Troubleshooting

### "Session not found" error
- Server may have restarted
- Solution: Re-upload the file

### Query returns wrong numbers
- Check if aggregate columns are being double-counted
- Look at generated SQL for `is_aggregate = false` filter

### LLM generates invalid SQL
- Check console for SQL validation errors
- May need to rephrase question more specifically

### Slow responses
- Check network tab for API latency
- Groq API may be under load

### Matrix sheet not detected
- Check if period headers (Q1, Q2, etc.) are in expected format
- Manually verify sheet structure matches expected pattern
