output "cluster_name" {
  value = aws_eks_cluster.this.name
}
output "cluster_endpoint" {
  value = aws_eks_cluster.this.endpoint
}
output "cluster_ca_certificate" {
  value = aws_eks_cluster.this.certificate_authority[0].data
}
output "cluster_security_group_id" {
  description = "EKS-managed security group attached to node ENIs - used to scope access to RDS etc."
  value       = aws_eks_cluster.this.vpc_config[0].cluster_security_group_id
}