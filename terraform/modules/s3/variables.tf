variable "name" {
  type        = string
  description = "S3 bucket name for cost reports (must be globally unique)"
}

variable "retention_days" {
  type        = number
  default     = 30
  description = "Days to retain report objects before automatic expiration"
}

output "bucket_name" {
  value = aws_s3_bucket.reports.bucket
}

output "bucket_arn" {
  value = aws_s3_bucket.reports.arn
}