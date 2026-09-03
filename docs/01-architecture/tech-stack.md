# Technical Stack

## Frontend

- Next.js
- TypeScript
- Tailwind CSS
- shadcn/ui
- TanStack Query
- PWA support
- IndexedDB for offline attendance

## Backend

- NestJS
- TypeScript
- REST API
- OpenAPI
- WebSockets/Socket.IO where real-time updates are required
- Zod or equivalent boundary validation

## Data

- PostgreSQL
- Prisma
- Redis
- BullMQ
- S3-compatible object storage

## AI and optimization

- Python service
- Google OR-Tools for constraint optimization
- LLM API for explanations, natural-language interaction, and alternative-solution narration

## Infrastructure

- Docker
- AWS ECS/Fargate
- RDS PostgreSQL
- ElastiCache Redis
- S3
- CloudFront
- Terraform

## Quality and observability

- Vitest
- Playwright
- Sentry
- OpenTelemetry
- GitHub Actions

## Architectural decision

Use a modular monolith for the main application. Extract services only where scaling, isolation, or computational characteristics justify it.
