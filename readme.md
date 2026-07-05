# Kubernetes Cluster Cost Explorer

**Kubernetes cluster hosted on AWS EKS, with infrastructure provided as code (Terraform).**

## Planned Metrics

The application will monitor cluster metrics such as:

- Number of pods
- CPU usage
- Memory usage
- Requests
- Approximate cluster costs
- Costs per namespace, for example
- Number of pods per worker node
- Current number of worker nodes
- Availability zones in which the nodes are currently deployed

## Roadmap

- Implement the basics of the application on a local cluter with k3d. <- Here now
- Move the cluster to AWS, declare the infrastructure in code with Terraform.
- Implement last functionalities, connect prometheus and graphana as well as github actions.


---

Project began 01/07/2026 — approximate time for MVP: ~1 month.

**@Valentin Banobre Kalinowski**
