variable "environment" {
  type        = string
  description = "Target environment name (e.g., staging)"
}

variable "secret_arns" {
  type        = list(string)
  description = "List of Secrets Manager secret ARNs that ECS tasks are permitted to read"
  default     = []
}

variable "tags" {
  type        = map(string)
  description = "Default resource tags"
  default     = {}
}
