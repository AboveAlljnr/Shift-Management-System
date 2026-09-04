variable "environment" {
  type        = string
  description = "Target environment name (e.g., staging)"
}

variable "private_subnet_ids" {
  type        = list(string)
  description = "Private subnet IDs for the ElastiCache subnet group"
}

variable "redis_security_group" {
  type        = string
  description = "Security group ID permitting Redis 6379 ingress from API ECS tasks only"
}

variable "tags" {
  type        = map(string)
  description = "Default resource tags"
  default     = {}
}
