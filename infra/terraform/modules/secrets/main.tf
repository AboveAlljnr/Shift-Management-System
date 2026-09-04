terraform {
  required_version = ">= 1.9.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.50"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

# ==============================================================================
# Random Secret Generation (No plaintext credentials committed)
# ==============================================================================
resource "random_password" "jwt_access_secret" {
  length  = 32
  special = false
}

resource "random_password" "jwt_refresh_secret" {
  length  = 32
  special = false
}

# ==============================================================================
# AWS Secrets Manager Secret Containers
# ==============================================================================
resource "aws_secretsmanager_secret" "jwt_access_secret" {
  name                    = "/sms/${var.environment}/jwt-access-secret"
  description             = "JWT access token signing secret for ${var.environment}"
  recovery_window_in_days = 0

  tags = merge(
    var.tags,
    {
      Name = "${var.environment}-jwt-access-secret"
    }
  )
}

resource "aws_secretsmanager_secret_version" "jwt_access_secret" {
  secret_id     = aws_secretsmanager_secret.jwt_access_secret.id
  secret_string = random_password.jwt_access_secret.result
}

resource "aws_secretsmanager_secret" "jwt_refresh_secret" {
  name                    = "/sms/${var.environment}/jwt-refresh-secret"
  description             = "JWT refresh token signing secret for ${var.environment}"
  recovery_window_in_days = 0

  tags = merge(
    var.tags,
    {
      Name = "${var.environment}-jwt-refresh-secret"
    }
  )
}

resource "aws_secretsmanager_secret_version" "jwt_refresh_secret" {
  secret_id     = aws_secretsmanager_secret.jwt_refresh_secret.id
  secret_string = random_password.jwt_refresh_secret.result
}

resource "aws_secretsmanager_secret" "database_url" {
  name                    = "/sms/${var.environment}/database-url"
  description             = "PostgreSQL DATABASE_URL connection string for ${var.environment}"
  recovery_window_in_days = 0

  tags = merge(
    var.tags,
    {
      Name = "${var.environment}-database-url"
    }
  )
}

resource "aws_secretsmanager_secret_version" "database_url" {
  secret_id     = aws_secretsmanager_secret.database_url.id
  secret_string = "postgresql://${var.db_username}:${var.db_password}@${var.db_endpoint}:${var.db_port}/${var.db_name}?schema=public"
}

resource "aws_secretsmanager_secret" "redis_url" {
  name                    = "/sms/${var.environment}/redis-url"
  description             = "Redis connection URL for ${var.environment}"
  recovery_window_in_days = 0

  tags = merge(
    var.tags,
    {
      Name = "${var.environment}-redis-url"
    }
  )
}

resource "aws_secretsmanager_secret_version" "redis_url" {
  secret_id     = aws_secretsmanager_secret.redis_url.id
  secret_string = "redis://${var.redis_endpoint}:${var.redis_port}"
}
