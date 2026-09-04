# ==============================================================================
# Provider configuration
# ==============================================================================
provider "aws" {
  region = var.region

  default_tags {
    tags = var.tags
  }
}

# Random master DB password - generated at apply time, stored only in state.
# Never committed to source or tfvars. Injected into RDS and used to compose the
# DATABASE_URL stored in Secrets Manager.
resource "random_password" "db_master_password" {
  length  = 32
  special = false
}

# ==============================================================================
# Module wiring
# ==============================================================================

module "networking" {
  source               = "./modules/networking"
  environment          = var.environment
  vpc_cidr             = var.vpc_cidr
  availability_zones   = var.availability_zones
  public_subnet_cidrs  = var.public_subnet_cidrs
  private_subnet_cidrs = var.private_subnet_cidrs
  tags                 = var.tags
}

module "security" {
  source      = "./modules/security"
  environment = var.environment
  vpc_id      = module.networking.vpc_id
  tags        = var.tags
}

module "cloudwatch" {
  source      = "./modules/cloudwatch"
  environment = var.environment
  tags        = var.tags
}

module "ecr" {
  source      = "./modules/ecr"
  environment = var.environment
  tags        = var.tags
}

module "rds" {
  source             = "./modules/rds"
  environment        = var.environment
  vpc_id             = module.networking.vpc_id
  private_subnet_ids = module.networking.private_subnet_ids
  db_security_group  = module.security.rds_security_group_id
  db_name            = var.db_name
  db_username        = var.db_username
  db_password        = random_password.db_master_password.result
  tags               = var.tags
}

module "redis" {
  source               = "./modules/redis"
  environment          = var.environment
  private_subnet_ids   = module.networking.private_subnet_ids
  redis_security_group = module.security.redis_security_group_id
  tags                 = var.tags
}

module "secrets" {
  source         = "./modules/secrets"
  environment    = var.environment
  db_username    = var.db_username
  db_password    = random_password.db_master_password.result
  db_endpoint    = module.rds.endpoint
  db_port        = module.rds.port
  db_name        = var.db_name
  redis_endpoint = module.redis.endpoint
  redis_port     = module.redis.port
  tags           = var.tags
}

module "alb" {
  source                = "./modules/alb"
  environment           = var.environment
  vpc_id                = module.networking.vpc_id
  public_subnet_ids     = module.networking.public_subnet_ids
  alb_security_group_id = module.security.alb_security_group_id
  api_security_group_id = module.security.ecs_api_security_group_id
  web_security_group_id = module.security.ecs_web_security_group_id
  tags                  = var.tags
}

module "ecs" {
  source                      = "./modules/ecs"
  environment                 = var.environment
  region                      = var.region
  vpc_id                      = module.networking.vpc_id
  private_subnet_ids          = module.networking.private_subnet_ids
  api_security_group_id       = module.security.ecs_api_security_group_id
  web_security_group_id       = module.security.ecs_web_security_group_id
  ecs_task_execution_role_arn = module.iam.ecs_task_execution_role_arn
  ecs_task_role_arn           = module.iam.ecs_task_role_arn
  api_repository_url          = module.ecr.api_repository_url
  web_repository_url          = module.ecr.web_repository_url
  api_log_group               = module.cloudwatch.api_log_group_name
  web_log_group               = module.cloudwatch.web_log_group_name
  alb_listener_arn            = module.alb.listener_arn
  api_target_group_arn        = module.alb.api_target_group_arn
  web_target_group_arn        = module.alb.web_target_group_arn
  alb_dns_name                = module.alb.alb_dns_name
  jwt_access_secret_arn       = module.secrets.jwt_access_secret_arn
  jwt_refresh_secret_arn      = module.secrets.jwt_refresh_secret_arn
  database_url_secret_arn     = module.secrets.database_url_secret_arn
  redis_url_secret_arn        = module.secrets.redis_url_secret_arn
  tags                        = var.tags
}

module "iam" {
  source      = "./modules/iam"
  environment = var.environment
  secret_arns = [
    module.secrets.jwt_access_secret_arn,
    module.secrets.jwt_refresh_secret_arn,
    module.secrets.database_url_secret_arn,
    module.secrets.redis_url_secret_arn,
  ]
  tags = var.tags
}
