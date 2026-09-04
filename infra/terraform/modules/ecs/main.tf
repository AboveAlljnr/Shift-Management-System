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
# ECS Fargate cluster + API & Web services (staging)
#   - Fargate launch type (no EC2, no EKS)
#   - API: 0.25 vCPU / 0.5 GB, 1 replica, port 3001
#   - Web: 0.25 vCPU / 0.5 GB, 1 replica, port 3000
#   - awsvpc networking in private subnets, attached to the ALB target groups
#   - secrets injected from AWS Secrets Manager (valueFrom) - never in env as
#     plaintext in source
# ==============================================================================

resource "aws_ecs_cluster" "main" {
  name = "${var.environment}-cluster"

  setting {
    name  = "containerInsights"
    value = "disabled"
  }

  tags = merge(
    var.tags,
    { Name = "${var.environment}-ecs-cluster" }
  )
}

# --- API task definition ----------------------------------------------------
resource "aws_ecs_task_definition" "api" {
  family                   = "${var.environment}-api-task"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "256" # 0.25 vCPU
  memory                   = "512" # 0.5 GB
  execution_role_arn       = var.ecs_task_execution_role_arn
  task_role_arn            = var.ecs_task_role_arn

  container_definitions = jsonencode([
    {
      name  = "api"
      image = "${var.api_repository_url}:latest"
      portMappings = [
        { containerPort = 3001, protocol = "tcp" }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = var.api_log_group
          "awslogs-region"        = var.region
          "awslogs-stream-prefix" = var.environment
        }
      }
      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "APP_PORT", value = "3001" },
        { name = "ALLOWED_ORIGINS", value = "http://${var.alb_dns_name}" },
        { name = "JWT_ACCESS_EXPIRES_IN", value = "15m" },
        { name = "JWT_REFRESH_EXPIRES_IN", value = "7d" },
      ]
      secrets = [
        { name = "JWT_ACCESS_SECRET", valueFrom = var.jwt_access_secret_arn },
        { name = "JWT_REFRESH_SECRET", valueFrom = var.jwt_refresh_secret_arn },
        { name = "DATABASE_URL", valueFrom = var.database_url_secret_arn },
        { name = "REDIS_URL", valueFrom = var.redis_url_secret_arn },
      ]
    }
  ])

  tags = merge(
    var.tags,
    { Name = "${var.environment}-api-task" }
  )
}

# --- Web task definition ----------------------------------------------------
resource "aws_ecs_task_definition" "web" {
  family                   = "${var.environment}-web-task"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "256" # 0.25 vCPU
  memory                   = "512" # 0.5 GB
  execution_role_arn       = var.ecs_task_execution_role_arn
  task_role_arn            = var.ecs_task_role_arn

  container_definitions = jsonencode([
    {
      name  = "web"
      image = "${var.web_repository_url}:latest"
      portMappings = [
        { containerPort = 3000, protocol = "tcp" }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = var.web_log_group
          "awslogs-region"        = var.region
          "awslogs-stream-prefix" = var.environment
        }
      }
      environment = [
        { name = "NODE_ENV", value = "production" },
        # Public env is inlined at image build; this runtime value supports server-side reads.
        { name = "NEXT_PUBLIC_API_URL", value = "http://${var.alb_dns_name}/api/v1" },
      ]
    }
  ])

  tags = merge(
    var.tags,
    { Name = "${var.environment}-web-task" }
  )
}

# --- API ECS service --------------------------------------------------------
resource "aws_ecs_service" "api" {
  name            = "${var.environment}-api-service"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.api.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [var.api_security_group_id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = var.api_target_group_arn
    container_name   = "api"
    container_port   = 3001
  }

  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  depends_on = [
    aws_ecs_cluster.main,
    aws_ecs_task_definition.api,
  ]

  tags = merge(
    var.tags,
    { Name = "${var.environment}-api-service" }
  )
}

# --- Web ECS service --------------------------------------------------------
resource "aws_ecs_service" "web" {
  name            = "${var.environment}-web-service"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.web.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [var.web_security_group_id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = var.web_target_group_arn
    container_name   = "web"
    container_port   = 3000
  }

  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  depends_on = [
    aws_ecs_cluster.main,
    aws_ecs_task_definition.web,
  ]

  tags = merge(
    var.tags,
    { Name = "${var.environment}-web-service" }
  )
}
