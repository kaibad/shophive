variable "project_name" {
  description = "Project name"
  type        = string
}


variable "environment" {
  description = "Environment name"
  type        = string
}


variable "vpc_id" {
  description = "VPC ID"
  type        = string
}


variable "allowed_ip" {
  description = "Allowed IP for SSH"
  type        = string
}


variable "app_port" {
  description = "Application port"
  type        = number
}