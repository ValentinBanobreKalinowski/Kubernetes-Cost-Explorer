<div align="center">

# Kubernetes Cluster Metrics && Cost Explorer

---

![AWS](https://img.shields.io/badge/AWS-%23FF9900.svg?style=for-the-badge&logo=amazon-aws&logoColor=white)
![Kubernetes](https://img.shields.io/badge/kubernetes-%23326CE5.svg?style=for-the-badge&logo=kubernetes&logoColor=white)
![Terraform](https://img.shields.io/badge/terraform-%235835CC.svg?style=for-the-badge&logo=terraform&logoColor=white)
![Docker](https://img.shields.io/badge/docker-%230db7ed.svg?style=for-the-badge&logo=docker&logoColor=white)
![GitHub Actions](https://img.shields.io/badge/github%20actions-%232088FF.svg?style=for-the-badge&logo=githubactions&logoColor=white)

---

</div>

## Architecture

![Infrastructure diagram](docs/infrastructure.svg)

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

- Implement the basics of the application on a local cluter with k3d. DONE
- Move the cluster to AWS, declare the infrastructure in code with Terraform. <- Here now
- Implement last functionalities, connect prometheus and graphana as well as github actions.


---

Project began 01/07/2026 — approximate time for MVP: ~1 month.

**@Valentin Banobre Kalinowski**
