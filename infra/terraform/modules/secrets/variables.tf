variable "environment" {
  type        = string
  description = "Target environment name (e.g., staging)"
}

variable "db_username" {
  type        = string
  description = "PostgreSQL master username (used to compose the DATABASE_URL secret value)"
}

variable "db_password" {
  type        = string
  description = "PostgreSQL master password (generated at apply time; used only to compose the DATABASE_URL secret value)"
  sensitive   = true
}

variable "db_endpoint" {
  type        = string
  description = "RDS endpoint host for the DATABASE_URL secret"
}

variable "db_port" {
  type        = number
  description = "RDS port for the DATABASE_URL secret"
}

variable "db_name" {
  type        = string
  description = "PostgreSQL database name for the DATABASE_URL secret"
}

variable "redis_endpoint" {
  type        = string
  description = "ElastiCache Redis endpoint host for the REDIS_URL secret"
}

variable "redis_port" {
  type        = number
  description = "ElastiCache Redis port for the REDIS_URL secret"
}

variable "tags" {
  type        = map(string)
  description = "Default resource tags"
  default     = {}
}
