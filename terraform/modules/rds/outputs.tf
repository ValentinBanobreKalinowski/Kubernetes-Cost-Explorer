output "endpoint" {
  description = "Postgres host:port"
  value       = aws_db_instance.this.endpoint
}

output "address" {
  description = "Postgres host only (no port) - what apps should set as POSTGRES_HOST"
  value       = aws_db_instance.this.address
}

output "port" {
  value = aws_db_instance.this.port
}

output "security_group_id" {
  value = aws_security_group.this.id
}
