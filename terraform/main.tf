terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

# Configure the AWS Provider
provider "aws" {
  region = var.region
}

module "vpc" {
  source = "./modules/vpc"

  name               = "kubernetes-cluster-metrics"
  vpc_cidr           = "10.0.0.0/16"
  availability_zones = ["${var.region}a", "${var.region}b"]
}