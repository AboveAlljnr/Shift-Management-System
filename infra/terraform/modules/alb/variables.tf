variable "environment" {
  type        = string
  description = "Target environment name (e.g., staging)"
}

variable "vpc_id" {
  type        = string
  description = "VPC ID for the ALB and target groups"
}

variable "public_subnet_ids" {
  type        = list(string)
  description = "Public subnet IDs for the internet-facing ALB"
}

variable "alb_security_group_id" {
  type        = string
  description = "Security group ID for the ALB"
}

variable "api_security_group_id" {
  type        = string
  description = "Security group ID for API ECS tasks (for forwarding rules to API)"
}

variable "web_security_group_id" {
  type        = string
  description = "Security group ID for Web ECS tasks (for forwarding rules to Web)"
}

variable "tags" {
  type        = map(string)
  description = "Default resource tags"
  default     = {}
}
