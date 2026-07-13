variable "aws_region" {
  description = "AWS region"
  type        = string
}


variable "environment" {
  description = "Environment name"
  type        = string
}


variable "project_name" {
  description = "Project name"
  type        = string
}


variable "vpc_cidr" {
  description = "VPC CIDR block"
  type        = string
}


variable "instance_type" {
  description = "EC2 instance type"
  type        = string
}


variable "ami_id" {
  description = "EC2 AMI ID"
  type        = string
}


variable "key_name" {
  description = "EC2 SSH key pair"
  type        = string
}


variable "allowed_ip" {
  description = "Allowed SSH IP"
  type        = string
}


variable "app_port" {
  description = "Application port"
  type        = number
  default     = 80
}