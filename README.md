# Workforce Management Platform — Engineering Documentation

This directory is the engineering source of truth for V1.

## Documentation order

1. Product requirements and V1 scope
2. Technical stack and system architecture
3. Database and authorization model
4. Workforce, scheduling, attendance, and platform domains
5. API and frontend contracts
6. Delivery and definition of done

## Architecture principle

V1 is a modular monolith with clear module boundaries and microservices-ready interfaces. PostgreSQL is the system of record. Redis/BullMQ handles asynchronous work. A Python optimization service is introduced for schedule optimization while NestJS remains the primary application backend.

## Source of truth

The V1 product decisions are derived from the finalized product specification. Engineering documents may add implementation detail, but product behavior must remain consistent with the approved V1 scope.
