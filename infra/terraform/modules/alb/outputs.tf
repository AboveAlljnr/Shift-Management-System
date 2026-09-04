output "alb_dns_name" {
  description = "Public DNS name of the ALB (staging entrypoint, HTTP on 80)"
  value       = aws_lb.main.dns_name
}

output "alb_zone_id" {
  description = "Route53 hosted zone ID of the ALB (for optional custom-DNS alias)"
  value       = aws_lb.main.zone_id
}

output "listener_arn" {
  description = "ARN of the HTTP listener (for ECS service attachment)"
  value       = aws_lb_listener.http.arn
}

output "api_target_group_arn" {
  description = "ARN of the API target group"
  value       = aws_lb_target_group.api.arn
}

output "web_target_group_arn" {
  description = "ARN of the Web target group"
  value       = aws_lb_target_group.web.arn
}

output "api_target_group_name" {
  description = "Name of the API target group"
  value       = aws_lb_target_group.api.name
}

output "web_target_group_name" {
  description = "Name of the Web target group"
  value       = aws_lb_target_group.web.name
}
