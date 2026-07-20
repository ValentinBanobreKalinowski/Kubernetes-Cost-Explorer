<div align="center">

# Kubernetes Cluster Metrics & Cost Explorer


![AWS](https://img.shields.io/badge/AWS-%23FF9900.svg?style=for-the-badge&logo=amazon-aws&logoColor=white)
![Kubernetes](https://img.shields.io/badge/kubernetes-%23326CE5.svg?style=for-the-badge&logo=kubernetes&logoColor=white)
![Terraform](https://img.shields.io/badge/terraform-%235835CC.svg?style=for-the-badge&logo=terraform&logoColor=white)
![Docker](https://img.shields.io/badge/docker-%230db7ed.svg?style=for-the-badge&logo=docker&logoColor=white)
![GitHub Actions](https://img.shields.io/badge/github%20actions-%232088FF.svg?style=for-the-badge&logo=githubactions&logoColor=white)


</div>

## Overview
A dashboard that tracks per-namespace resource usage and estimated cost across a Kubernetes cluster in real time. It snapshots pod resource requests on an interval, prices them against real AWS EC2 on-demand rates for whichever node they're running on, stores the history in Postgres, and exports hourly cost reports to S3.

![Application](docs/application.png)

## Architecture
### AWS infrastructure
VPC across 2 AZs, EKS + Multi-AZ RDS in private subnets, NAT gateway per AZ for outbound access, an IAM OIDC provider for IRSA, and Route53/ACM for TLS on the frontend load balancer.
![Infrastructure diagram](docs/infrastructure.svg)

### Kubernetes cluster
Frontend and backend Deployments in their own namespaces, each behind an HPA, with IRSA-backed ServiceAccounts for AWS access instead of static credentials.
![Cluster diagram](docs/cluster.svg)


## Key Design Decisions

| Section | Explanation |
|---|---|
| **High Availability** | RDS Multi-AZ standby replica for automatic failover<br>One NAT gateway + EIP per AZ, so private subnet egress survives an AZ outage<br>EKS node group spans both AZs (2-4 nodes), so losing one AZ doesn't take down the cluster |
| **Security** | No static AWS credentials — IRSA for S3, RDS, and Pricing API<br>Dedicated ServiceAccount + read-only ClusterRole<br>Private subnets, no public IPs<br>TLS via a Route53-hosted domain + DNS-validated ACM certificate on the frontend NLB |
| **Elasticity** | HPA on frontend + backend: 3–30 pods, CPU-based<br>EKS node group scales 2-4 nodes on CPU via target tracking |
| **Cost-Efficiency** | RDS on db.t4g.micro — cheapest general-purpose Graviton class<br>gp3 storage instead of gp2<br>No RDS backups (acceptable trade-off for a demo project)<br>Node and pod autoscaling avoid paying for idle capacity |

## How to Run

**Prerequisites:** Docker, kubectl, [skaffold](https://skaffold.dev/), Terraform, AWS CLI (configured with credentials).

### Local (k3d)
1. Point kubectl at a local k3d cluster.
2. Copy `.env.example` to `.env` and fill in Postgres credentials.
3. `skaffold dev`

### AWS (EKS)
1. Fill in `.env` with Postgres credentials, `TF_VAR_domain_name`, and `TF_VAR_app_hostname` (a domain you own, registered in Route53).
2. `./scripts/deploy-all.sh` — provisions the infra with Terraform, then builds/pushes images to ECR and deploys via Skaffold.
3. `./scripts/update-dns.sh` — points the domain at the frontend's load balancer once it's up.
4. Visit `https://<app_hostname>`.

To tear everything down: `./scripts/destroy-all.sh`.
