variable "environment" {
  type        = string
  description = "Target environment name (e.g., staging)"
}

variable "vpc_id" {
  type        = string
  description = "VPC ID (for subnet group association context)"
}

variable "private_subnet_ids" {
  type        = list(string)
  description = "Private subnet IDs for the DB subnet group"
}

variable "db_security_group" {
  type        = string
  description = "Security group ID permitting PostgreSQL 5432 ingress from API ECS tasks only"
}

variable "db_name" {
  type        = string
  description = "PostgreSQL database name"
}

variable "db_username" {
  type        = string
  description = "Master username for RDS PostgreSQL"
}

variable "db_password" {
  type        = string
  description = "Master password for RDS PostgreSQL (generated at apply time; never committed)"
  sensitive   = true
}

variable "tags" {
  type        = map(string)
  description = "Default resource tags"
  default     = {}
}
