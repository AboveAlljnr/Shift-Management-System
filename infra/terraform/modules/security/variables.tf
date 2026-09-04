variable "environment" {
  type        = string
  description = "Target environment name (e.g., staging)"
}

variable "vpc_id" {
  type        = string
  description = "VPC ID where security groups will be created"
}

variable "tags" {
  type        = map(string)
  description = "Default resource tags"
  default     = {}
}
