# Content OS Architecture

## Core principle

Content OS is an AI Content Creation & Launch OS.

The platform accepts arbitrary inputs and turns them into
professional content through a shared intelligence and
generation system.

## Architectural layers

### 1. App

Next.js routes, pages, and API endpoints.

The app layer handles HTTP and UI concerns.

It must not contain core creative logic.

### 2. Core Domain

Contains business concepts:

- Project
- Source
- Asset
- Product Intelligence
- Brand Profile
- Audience Profile
- Content Request
- Content Plan
- Content Artifact
- Generation Job

The domain does not know about specific vendors.

### 3. Ports

Ports define interfaces to external capabilities:

- AI
- Browser
- Renderer
- Storage
- Image generation
- Audio generation
- Publishing
- repositories

### 4. Services

Application services coordinate domain operations.

Examples:

- ProjectService
- GenerationService

### 5. Engine

The engine contains higher-level creative workflows.

Examples:

- Content orchestration
- Product analysis
- Creative direction
- Storyboard generation
- Capture
- Rendering

### 6. Infrastructure

Infrastructure implements ports.

Examples:

- Postgres repository
- S3 storage
- Playwright browser
- LLM providers
- image providers
- video renderer
- publishing integrations

## Dependency rule

Dependencies point inward.

App
→ Services
→ Domain / Ports
→ Infrastructure implementations

Domain must never depend on infrastructure.

## Provider abstraction

The application must not directly call a vendor.

Bad:

```ts
openai.responses.create(...)