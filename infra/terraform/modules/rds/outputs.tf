output "endpoint" {
  description = "RDS PostgreSQL endpoint address (host only, no port)"
  value       = aws_db_instance.main.address
}

output "port" {
  description = "RDS PostgreSQL port"
  value       = aws_db_instance.main.port
}

output "db_name" {
  description = "PostgreSQL database name"
  value       = aws_db_instance.main.db_name
}

output "arn" {
  description = "ARN of the RDS instance"
  value       = aws_db_instance.main.arn
}
