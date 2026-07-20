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

## Architecture
![Infrastructure diagram](docs/infrastructure.svg)
![Cluster diagram](docs/cluster.svg)
