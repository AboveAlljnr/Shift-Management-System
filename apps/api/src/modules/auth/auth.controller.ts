import { Controller, Post, Body, HttpCode, HttpStatus, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import {
  LoginSchema,
  RefreshTokenSchema,
  RegisterCompanySchema,
} from '@sms/shared';
import type { LoginDto, RefreshTokenDto, RegisterCompanyDto } from '@sms/shared';

import { Public } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';

import { AuthService } from './auth.service';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  @ApiOperation({ summary: 'Register a new company and owner account' })
  register(@Body(new ZodValidationPipe(RegisterCompanySchema)) dto: RegisterCompanyDto) {
    return this.authService.register(dto);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with email/password' })
  login(@Body(new ZodValidationPipe(LoginSchema)) dto: LoginDto, @Query('companySlug') companySlug?: string) {
    return this.authService.login(dto, companySlug || dto.companySlug);
  }

  @Public()
  @Post(':companySlug/login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with email/password for a specific company' })
  loginWithCompany(@Param('companySlug') companySlug: string, @Body(new ZodValidationPipe(LoginSchema)) dto: LoginDto) {
    return this.authService.login(dto, companySlug);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate refresh token and get new access token' })
  refresh(@Body(new ZodValidationPipe(RefreshTokenSchema)) dto: RefreshTokenDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke refresh token' })
  logout(@Body(new ZodValidationPipe(RefreshTokenSchema)) dto: RefreshTokenDto) {
    return this.authService.logout(dto.refreshToken);
  }
}
