resource "aws_security_group" "ec2" {
  name        = "${var.project_name}-${var.environment}-sg"
  description = "Security group for ${var.environment} EC2"
  vpc_id      = var.vpc_id

  ingress {
    description = "SSH access"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [
      var.allowed_ip
    ]
  }

  ingress {
    description = "HTTP access"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = [
      "0.0.0.0/0"
    ]
  }

  ingress {
    description = "HTTPS access"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = [
      "0.0.0.0/0"
    ]
  }



  # Create an application port ingress only when it doesn't duplicate the HTTP rule (port 80).
  dynamic "ingress" {
    for_each = var.app_port == 80 ? [] : [var.app_port]
    content {
      description = "Application port"
      from_port   = ingress.value
      to_port     = ingress.value
      protocol     = "tcp"
      cidr_blocks = ["0.0.0.0/0"]
    }
  }

  egress {


    description = "Allow all outbound"


    from_port = 0


    to_port = 0


    protocol = "-1"


    cidr_blocks = [
      "0.0.0.0/0"
    ]

  }



  tags = {


    Name = "${var.project_name}-${var.environment}-security-group"


    Environment = var.environment

  }

}