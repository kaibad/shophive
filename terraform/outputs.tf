output "ec2_dev_public_ip" {
  description = "Dev EC2 Public IP"
  value       = try(module.ec2_dev[0].public_ip, "")
}

output "ec2_dev_instance_id" {
  description = "Dev EC2 Instance ID"
  value       = try(module.ec2_dev[0].instance_id, "")
}

output "ec2_staging_public_ip" {
  description = "Staging EC2 Public IP"
  value       = try(module.ec2_staging[0].public_ip, "")
}

output "ec2_staging_instance_id" {
  description = "Staging EC2 Instance ID"
  value       = try(module.ec2_staging[0].instance_id, "")
}

output "ecr_repository_url" {
  description = "Docker image repository (empty when not created)"
  value       = try(module.ecr[0].repository_url, "")
}

output "vpc_id" {
  value = module.vpc.vpc_id
}