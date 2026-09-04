variable "environment" {
  type        = string
  description = "Target environment name (e.g., staging)"
}

variable "vpc_cidr" {
  type        = string
  description = "CIDR block for the VPC"
  default     = "10.0.0.0/16"
}

variable "availability_zones" {
  type        = list(string)
  description = "List of 2 availability zones in the selected region"
}

variable "public_subnet_cidrs" {
  type        = list(string)
  description = "CIDR blocks for public subnets (2 required for ALB)"
  default     = ["10.0.1.0/24", "10.0.2.0/24"]
}

variable "private_subnet_cidrs" {
  type        = list(string)
  description = "CIDR blocks for private subnets (2 required for RDS/ElastiCache/ECS)"
  default     = ["10.0.10.0/24", "10.0.20.0/24"]
}

variable "tags" {
  type        = map(string)
  description = "Default resource tags"
  default     = {}
}
