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
output "oidc_provider_arn" {
  value = aws_iam_openid_connect_provider.eks.arn
}
output "oidc_provider_url" {
  description = "Issuer URL without the https:// prefix, as required in IAM trust policy condition keys"
  value       = replace(aws_iam_openid_connect_provider.eks.url, "https://", "")
}