terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.35"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.16"
    }
    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.0"
    }
  }
}

# Configure the AWS Provider
provider "aws" {
  region = var.region
}

# Both providers auth against the EKS cluster created below via short-lived
# tokens from `aws eks get-token`, so no static credentials are stored.
provider "kubernetes" {
  host                   = module.eks.cluster_endpoint
  cluster_ca_certificate = base64decode(module.eks.cluster_ca_certificate)
  exec {
    api_version = "client.authentication.k8s.io/v1beta1"
    command     = "aws"
    args        = ["eks", "get-token", "--cluster-name", module.eks.cluster_name, "--region", var.region]
  }
}

provider "helm" {
  kubernetes {
    host                   = module.eks.cluster_endpoint
    cluster_ca_certificate = base64decode(module.eks.cluster_ca_certificate)
    exec {
      api_version = "client.authentication.k8s.io/v1beta1"
      command     = "aws"
      args        = ["eks", "get-token", "--cluster-name", module.eks.cluster_name, "--region", var.region]
    }
  }
}

module "vpc" {
  source = "./modules/vpc"

  name               = "kubernetes-cluster-metrics"
  vpc_cidr           = "10.0.0.0/16"
  availability_zones = ["${var.region}a", "${var.region}b"]
}

module "eks" {
  source = "./modules/eks"

  name       = "kubernetes-cluster-metrics"
  vpc_id     = module.vpc.vpc_id
  subnet_ids = module.vpc.private_subnet_ids
}

module "rds" {
  source = "./modules/rds"

  name                       = "kubernetes-cluster-metrics"
  vpc_id                     = module.vpc.vpc_id
  subnet_ids                 = module.vpc.private_subnet_ids
  allowed_security_group_ids = [module.eks.cluster_security_group_id]

  db_name  = var.postgres_db
  username = var.postgres_user
  password = var.postgres_password
}

resource "aws_ecr_repository" "backend" {
  name                 = "cost-explorer-backend"
  image_tag_mutability = "MUTABLE"
  force_delete         = true
}

resource "aws_ecr_repository" "frontend" {
  name                 = "cost-explorer-frontend"
  image_tag_mutability = "MUTABLE"
  force_delete         = true
}

# App namespaces - created here (not by the Helm chart) so they exist and are
# fully established before any skaffold / helm deploy runs against the cluster.
resource "kubernetes_namespace" "backend" {
  metadata {
    name = "backend"
  }
  depends_on = [module.eks]
}

resource "kubernetes_namespace" "frontend" {
  metadata {
    name = "frontend"
  }
  depends_on = [module.eks]
}


data "aws_caller_identity" "current" {}

module "s3_reports" {
  source = "./modules/s3"

  // Each s3 bucket has to have a globally unique name. We can add the accountID suffix to keep it unique.
  name = "kubernetes-cost-explorer-reports-${data.aws_caller_identity.current.account_id}"
}

// IRSA: lets the backend pod assume this role via its ServiceAccount's OIDC token instead of AWS credentials.

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

resource "aws_iam_role" "backend_reports" {
  name               = "kubernetes-cost-explorer-backend-reports-role"
  assume_role_policy = data.aws_iam_policy_document.backend_reports_assume_role.json
}

data "aws_iam_policy_document" "backend_reports_s3_access" {
  statement {
    actions   = ["s3:PutObject"]
    resources = ["${module.s3_reports.bucket_arn}/*"]
  }
}

resource "aws_iam_role_policy" "backend_reports_s3_access" {
  name   = "s3-reports-write"
  role   = aws_iam_role.backend_reports.id
  policy = data.aws_iam_policy_document.backend_reports_s3_access.json
}


data "aws_iam_policy_document" "backend_rds_connect" {
  statement {
    actions   = ["rds-db:connect"]
    resources = ["arn:aws:rds-db:${var.region}:${data.aws_caller_identity.current.account_id}:dbuser:${module.rds.resource_id}/${var.postgres_app_username}"]
  }
}

resource "aws_iam_role_policy" "backend_rds_connect" {
  name   = "rds-iam-connect"
  role   = aws_iam_role.backend_reports.id
  policy = data.aws_iam_policy_document.backend_rds_connect.json
}

# The Pricing API doesn't support resource-level scoping (no ARNs to
# restrict to) - "*" is the only valid resource for this action.
data "aws_iam_policy_document" "backend_pricing_read" {
  statement {
    actions   = ["pricing:GetProducts"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "backend_pricing_read" {
  name   = "pricing-read"
  role   = aws_iam_role.backend_reports.id
  policy = data.aws_iam_policy_document.backend_pricing_read.json
}

# Dedicated ServiceAccount (not "default") so the IRSA role only grants S3
# access to backend pods, not everything else running in the namespace.
# Created directly here, same as the namespaces above, since the Helm chart
# never manages cluster-scoped identity objects.
resource "kubernetes_service_account" "backend" {
  metadata {
    name      = "backend-service-account"
    namespace = kubernetes_namespace.backend.metadata[0].name
    annotations = {
      "eks.amazonaws.com/role-arn" = aws_iam_role.backend_reports.arn
    }
  }
}

# RDS Postgres doesn't allow IAM auth for the master user, so a separate DB
# role has to be created and granted rds_iam before the backend can connect
# with IAM tokens. RDS isn't publicly reachable (SG only allows the EKS node
# SG), so this has to run from inside the cluster - a one-shot Job using the
# master credentials, created directly here same as the ServiceAccount above
# rather than via the Helm chart. Reuses postgres:17-alpine purely for its
# psql client, same as the wait-for-postgres initContainer in the chart.
resource "kubernetes_job" "rds_iam_bootstrap" {
  metadata {
    name      = "rds-iam-bootstrap"
    namespace = kubernetes_namespace.backend.metadata[0].name
  }

  spec {
    backoff_limit = 3

    template {
      metadata {
        name = "rds-iam-bootstrap"
      }
      spec {
        # Never (not OnFailure) so failed pods are kept around instead of
        # being deleted once backoff_limit is hit - lets us read logs from
        # a failed attempt instead of losing them.
        restart_policy = "Never"

        container {
          name  = "psql"
          image = "postgres:17-alpine"

          env {
            name  = "PGPASSWORD"
            value = var.postgres_password
          }

          command = ["psql"]
          args = [
            "-h", module.rds.address,
            "-p", tostring(module.rds.port),
            "-U", var.postgres_user,
            "-d", var.postgres_db,
            "-v", "ON_ERROR_STOP=1",
            "-c", <<-EOT
              DO $body$
              BEGIN
                IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${var.postgres_app_username}') THEN
                  CREATE ROLE ${var.postgres_app_username} WITH LOGIN;
                END IF;
              END
              $body$;
              GRANT rds_iam TO ${var.postgres_app_username};
              GRANT ALL ON SCHEMA public TO ${var.postgres_app_username};
              GRANT ALL PRIVILEGES ON DATABASE ${var.postgres_db} TO ${var.postgres_app_username};
            EOT
          ]
        }
      }
    }
  }

  wait_for_completion = true

  timeouts {
    create = "3m"
    update = "3m"
  }

  depends_on = [module.rds, module.eks]
}

# metrics-server isn't an AWS-managed EKS addon, so it's installed here rather
# than left as a manual post-apply step. Backs the HPA and the /api/cluster
# node CPU/memory data.
resource "helm_release" "metrics_server" {
  name       = "metrics-server"
  repository = "https://kubernetes-sigs.github.io/metrics-server/"
  chart      = "metrics-server"
  namespace  = "kube-system"

  depends_on = [module.eks]
}