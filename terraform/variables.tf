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

variable "domain_name" {
  description = "Registered domain name, e.g. valentin-cloud.com"
  type        = string
}

variable "app_hostname" {
  description = "Full hostname the app is served on, e.g. cluster-metrics.valentin-cloud.com"
  type        = string
}

variable "postgres_app_username" {
  description = "DB role the backend connects as using IAM auth tokens (granted rds_iam by the bootstrap job) - distinct from the master user, which RDS doesn't allow IAM auth for"
  type        = string
  default     = "app_iam_user"
}