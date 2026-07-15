#!/usr/bin/env bash

# The script deploys the app to EKS. We first need to run terraform apply of course to provision the infrastructure. 

set -euo pipefail # Exit on error, unset variable, or error in pipe
cd "$(dirname "$0")" # Change to the script's directory so we can run it from anywhere

REGION=$(terraform -chdir=terraform output -raw region) # Get the region from terraform output
export REGION # So that Skaffold can pick it up.

POSTGRES_HOST=$(terraform -chdir=terraform output -raw rds_address) # Get the RDS address from terraform output
export POSTGRES_HOST # Export the RDS address so that the app can connect to it

S3_REPORTS_BUCKET=$(terraform -chdir=terraform output -raw s3_reports_bucket) # Get the buckets name
export S3_REPORTS_BUCKET # Export so that Skaffold can pick it up

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text) # Get the AWS account ID
ECR_REGISTRY="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com" # Construct the ECR registry URL

aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$ECR_REGISTRY" # Login to ECR

# Set environment variables from .env file
set -a
source .env
set +a

# Build and push the Docker images to ECR, then deploy to EKS using Skaffold
skaffold run -p eks --default-repo="$ECR_REGISTRY"
