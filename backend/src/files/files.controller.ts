import {
  Controller,
  FileTypeValidator,
  Get,
  MaxFileSizeValidator,
  Param,
  ParseFilePipe,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors
} from '@nestjs/common';

interface UploadedFileData {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { createReadStream, existsSync } from 'node:fs';
import { join } from 'node:path';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/types/auth.types';
import { FilesService } from './files.service';

@Controller('files')
@UseGuards(JwtAuthGuard)
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 20 * 1024 * 1024 }
    })
  )
  async uploadFile(
    @CurrentUser() _user: AuthenticatedUser,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 20 * 1024 * 1024 }),
          new FileTypeValidator({
            fileType:
              /^(image\/(jpeg|png|gif|webp|svg\+xml)|application\/(pdf|msword|vnd\.openxmlformats-officedocument\.wordprocessingml\.document|vnd\.ms-excel|vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet|vnd\.ms-powerpoint|vnd\.openxmlformats-officedocument\.presentationml\.presentation|zip|x-rar-compressed|x-7z-compressed|x-tar|gzip|json|xml)|text\/(plain|csv|xml|yaml))$/
          })
        ]
      })
    )
    file: UploadedFileData
  ) {
    const attachment = await this.filesService.uploadFile(
      file.buffer,
      file.originalname,
      file.mimetype,
      file.size,
      '' // Temporary — will be linked when message is sent
    );

    return { attachment };
  }

  @Get(':id/download')
  async downloadFile(
    @Param('id') id: string,
    @Res() response: Response
  ) {
    const attachment = await this.filesService.getAttachment(id);
    const filePath = join(this.filesService.getUploadsDir(), attachment.fileName);

    if (!existsSync(filePath)) {
      response.status(404).json({ message: 'File could not be found on the server.' });
      return;
    }

    response.setHeader('Content-Type', attachment.mimeType);
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${attachment.originalName}"`
    );

    const stream = createReadStream(filePath);
    stream.pipe(response);
  }
}
