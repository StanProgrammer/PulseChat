import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import * as cookieParser from 'cookie-parser';
import * as express from 'express';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { AppModule } from './app.module';

async function bootstrap() {
  const allowedOrigins = process.env.ALLOWED_ORIGIN?.split(',').map((origin) => origin.trim()) || ['http://localhost:4173'];
  const app = await NestFactory.create(AppModule, {
    cors: {
      origin: allowedOrigins,
      credentials: true
    }
  });

  // Ensure uploads directory exists
  const uploadsDir = join(__dirname, '..', 'uploads');
  if (!existsSync(uploadsDir)) {
    mkdirSync(uploadsDir, { recursive: true });
  }

  // Serve uploaded files statically
  app.use('/uploads', express.static(uploadsDir));

  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true
    })
  );

  const port = Number(process.env.PORT) || 4000;
  await app.listen(port);
  console.log(`Backend running on http://localhost:${port}`);
}

bootstrap();
