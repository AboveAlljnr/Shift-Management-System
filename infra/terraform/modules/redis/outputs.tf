output "endpoint" {
  description = "ElastiCache Redis endpoint (host only, no port)"
  value       = aws_elasticache_cluster.main.cache_nodes[0].address
}

output "port" {
  description = "ElastiCache Redis port"
  value       = aws_elasticache_cluster.main.port
}

output "arn" {
  description = "ARN of the ElastiCache Redis cluster"
  value       = aws_elasticache_cluster.main.arn
}
