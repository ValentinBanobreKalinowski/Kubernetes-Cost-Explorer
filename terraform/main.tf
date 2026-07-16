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
  subnet_ids = module.vpc.public_subnet_ids
}

module "rds" {
  source = "./modules/rds"

  name                       = "kubernetes-cluster-metrics"
  vpc_id                     = module.vpc.vpc_id
  subnet_ids                 = module.vpc.public_subnet_ids
  allowed_security_group_ids = [module.eks.cluster_security_group_id]

  db_name  = var.postgres_db
  username = var.postgres_user
  password = var.postgres_password
}

resource "aws_ecr_repository" "backend" {
  name                 = "cost-explorer-backend"
  image_tag_mutability = "MUTABLE"
  force_delete = true
}

resource "aws_ecr_repository" "frontend" {
  name                 = "cost-explorer-frontend"
  image_tag_mutability = "MUTABLE"
  force_delete = true
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