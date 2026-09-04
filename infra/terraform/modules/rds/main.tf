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
# RDS PostgreSQL 16 (staging)
#   - private (not publicly accessible)
#   - single AZ db.t4g.micro (no Multi-AZ - explicitly NOT created)
#   - 20 GB gp3 storage
#   - encryption enabled
#   - backups/retention explicitly configured
# ==============================================================================

# DB subnet group across the private subnets
resource "aws_db_subnet_group" "main" {
  name        = "${var.environment}-rds-subnet-group"
  description = "Private subnets for RDS PostgreSQL"
  subnet_ids  = var.private_subnet_ids

  tags = merge(
    var.tags,
    { Name = "${var.environment}-rds-subnet-group" }
  )
}

resource "aws_db_parameter_group" "postgres16" {
  name        = "${var.environment}-postgres16"
  family      = "postgres16"
  description = "PostgreSQL 16 parameter group for ${var.environment}"

  tags = merge(
    var.tags,
    { Name = "${var.environment}-postgres16" }
  )
}

resource "aws_db_instance" "main" {
  identifier     = "${var.environment}-sms-db"
  engine         = "postgres"
  engine_version = "16.1"
  instance_class = "db.t4g.micro"

  allocated_storage     = 20
  storage_type          = "gp3"
  max_allocated_storage = 0

  db_name  = var.db_name
  username = var.db_username
  password = var.db_password

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [var.db_security_group]
  parameter_group_name   = aws_db_parameter_group.postgres16.name

  publicly_accessible = false
  multi_az            = false

  # Storage encryption (encryption at rest)
  storage_encrypted = true

  # Backups / retention explicitly configured
  backup_retention_period   = 7
  backup_window             = "03:00-04:00"
  maintenance_window        = "sun:04:00-sun:05:00"
  skip_final_snapshot       = false
  final_snapshot_identifier = "${var.environment}-sms-db-final"
  deletion_protection       = false

  performance_insights_enabled = false

  tags = merge(
    var.tags,
    { Name = "${var.environment}-sms-db" }
  )
}
