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
# Public internet-facing Application Load Balancer (staging)
#   - HTTP on port 80, using the ALB DNS hostname
#   - /api/*            -> API
#   - /socket.io/*      -> API (WebSocket/Socket.IO)
#   - default (*)       -> Web
# ==============================================================================

locals {
  # Map stage path prefixes to their target group (for the listener rules).
  path_rules = [
    { priority = 100, prefix = "/api/*", target = aws_lb_target_group.api.arn },
    { priority = 110, prefix = "/socket.io/*", target = aws_lb_target_group.api.arn },
  ]
}

# Target group for the API (NestJS on 3001)
resource "aws_lb_target_group" "api" {
  name        = "${var.environment}-api-tg"
  port        = 3001
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    path                = "/api/v1/health/live"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    timeout             = 5
    interval            = 30
    protocol            = "HTTP"
    matcher             = "200"
  }

  tags = merge(
    var.tags,
    { Name = "${var.environment}-api-tg" }
  )
}

# Target group for the Web (Next.js on 3000)
resource "aws_lb_target_group" "web" {
  name        = "${var.environment}-web-tg"
  port        = 3000
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    path                = "/"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    timeout             = 5
    interval            = 30
    protocol            = "HTTP"
    matcher             = "200"
  }

  tags = merge(
    var.tags,
    { Name = "${var.environment}-web-tg" }
  )
}

# Public internet-facing ALB in the public subnets
resource "aws_lb" "main" {
  name               = "${var.environment}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [var.alb_security_group_id]
  subnets            = var.public_subnet_ids

  enable_deletion_protection = false

  tags = merge(
    var.tags,
    { Name = "${var.environment}-alb" }
  )
}

# HTTP listener on port 80 -> Web by default, with path rules to API.
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.web.arn
  }
}

# Path-based listener rules: /api/* and /socket.io/* -> API target group.
resource "aws_lb_listener_rule" "path" {
  count        = length(local.path_rules)
  listener_arn = aws_lb_listener.http.arn
  priority     = local.path_rules[count.index].priority

  action {
    type             = "forward"
    target_group_arn = local.path_rules[count.index].target
  }

  condition {
    path_pattern {
      values = [local.path_rules[count.index].prefix]
    }
  }
}
