# Outputs expose secret ARNs only - never the secret values (contents stay in
# Secrets Manager; retrieving them requires AWS CLI access with permission).

output "jwt_access_secret_arn" {
  description = "ARN of the JWT access secret (value not printed)"
  value       = aws_secretsmanager_secret.jwt_access_secret.arn
}

output "jwt_refresh_secret_arn" {
  description = "ARN of the JWT refresh secret (value not printed)"
  value       = aws_secretsmanager_secret.jwt_refresh_secret.arn
}

output "database_url_secret_arn" {
  description = "ARN of the DATABASE_URL secret (value not printed)"
  value       = aws_secretsmanager_secret.database_url.arn
}

output "redis_url_secret_arn" {
  description = "ARN of the REDIS_URL secret (value not printed)"
  value       = aws_secretsmanager_secret.redis_url.arn
}
