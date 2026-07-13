variable "name" {
    type        = string
}

variable "vpc_id" {
    type        = string
}

variable "subnet_ids" {
    type        = list(string)
}

variable "cluster_version" {
    type = string
    default = "1.35"
}

variable "node_instance_type" {
    type = string
    default = "t3.medium"
}

variable "node_desired_size" {
    type = number
    default   = 1

}

variable "node_min_size" {
  type    = number
  default = 1
}
variable "node_max_size" {
  type    = number
  default = 2
}

