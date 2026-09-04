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
# ElastiCache Redis 7.x (staging)
#   - single node cache.t4g.micro
#   - private (in private subnets, no public exposure)
#   - no cluster mode (no replication group / no sharding)
#   - no production HA
# ==============================================================================

# Subnet group across the private subnets
resource "aws_elasticache_subnet_group" "main" {
  name       = "${var.environment}-redis-subnet-group"
  subnet_ids = var.private_subnet_ids

  tags = merge(
    var.tags,
    { Name = "${var.environment}-redis-subnet-group" }
  )
}

# Single-node Redis cache cluster (engine_version 7.x)
resource "aws_elasticache_cluster" "main" {
  cluster_id           = "${var.environment}-sms-redis"
  engine               = "redis"
  engine_version       = "7.1"
  node_type            = "cache.t4g.micro"
  num_cache_nodes      = 1
  port                 = 6379
  parameter_group_name = "default.redis7"
  subnet_group_name    = aws_elasticache_subnet_group.main.name
  security_group_ids   = [var.redis_security_group]

  # Snapshot/backup retention for staging (explicit, minimal)
  snapshot_retention_limit = 1

  auto_minor_version_upgrade = false

  tags = merge(
    var.tags,
    { Name = "${var.environment}-sms-redis" }
  )
}
