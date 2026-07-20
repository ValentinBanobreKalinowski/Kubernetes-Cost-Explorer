# Domain registration already created a hosted zone for this domain, so we
# look it up instead of creating a new one.
data "aws_route53_zone" "this" {
  name = var.domain_name
}
