variable "environment" {
  type        = string
  description = "Target environment name (e.g., staging)"
  default     = "staging"
}

variable "region" {
  type        = string
  description = "AWS region for the staging deployment"
  default     = "us-east-1"
}

variable "availability_zones" {
  type        = list(string)
  description = "Two availability zones used for subnets. Must match the selected region."
  default     = ["us-east-1a", "us-east-1b"]
}

variable "vpc_cidr" {
  type        = string
  description = "CIDR block for the VPC"
  default     = "10.0.0.0/16"
}

variable "public_subnet_cidrs" {
  type        = list(string)
  description = "CIDR blocks for the 2 public subnets (ALB)."
  default     = ["10.0.1.0/24", "10.0.2.0/24"]
}

variable "private_subnet_cidrs" {
  type        = list(string)
  description = "CIDR blocks for the 2 private subnets (ECS, RDS, Redis)."
  default     = ["10.0.10.0/24", "10.0.20.0/24"]
}

variable "db_name" {
  type        = string
  description = "PostgreSQL database name created inside RDS."
  default     = "sms"
}

variable "db_username" {
  type        = string
  description = "Master username for RDS PostgreSQL. The password is generated at apply time and never committed."
  default     = "sms"
}

variable "tags" {
  type        = map(string)
  description = "Default resource tags applied to all resources."
  default = {
    Project     = "shift-management-system"
    Environment = "staging"
    ManagedBy   = "terraform"
  }
}
