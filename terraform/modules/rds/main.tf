
resource "aws_db_subnet_group" "this" {
  name       = "${var.name}-db-subnet-group"
  subnet_ids = var.subnet_ids

  tags = {
    Name = "${var.name}-db-subnet-group"
  }
}

// Create a security group for the RDS instance to allow access from the EKS nodes
// This is necessary because the EKS nodes and RDS instance are in different security groups, and we need to allow traffic from the EKS nodes to the RDS instance on port 5432 (Postgres)
resource "aws_security_group" "this" {
  name        = "${var.name}-rds-sg"
  description = "Allow Postgres access from the EKS nodes"
  vpc_id      = var.vpc_id

  // Allow access from the EKS nodes to the RDS instance on port 5432 (Postgres)
  ingress {
    description     = "Postgres from EKS nodes"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = var.allowed_security_group_ids
  }
  // Allow all outbound traffic from the RDS instance (default behavior)
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.name}-rds-sg"
  }
}
// Create the RDS instance with the specified parameters, using the subnet group and security group created above. The RDS instance will be a Postgres database with the specified engine version, instance class, allocated storage, and credentials. It will not be publicly accessible and will not have multi-AZ deployment or backups enabled for now.
resource "aws_db_instance" "this" {
  identifier     = "${var.name}-db"
  engine         = "postgres"
  engine_version = var.engine_version

  instance_class    = var.instance_class
  allocated_storage = var.allocated_storage
  storage_type      = "gp3"

  db_name  = var.db_name
  username = var.username
  password = var.password
  port     = 5432

  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [aws_security_group.this.id]
  publicly_accessible    = false
  multi_az               = false

  # Not backing up for now.
  backup_retention_period = 0
  skip_final_snapshot     = true
  deletion_protection     = false
  storage_encrypted       = true
}
