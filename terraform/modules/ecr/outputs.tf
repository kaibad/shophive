output "repository_url" {
  description = "ECR Repository URL"
  value       = aws_ecr_repository.app.repository_url
}

output "repository_name" {
  description = "ECR Repository Name"
  value       = aws_ecr_repository.app.name
}