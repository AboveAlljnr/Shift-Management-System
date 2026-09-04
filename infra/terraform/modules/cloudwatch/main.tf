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
# CloudWatch Log Groups for the ECS API and Web services (7-day retention)
# ==============================================================================
resource "aws_cloudwatch_log_group" "api" {
  name              = "/ecs/${var.environment}/api"
  retention_in_days = 7

  tags = merge(
    var.tags,
    { Name = "${var.environment}-api-logs" }
  )
}

resource "aws_cloudwatch_log_group" "web" {
  name              = "/ecs/${var.environment}/web"
  retention_in_days = 7

  tags = merge(
    var.tags,
    { Name = "${var.environment}-web-logs" }
  )
}
