variable "domain_name" {
  description = "Registered domain name, e.g. valentin-cloud.com"
  type        = string
}

variable "app_hostname" {
  description = "Full hostname the app is served on, e.g. cluster-metrics.valentin-cloud.com"
  type        = string
}
