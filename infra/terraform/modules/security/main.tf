terraform {
  required_version = ">= 1.9.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.50"
    }
  }
}

# ==============================================================================
# Security Group resources (no cross-SG references inline, to avoid a Terraform
# dependency cycle between SGs whose rules reference each other's IDs).
#
# Networking model (approved):
#   - ECS private subnet route table -> NAT Gateway -> Internet Gateway (NAT is a
#     route concept, NOT a security-group destination).
#   - API ECS SG -> RDS SG on TCP 5432
#   - API ECS SG -> Redis SG on TCP 6379
#   - ALB SG -> Web ECS SG on TCP 3000
#   - ALB SG -> API ECS SG on TCP 3001
#   - Web -> API on TCP 3001 (Next.js server-side calls to the NestJS API)
#   - RDS and Redis have NO public ingress (only from the API ECS SG)
#   - Private ECS tasks get outbound HTTPS via the NAT path (0.0.0.0/0 egress 443)
# ------------------------------------------------------------------------------

# Application Load Balancer Security Group
resource "aws_security_group" "alb" {
  name        = "${var.environment}-alb-sg"
  description = "Controls public HTTP ingress to the ALB and egress to ECS targets"
  vpc_id      = var.vpc_id

  tags = merge(
    var.tags,
    { Name = "${var.environment}-alb-sg" }
  )
}

# ECS Web Service Security Group (Next.js)
resource "aws_security_group" "ecs_web" {
  name        = "${var.environment}-ecs-web-sg"
  description = "Web ECS tasks: ingress from ALB (3000), egress to API (3001) and outbound HTTPS"
  vpc_id      = var.vpc_id

  tags = merge(
    var.tags,
    { Name = "${var.environment}-ecs-web-sg" }
  )
}

# ECS API Service Security Group (NestJS)
resource "aws_security_group" "ecs_api" {
  name        = "${var.environment}-ecs-api-sg"
  description = "API ECS tasks: ingress from ALB/Web (3001), egress to RDS/Redis and outbound HTTPS"
  vpc_id      = var.vpc_id

  tags = merge(
    var.tags,
    { Name = "${var.environment}-ecs-api-sg" }
  )
}

# RDS PostgreSQL Security Group
resource "aws_security_group" "rds" {
  name        = "${var.environment}-rds-sg"
  description = "Strictly permits PostgreSQL 5432 ingress from API ECS tasks only"
  vpc_id      = var.vpc_id

  tags = merge(
    var.tags,
    { Name = "${var.environment}-rds-sg" }
  )
}

# ElastiCache Redis Security Group
resource "aws_security_group" "redis" {
  name        = "${var.environment}-redis-sg"
  description = "Strictly permits Redis 6379 ingress from API ECS tasks only"
  vpc_id      = var.vpc_id

  tags = merge(
    var.tags,
    { Name = "${var.environment}-redis-sg" }
  )
}

# ==============================================================================
# Ingress / egress rules (separate rule resources -> no SG dependency cycle)
# ==============================================================================

# --- ALB: allow public HTTP on 80 ---
resource "aws_security_group_rule" "alb_ingress_http" {
  type              = "ingress"
  security_group_id = aws_security_group.alb.id
  description       = "Public HTTP traffic"
  from_port         = 80
  to_port           = 80
  protocol          = "tcp"
  cidr_blocks       = ["0.0.0.0/0"]
}

# --- ALB -> Web on 3000 ---
resource "aws_security_group_rule" "alb_egress_web" {
  type                     = "egress"
  security_group_id        = aws_security_group.alb.id
  description              = "Forward HTTP to Web ECS tasks"
  from_port                = 3000
  to_port                  = 3000
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.ecs_web.id
}

# --- ALB -> API on 3001 ---
resource "aws_security_group_rule" "alb_egress_api" {
  type                     = "egress"
  security_group_id        = aws_security_group.alb.id
  description              = "Forward HTTP/WebSocket to API ECS tasks"
  from_port                = 3001
  to_port                  = 3001
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.ecs_api.id
}

# --- Web: ingress from ALB on 3000 ---
resource "aws_security_group_rule" "web_ingress_alb" {
  type                     = "ingress"
  security_group_id        = aws_security_group.ecs_web.id
  description              = "Ingress from ALB on port 3000"
  from_port                = 3000
  to_port                  = 3000
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.alb.id
}

# --- Web: egress to API on 3001 (server-side calls) ---
resource "aws_security_group_rule" "web_egress_api" {
  type                     = "egress"
  security_group_id        = aws_security_group.ecs_web.id
  description              = "Direct SSR/API communication to API ECS tasks"
  from_port                = 3001
  to_port                  = 3001
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.ecs_api.id
}

# --- Web: outbound HTTPS via NAT ---
resource "aws_security_group_rule" "web_egress_https" {
  type              = "egress"
  security_group_id = aws_security_group.ecs_web.id
  description       = "Outbound HTTPS to AWS services/external endpoints via NAT"
  from_port         = 443
  to_port           = 443
  protocol          = "tcp"
  cidr_blocks       = ["0.0.0.0/0"]
}

# --- API: ingress from ALB on 3001 ---
resource "aws_security_group_rule" "api_ingress_alb" {
  type                     = "ingress"
  security_group_id        = aws_security_group.ecs_api.id
  description              = "Ingress from ALB on port 3001"
  from_port                = 3001
  to_port                  = 3001
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.alb.id
}

# --- API: ingress from Web on 3001 ---
resource "aws_security_group_rule" "api_ingress_web" {
  type                     = "ingress"
  security_group_id        = aws_security_group.ecs_api.id
  description              = "Ingress from Web ECS tasks on port 3001"
  from_port                = 3001
  to_port                  = 3001
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.ecs_web.id
}

# --- API: egress to RDS on 5432 ---
resource "aws_security_group_rule" "api_egress_rds" {
  type                     = "egress"
  security_group_id        = aws_security_group.ecs_api.id
  description              = "PostgreSQL egress to RDS"
  from_port                = 5432
  to_port                  = 5432
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.rds.id
}

# --- API: egress to Redis on 6379 ---
resource "aws_security_group_rule" "api_egress_redis" {
  type                     = "egress"
  security_group_id        = aws_security_group.ecs_api.id
  description              = "Redis egress to ElastiCache"
  from_port                = 6379
  to_port                  = 6379
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.redis.id
}

# --- API: outbound HTTPS via NAT ---
resource "aws_security_group_rule" "api_egress_https" {
  type              = "egress"
  security_group_id = aws_security_group.ecs_api.id
  description       = "Outbound HTTPS to AWS services/external endpoints via NAT"
  from_port         = 443
  to_port           = 443
  protocol          = "tcp"
  cidr_blocks       = ["0.0.0.0/0"]
}

# --- RDS: ingress from API on 5432 ---
resource "aws_security_group_rule" "rds_ingress_api" {
  type                     = "ingress"
  security_group_id        = aws_security_group.rds.id
  description              = "PostgreSQL from API ECS tasks only"
  from_port                = 5432
  to_port                  = 5432
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.ecs_api.id
}

# --- Redis: ingress from API on 6379 ---
resource "aws_security_group_rule" "redis_ingress_api" {
  type                     = "ingress"
  security_group_id        = aws_security_group.redis.id
  description              = "Redis from API ECS tasks only"
  from_port                = 6379
  to_port                  = 6379
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.ecs_api.id
}
