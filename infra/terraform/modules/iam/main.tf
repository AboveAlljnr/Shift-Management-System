terraform {
  required_version = ">= 1.9.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.50"
    }
  }
}

# Assume role policy for ECS Tasks
data "aws_iam_policy_document" "ecs_tasks_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

# ==============================================================================
# ECS Task Execution Role (used by AWS to launch containers & pull secrets)
# ==============================================================================
resource "aws_iam_role" "ecs_task_execution_role" {
  name               = "${var.environment}-ecs-task-execution-role"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_trust.json

  tags = merge(
    var.tags,
    {
      Name = "${var.environment}-ecs-task-execution-role"
    }
  )
}

# Attach standard AWS managed policy for ECR and CloudWatch logs
resource "aws_iam_role_policy_attachment" "ecs_task_execution_standard" {
  role       = aws_iam_role.ecs_task_execution_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# Scoped inline policy allowing retrieval of specific Secrets Manager secrets
data "aws_iam_policy_document" "secrets_access" {
  statement {
    effect = "Allow"
    actions = [
      "secretsmanager:GetSecretValue",
      "secretsmanager:DescribeSecret"
    ]
    resources = var.secret_arns
  }
}

resource "aws_iam_role_policy" "ecs_task_execution_secrets" {
  count  = length(var.secret_arns) > 0 ? 1 : 0
  name   = "${var.environment}-secrets-manager-read"
  role   = aws_iam_role.ecs_task_execution_role.id
  policy = data.aws_iam_policy_document.secrets_access.json
}

# ==============================================================================
# ECS Task Application Role (runtime identity for the running container)
# ==============================================================================
resource "aws_iam_role" "ecs_task_role" {
  name               = "${var.environment}-ecs-task-role"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_trust.json

  tags = merge(
    var.tags,
    {
      Name = "${var.environment}-ecs-task-role"
    }
  )
}
