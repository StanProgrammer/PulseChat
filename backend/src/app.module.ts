import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { FilesModule } from './files/files.module';
import { MessagingModule } from './messaging/messaging.module';
import { PrismaModule } from './prisma/prisma.module';
import { SocketGateway } from './socket/socket.gateway';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true
    }),
    PrismaModule,
    AuthModule,
    FilesModule,
    MessagingModule
  ],
  controllers: [AppController],
  providers: [AppService, SocketGateway]
})
export class AppModule {}
