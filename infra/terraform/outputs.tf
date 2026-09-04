# ==============================================================================
# Outputs - intentionally exclude all secret values (JWT secrets, DB password,
# DATABASE_URL, REDIS_URL are never printed).
# ==============================================================================

output "vpc_id" {
  description = "VPC ID for the staging environment"
  value       = module.networking.vpc_id
}

output "alb_dns_name" {
  description = "Public ALB DNS hostname - the staging entrypoint (HTTP on port 80). The Web image must be built with NEXT_PUBLIC_API_URL pointing at this host (the /api/v1 path served by the ALB)."
  value       = module.alb.alb_dns_name
}

output "alb_zone_id" {
  description = "Route53 zone ID of the ALB (for optional custom-DNS alias)"
  value       = module.alb.alb_zone_id
}

output "rds_endpoint" {
  description = "Private RDS PostgreSQL endpoint (host). Reachable only from API ECS tasks."
  value       = module.rds.endpoint
}

output "redis_endpoint" {
  description = "Private ElastiCache Redis endpoint (host). Reachable only from API ECS tasks."
  value       = module.redis.endpoint
}

output "api_ecr_url" {
  description = "ECR repository URL for the API image"
  value       = module.ecr.api_repository_url
}

output "web_ecr_url" {
  description = "ECR repository URL for the Web image"
  value       = module.ecr.web_repository_url
}

output "ecs_cluster_name" {
  description = "Name of the ECS cluster hosting the API and Web Fargate services"
  value       = module.ecs.cluster_name
}

# Expose ARNs (not values) so operators can retrieve secret values via AWS CLI,
# without Terraform ever printing the secret contents.
output "jwt_access_secret_arn" {
  description = "ARN of the JWT access secret in Secrets Manager (value not printed)"
  value       = module.secrets.jwt_access_secret_arn
}

output "database_url_secret_arn" {
  description = "ARN of the DATABASE_URL secret in Secrets Manager (value not printed)"
  value       = module.secrets.database_url_secret_arn
}

output "redis_url_secret_arn" {
  description = "ARN of the REDIS_URL secret in Secrets Manager (value not printed)"
  value       = module.secrets.redis_url_secret_arn
}
