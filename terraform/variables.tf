variable "region" {
  description = "AWS region to deploy resources"
  type        = string
  default     = "eu-central-1"
}

variable "postgres_db" {
  type = string
}

variable "postgres_user" {
  type      = string
  sensitive = true
}

variable "postgres_password" {
  type      = string
  sensitive = true
}

variable "postgres_app_username" {
  description = "DB role the backend connects as using IAM auth tokens (granted rds_iam by the bootstrap job) - distinct from the master user, which RDS doesn't allow IAM auth for"
  type        = string
  default     = "app_iam_user"
}