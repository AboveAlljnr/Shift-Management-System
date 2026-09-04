variable "environment" {
  type        = string
  description = "Target environment name (e.g., staging)"
}

variable "region" {
  type        = string
  description = "AWS region (used for the awslogs CloudWatch region)"
}

variable "vpc_id" {
  type        = string
  description = "VPC ID"
}

variable "private_subnet_ids" {
  type        = list(string)
  description = "Private subnet IDs for Fargate tasks"
}

variable "api_security_group_id" {
  type        = string
  description = "Security group ID for API ECS tasks"
}

variable "web_security_group_id" {
  type        = string
  description = "Security group ID for Web ECS tasks"
}

variable "ecs_task_execution_role_arn" {
  type        = string
  description = "ARN of the ECS task execution role"
}

variable "ecs_task_role_arn" {
  type        = string
  description = "ARN of the ECS task application role"
}

variable "api_repository_url" {
  type        = string
  description = "ECR repository URL for the API image"
}

variable "web_repository_url" {
  type        = string
  description = "ECR repository URL for the Web image"
}

variable "api_log_group" {
  type        = string
  description = "CloudWatch log group name for the API"
}

variable "web_log_group" {
  type        = string
  description = "CloudWatch log group name for the Web"
}

variable "alb_listener_arn" {
  type        = string
  description = "ARN of the ALB HTTP listener (reserved)"
}

variable "api_target_group_arn" {
  type        = string
  description = "ARN of the API ALB target group"
}

variable "web_target_group_arn" {
  type        = string
  description = "ARN of the Web ALB target group"
}

variable "alb_dns_name" {
  type        = string
  description = "Public ALB DNS name (used for ALLOWED_ORIGINS and NEXT_PUBLIC_API_URL runtime env)"
}

variable "jwt_access_secret_arn" {
  type        = string
  description = "ARN of the JWT access secret in Secrets Manager"
}

variable "jwt_refresh_secret_arn" {
  type        = string
  description = "ARN of the JWT refresh secret in Secrets Manager"
}

variable "database_url_secret_arn" {
  type        = string
  description = "ARN of the DATABASE_URL secret in Secrets Manager"
}

variable "redis_url_secret_arn" {
  type        = string
  description = "ARN of the REDIS_URL secret in Secrets Manager"
}

variable "tags" {
  type        = map(string)
  description = "Default resource tags"
  default     = {}
}
