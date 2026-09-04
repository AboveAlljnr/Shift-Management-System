variable "environment" {
  type        = string
  description = "Target environment name (e.g., staging)"
}

variable "tags" {
  type        = map(string)
  description = "Default resource tags"
  default     = {}
}
