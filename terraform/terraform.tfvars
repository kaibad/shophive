# terraform.tfvars — example values for local development
# Update these placeholders before running terraform apply in a real environment.

aws_region = "ap-south-1"
environment = "shared"
project_name = "shophive"
vpc_cidr = "10.0.0.0/16"
instance_type = "t3.micro"
ami_id = "ami-0b40571b9c2387b15"     
key_name = "mumbai.pem"
allowed_ip = "0.0.0.0/0"     
app_port = 80
