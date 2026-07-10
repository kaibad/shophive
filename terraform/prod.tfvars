# prod.tfvars — production environment values (update before applying)
# WARNING: Replace placeholders (ami_id, allowed_ip, key_name) with real values.

aws_region   = "ap-south-1"
environment  = "prod"
project_name = "shophive"

# Production VPC CIDR (change if you have an account-wide plan)
vpc_cidr     = "10.30.0.0/16"

# EC2
instance_type = "t3.medium"
ami_id        = "ami-0123456789abcdef0"  # replace with a real prod AMI
key_name      = "mumbai"                  # replace with the production key pair name

# Networking
allowed_ip = "203.0.113.0/32"             # placeholder — restrict to admin IP/CIDR
app_port   = 80
