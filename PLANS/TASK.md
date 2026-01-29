# AI Engineer Take-Home Assignment:

# Spreadsheet Intelligence

## Overview

Build a web application that allows users to upload Excel spreadsheets and query them using natural language. The system should understand spreadsheet structure, perform accurate calculations, and provide transparent, verifiable answers.

**Time Expectation** : 48 hours to submit. We expect approximately 4-6 hours of focused work.

## Requirements

### Core Functionality

**_Spreadsheet Upload & Processing_**

- Users upload .xlsx files through the web interface
- System parses and understands the spreadsheet structure automatically

**_Natural Language Query Interface_**

- Web-based chat where users ask questions about uploaded data
- Numerical answers must be **exactly correct**
- Show your work: display the generated query/code used to compute the answer
- Include source attribution: which sheet and data contributed to the answer

### Technical Requirements

- Application runs locally with clear setup instructions
- Any language/framework is acceptable
- Any LLM provider (OpenAI, Anthropic, local models, etc.)


## Evaluation Criteria

```
Criteria Weight What We're Looking For
Query Accuracy 40% Numerical answers are correct
Schema
Understanding
```
```
30% Correctly interprets spreadsheet structure
```
```
Architecture 20% Clean separation of concerns
```
```
Transparency 10%
```
```
Shows generated code/queries; clear
attribution
```
### What We're NOT Evaluating

- Visual design or CSS polish
- Production deployment configuration
- Performance at scale
- Comprehensive test coverage

## Deliverables

1. **Working application** with source code
2. **README** with:
    a. Setup instructions and required environment variables
    b. Architectural overview
    c. Known limitations
3. **Be prepared to discuss** your approach and trade-offs in the review

## Test Files

We've included sample spreadsheets in /test-documents. Reviewers will also test with additional files.


### company_data.xlsx

A workbook containing company operational data across multiple sheets. Your system
should be able to answer questions about this data accurately.

