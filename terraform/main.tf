module "vpc" {
  source       = "./modules/vpc"
  project_name = var.project_name
  environment  = var.environment
  cidr_block   = var.vpc_cidr

}


module "security_group" {
  source       = "./modules/security_group"
  project_name = var.project_name
  environment  = var.environment
  vpc_id       = module.vpc.vpc_id
  allowed_ip   = var.allowed_ip
  app_port     = var.app_port

}


module "iam" {
  source       = "./modules/iam"
  project_name = var.project_name

}


module "ecr" {
  source       = "./modules/ecr"
  count        = var.environment == "prod" ? 1 : 0
  project_name = var.project_name
  environment  = var.environment
}



module "ec2_dev" {
  source = "./modules/ec2"

  project_name = var.project_name
  environment  = "dev"

  subnet_id            = module.vpc.public_subnet_id
  security_group_id    = module.security_group.security_group_id
  iam_instance_profile = module.iam.instance_profile_name
  ami_id               = var.ami_id
  instance_type        = var.instance_type
  key_name             = var.key_name
}

module "ec2_staging" {
  source = "./modules/ec2"

  project_name = var.project_name
  environment  = "staging"

  subnet_id            = module.vpc.public_subnet_id
  security_group_id    = module.security_group.security_group_id
  iam_instance_profile = module.iam.instance_profile_name
  ami_id               = var.ami_id
  instance_type        = var.instance_type
  key_name             = var.key_name
}