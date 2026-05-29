import { BadRequestException, ConflictException, Injectable, InternalServerErrorException, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { Prisma, User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import * as nodemailer from 'nodemailer';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { JwtPayload, TokenPair } from './types/auth.types';

const userSelect = {
  id: true,
  name: true,
  email: true,
  workspaceName: true,
  avatar: true,
  role: true,
  createdAt: true,
  updatedAt: true
} satisfies Prisma.UserSelect;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService
  ) {}

  async register(dto: RegisterDto) {
    const email = dto.email.trim().toLowerCase();

    if (dto.password !== dto.confirmPassword) {
      throw new BadRequestException('Passwords do not match.');
    }

    const existingUser = await this.prisma.user.findUnique({ where: { email } });

    if (existingUser) {
      throw new ConflictException('An account with this email already exists.');
    }

    const password = await bcrypt.hash(dto.password, this.passwordSaltRounds);
    const token = randomBytes(32).toString('hex');
    const tokenHash = this.hashVerificationToken(token);
    const expiresAt = new Date(Date.now() + this.emailVerificationTtlMs);

    await this.prisma.emailVerification.upsert({
      where: { email },
      create: {
        name: dto.name.trim(),
        email,
        workspaceName: dto.workspaceName.trim(),
        password,
        avatar: dto.avatar,
        tokenHash,
        expiresAt
      },
      update: {
        name: dto.name.trim(),
        workspaceName: dto.workspaceName.trim(),
        password,
        avatar: dto.avatar,
        tokenHash,
        expiresAt
      }
    });

    await this.sendVerificationEmail(email, token);

    return {
      message: 'Verification email sent. Please check your inbox to activate your account.'
    };
  }

  async verifyEmail(dto: VerifyEmailDto) {
    const tokenHash = this.hashVerificationToken(dto.token);
    const verification = await this.prisma.emailVerification.findUnique({ where: { tokenHash } });

    if (!verification) {
      throw new BadRequestException('Verification link is invalid. Please register again to receive a new link.');
    }

    if (verification.expiresAt.getTime() < Date.now()) {
      await this.prisma.emailVerification.delete({ where: { id: verification.id } });
      throw new BadRequestException('Verification link has expired. Please register again to receive a new link.');
    }

    const existingUser = await this.prisma.user.findUnique({ where: { email: verification.email } });

    if (existingUser) {
      await this.prisma.emailVerification.delete({ where: { id: verification.id } });
      throw new ConflictException('This email is already verified. Please sign in.');
    }

    await this.prisma.$transaction([
      this.prisma.user.create({
        data: {
          name: verification.name,
          email: verification.email,
          workspaceName: verification.workspaceName,
          password: verification.password,
          avatar: verification.avatar
        }
      }),
      this.prisma.emailVerification.delete({ where: { id: verification.id } })
    ]);

    return { message: 'Email verified successfully. You can now sign in.' };
  }

  async login(dto: LoginDto) {
    const email = dto.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    const passwordMatches = await bcrypt.compare(dto.password, user.password);

    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    const tokens = await this.createTokenPair(user);
    await this.storeRefreshTokenHash(user.id, tokens.refreshToken);

    return {
      user: this.sanitizeUser(user),
      ...tokens
    };
  }

  async refresh(userId: string, refreshToken: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user?.refreshTokenHash) {
      throw new UnauthorizedException('Refresh token is invalid.');
    }

    const tokenMatches = await bcrypt.compare(refreshToken, user.refreshTokenHash);

    if (!tokenMatches) {
      throw new UnauthorizedException('Refresh token is invalid.');
    }

    const tokens = await this.createTokenPair(user);
    await this.storeRefreshTokenHash(user.id, tokens.refreshToken);

    return {
      user: this.sanitizeUser(user),
      ...tokens
    };
  }

  async logout(userId: string) {
    await this.prisma.user.updateMany({
      where: { id: userId },
      data: { refreshTokenHash: null }
    });

    return { message: 'Signed out successfully.' };
  }

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: userSelect
    });

    if (!user) {
      throw new UnauthorizedException('User no longer exists.');
    }

    return { user };
  }

  verifyRefreshToken(refreshToken: string): JwtPayload {
    try {
      return this.jwtService.verify<JwtPayload>(refreshToken, {
        secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET')
      });
    } catch {
      throw new UnauthorizedException('Refresh token is invalid or expired.');
    }
  }

  verifyAccessToken(accessToken: string): JwtPayload {
    try {
      return this.jwtService.verify<JwtPayload>(accessToken, {
        secret: this.configService.getOrThrow<string>('JWT_ACCESS_SECRET')
      });
    } catch {
      throw new UnauthorizedException('Access token is invalid or expired.');
    }
  }

  private async createTokenPair(user: Pick<User, 'id' | 'email' | 'role'>): Promise<TokenPair> {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
        expiresIn: this.jwtExpiresIn('JWT_ACCESS_EXPIRES_IN', '15m')
      }),
      this.jwtService.signAsync(payload, {
        secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
        expiresIn: this.jwtExpiresIn('JWT_REFRESH_EXPIRES_IN', '7d')
      })
    ]);

    return { accessToken, refreshToken };
  }

  private async storeRefreshTokenHash(userId: string, refreshToken: string) {
    const refreshTokenHash = await bcrypt.hash(refreshToken, this.passwordSaltRounds);
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshTokenHash }
    });
  }

  private sanitizeUser(user: User) {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      workspaceName: user.workspaceName,
      avatar: user.avatar,
      role: user.role,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    };
  }

  private get passwordSaltRounds() {
    return Number(this.configService.get<string>('PASSWORD_SALT_ROUNDS', '12'));
  }

  private jwtExpiresIn(key: string, fallback: string): JwtSignOptions['expiresIn'] {
    return this.configService.get<string>(key, fallback) as JwtSignOptions['expiresIn'];
  }

  private hashVerificationToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private async sendVerificationEmail(email: string, token: string) {
    const user = this.configService.get<string>('GMAIL_USER');
    const pass = this.configService.get<string>('GMAIL_APP_PASSWORD');

    if (!user || !pass) {
      throw new InternalServerErrorException('Email delivery is not configured.');
    }

    const verificationUrl = `${this.frontendUrl}/?verifyToken=${encodeURIComponent(token)}`;
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user, pass }
    });

    try {
      await transporter.sendMail({
        from: `"PulseChat" <${user}>`,
        to: email,
        subject: 'Verify your PulseChat email',
        text: `Welcome to PulseChat. Verify your email by opening this link: ${verificationUrl}\n\nThis link expires in 24 hours.`,
        html: `
          <p>Welcome to PulseChat.</p>
          <p><a href="${verificationUrl}">Verify your email address</a> to activate your account.</p>
          <p>This link expires in 24 hours.</p>
        `
      });
    } catch (error) {
      this.logger.error('Failed to send verification email', error instanceof Error ? error.stack : undefined);
      throw new InternalServerErrorException('We could not send the verification email. Please try again.');
    }
  }

  private get frontendUrl() {
    const configuredUrl = this.configService.get<string>('FRONTEND_URL') || this.configService.get<string>('ALLOWED_ORIGIN')?.split(',')[0];
    return (configuredUrl || 'http://localhost:4173').replace(/\/$/, '');
  }

  private get emailVerificationTtlMs() {
    return Number(this.configService.get<string>('EMAIL_VERIFICATION_TTL_MS', String(24 * 60 * 60 * 1000)));
  }
}
