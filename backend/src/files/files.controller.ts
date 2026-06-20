import {
  Controller,
  FileTypeValidator,
  Get,
  MaxFileSizeValidator,
  Param,
  ParseFilePipe,
  Post,
  Redirect,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/types/auth.types';
import { ALLOWED_MIME_TYPES, FilesService, MAX_FILE_SIZE } from './files.service';

interface UploadedFileData {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

const allowedMimeTypePattern = new RegExp(
  `^(${ALLOWED_MIME_TYPES.map((type) => type.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})$`
);

@Controller('files')
@UseGuards(JwtAuthGuard)
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_FILE_SIZE }
    })
  )
  async uploadFile(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: MAX_FILE_SIZE }),
          new FileTypeValidator({ fileType: allowedMimeTypePattern })
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
      user.sub
    );

    return { attachment };
  }

  @Get(':id/download')
  @Redirect()
  async downloadFile(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response
  ) {
    const attachment = await this.filesService.getAttachmentForUser(user.sub, id);

    response.setHeader('Content-Type', attachment.mimeType);
    response.setHeader('Content-Disposition', `attachment; filename="${attachment.originalName}"`);

    return { url: attachment.url };
  }
}
