import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';
import { Request, Response } from 'express';
import { CurrentUser } from './decorators/current-user.decorator';
import { Roles } from './decorators/roles.decorator';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { AuthService } from './auth.service';
import { AuthenticatedUser } from './types/auth.types';

type AuthResponse = Awaited<ReturnType<AuthService['login']>>;

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService
  ) {}

  @Post('register')
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  async verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.authService.verifyEmail(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) response: Response) {
    const authResponse = await this.authService.login(dto);
    return this.sendAuthResponse(response, authResponse);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const refreshToken = request.cookies?.refresh_token;

    if (!refreshToken) {
      response.clearCookie('refresh_token', this.cookieOptions);
      throw new UnauthorizedException('Refresh token is missing.');
    }

    const payload = this.authService.verifyRefreshToken(refreshToken);
    const authResponse = await this.authService.refresh(payload.sub, refreshToken);
    return this.sendAuthResponse(response, authResponse);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async logout(@CurrentUser() user: AuthenticatedUser, @Res({ passthrough: true }) response: Response) {
    response.clearCookie('refresh_token', this.cookieOptions);
    return this.authService.logout(user.sub);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  getProfile(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.getProfile(user.sub);
  }

  @Get('admin/check')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  adminCheck(@CurrentUser() user: AuthenticatedUser) {
    return { message: 'Admin token is valid.', user };
  }

  private sendAuthResponse(response: Response, authResponse: AuthResponse) {
    const { refreshToken, ...body } = authResponse;
    response.cookie('refresh_token', refreshToken, this.cookieOptions);
    return body;
  }

  private get cookieOptions() {
    const isProduction = this.configService.get<string>('NODE_ENV') === 'production';

    return {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? ('none' as const) : ('lax' as const),
      path: '/auth',
      maxAge: this.refreshCookieMaxAge
    };
  }

  private get refreshCookieMaxAge() {
    return Number(this.configService.get<string>('REFRESH_COOKIE_MAX_AGE_MS', String(7 * 24 * 60 * 60 * 1000)));
  }
}
