output "zone_id" {
  description = "The Route53 hosted zone ID"
  value       = data.aws_route53_zone.this.zone_id
}

output "certificate_arn" {
  description = "ARN of the validated ACM certificate for the frontend"
  value       = aws_acm_certificate_validation.frontend.certificate_arn
}
