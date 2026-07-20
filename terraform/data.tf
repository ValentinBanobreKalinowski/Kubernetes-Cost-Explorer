data "aws_caller_identity" "current" {}

data "aws_iam_policy_document" "backend_reports_assume_role" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [module.eks.oidc_provider_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "${module.eks.oidc_provider_url}:sub"
      values   = ["system:serviceaccount:backend:backend-service-account"]
    }

    condition {
      test     = "StringEquals"
      variable = "${module.eks.oidc_provider_url}:aud"
      values   = ["sts.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "backend_reports_s3_access" {
  statement {
    actions   = ["s3:PutObject"]
    resources = ["${module.s3_reports.bucket_arn}/*"]
  }
}

data "aws_iam_policy_document" "backend_rds_connect" {
  statement {
    actions   = ["rds-db:connect"]
    resources = ["arn:aws:rds-db:${var.region}:${data.aws_caller_identity.current.account_id}:dbuser:${module.rds.resource_id}/${var.postgres_app_username}"]
  }
}

# The Pricing API doesn't support resource-level scoping (no ARNs to
# restrict to) - "*" is the only valid resource for this action.
data "aws_iam_policy_document" "backend_pricing_read" {
  statement {
    actions   = ["pricing:GetProducts"]
    resources = ["*"]
  }
}
