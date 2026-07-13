output "vpc_id" {
  value = module.vpc.vpc_id
}

output "public_subnet_ids" {
  value = module.vpc.public_subnet_ids
}

output "eks_cluster_name" {
  value = module.eks.cluster_name
}
output "ecr_backend_url" {
  value = aws_ecr_repository.backend.repository_url
}
output "ecr_frontend_url" {
  value = aws_ecr_repository.frontend.repository_url
}
