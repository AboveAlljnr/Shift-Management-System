output "api_log_group_name" {
  description = "Name of the API CloudWatch log group"
  value       = aws_cloudwatch_log_group.api.name
}

output "web_log_group_name" {
  description = "Name of the Web CloudWatch log group"
  value       = aws_cloudwatch_log_group.web.name
}
