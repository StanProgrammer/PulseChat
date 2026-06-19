import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { PrismaService } from '../prisma/prisma.service';

const ALLOWED_MIME_TYPES = [
  // Images
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  // Documents
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
  // Archives
  'application/zip',
  'application/x-rar-compressed',
  'application/x-7z-compressed',
  'application/x-tar',
  'application/gzip',
  // Code / data
  'application/json',
  'application/xml',
  'text/xml',
  'text/yaml',
  'application/x-yaml'
];

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB
const UPLOADS_DIR = join(__dirname, '..', '..', 'uploads');

@Injectable()
export class FilesService {
  constructor(private readonly prisma: PrismaService) {
    if (!existsSync(UPLOADS_DIR)) {
      mkdirSync(UPLOADS_DIR, { recursive: true });
    }
  }

  validateFile(mimeType: string, size: number, originalName: string) {
    if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
      const ext = extname(originalName).toLowerCase().slice(1);
      const allowedTypes = ALLOWED_MIME_TYPES.map((t) => t.split('/')[1]).join(', ');
      throw new BadRequestException(
        `File type "${mimeType || ext}" is not allowed. Allowed types: ${allowedTypes}`
      );
    }

    if (size > MAX_FILE_SIZE) {
      const maxMb = MAX_FILE_SIZE / 1024 / 1024;
      throw new BadRequestException(
        `File is too large (${(size / 1024 / 1024).toFixed(1)} MB). Maximum size is ${maxMb} MB.`
      );
    }
  }

  generateFileName(originalName: string, mimeType: string) {
    const ext = extname(originalName) || '.' + mimeType.split('/')[1] || '';
    return `${randomUUID()}${ext}`;
  }

  storeFile(buffer: Buffer, fileName: string): string {
    const filePath = join(UPLOADS_DIR, fileName);
    writeFileSync(filePath, buffer);
    return `/uploads/${fileName}`;
  }

  async uploadFile(
    buffer: Buffer,
    originalName: string,
    mimeType: string,
    size: number,
    messageId: string
  ) {
    // Defense-in-depth: validate again even though ParseFilePipe already checks
    this.validateFile(mimeType, size, originalName);

    const fileName = this.generateFileName(originalName, mimeType);
    const url = this.storeFile(buffer, fileName);

    const attachment = await this.prisma.attachment.create({
      data: {
        messageId,
        fileName,
        originalName,
        mimeType,
        size,
        url
      }
    });

    return attachment;
  }

  async getAttachment(id: string) {
    const attachment = await this.prisma.attachment.findUnique({
      where: { id }
    });

    if (!attachment) {
      throw new BadRequestException('Attachment could not be found.');
    }

    return attachment;
  }

  async getAttachmentsByMessage(messageId: string) {
    return this.prisma.attachment.findMany({
      where: { messageId },
      orderBy: { createdAt: 'asc' }
    });
  }

  async deleteAttachment(id: string) {
    const attachment = await this.getAttachment(id);
    const filePath = join(UPLOADS_DIR, attachment.fileName);

    try {
      if (existsSync(filePath)) {
        unlinkSync(filePath);
      }
    } catch {
      // File may already be deleted — proceed with DB cleanup
    }

    await this.prisma.attachment.delete({ where: { id } });
  }

  getUploadsDir() {
    return UPLOADS_DIR;
  }
}
