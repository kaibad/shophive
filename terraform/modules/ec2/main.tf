resource "aws_instance" "app" {
  ami           = var.ami_id
  instance_type = var.instance_type
  subnet_id     = var.subnet_id
  vpc_security_group_ids = [
    var.security_group_id
  ]
  key_name                    = var.key_name
  iam_instance_profile        = var.iam_instance_profile
  associate_public_ip_address = true
  user_data = replace(file("${path.module}/../../../scripts/dev/dev-install.sh"), "$${", "$$${")

  root_block_device {
    volume_size = 20
    volume_type = "gp3"
  }
  tags = {
    Name        = "${var.project_name}-${var.environment}-server"
    Environment = var.environment
  }

}