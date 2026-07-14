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
}

resource "aws_ecr_repository" "frontend" {
  name                 = "cost-explorer-frontend"
  image_tag_mutability = "MUTABLE"
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