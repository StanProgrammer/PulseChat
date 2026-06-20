import { BadRequestException, ForbiddenException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';
import { extname } from 'node:path';
import { PrismaService } from '../prisma/prisma.service';

const IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp'
];

const DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv'
];

export const ALLOWED_MIME_TYPES = [...IMAGE_MIME_TYPES, ...DOCUMENT_MIME_TYPES];
export const MAX_FILE_SIZE = 20 * 1024 * 1024;

type CloudinaryResourceType = 'image' | 'raw';

@Injectable()
export class FilesService {
  constructor(private readonly prisma: PrismaService) {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
      secure: true
    });
  }

  validateFile(mimeType: string, size: number, originalName: string) {
    if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
      const ext = extname(originalName).toLowerCase().slice(1);
      throw new BadRequestException(
        `File type "${mimeType || ext}" is not allowed. Upload an image, PDF, Office document, text file, or CSV.`
      );
    }

    if (size > MAX_FILE_SIZE) {
      const maxMb = MAX_FILE_SIZE / 1024 / 1024;
      throw new BadRequestException(
        `File is too large (${(size / 1024 / 1024).toFixed(1)} MB). Maximum size is ${maxMb} MB.`
      );
    }
  }

  async uploadFile(
    buffer: Buffer,
    originalName: string,
    mimeType: string,
    size: number,
    uploaderId: string
  ) {
    this.validateFile(mimeType, size, originalName);

    const uploadResult = await this.uploadToCloudinary(buffer, {
      originalName,
      mimeType,
      uploaderId
    });

    return this.prisma.attachment.create({
      data: {
        uploaderId,
        fileName: uploadResult.original_filename || originalName,
        originalName,
        mimeType,
        size,
        url: uploadResult.secure_url,
        publicId: uploadResult.public_id,
        resourceType: uploadResult.resource_type,
        fileType: this.getFileType(mimeType)
      }
    });
  }

  async getAttachment(id: string) {
    const attachment = await this.prisma.attachment.findUnique({
      where: { id }
    });

    if (!attachment) {
      throw new NotFoundException('Attachment could not be found.');
    }

    return attachment;
  }

  async getAttachmentForUser(userId: string, id: string) {
    const attachment = await this.prisma.attachment.findUnique({
      where: { id },
      include: {
        message: {
          select: {
            conversationId: true
          }
        }
      }
    });

    if (!attachment) {
      throw new NotFoundException('Attachment could not be found.');
    }

    if (!attachment.messageId) {
      if (attachment.uploaderId !== userId) {
        throw new ForbiddenException('You do not have access to this attachment.');
      }

      return attachment;
    }

    const membership = await this.prisma.conversationMember.findUnique({
      where: {
        conversationId_userId: {
          conversationId: attachment.message!.conversationId,
          userId
        }
      }
    });

    if (!membership) {
      throw new ForbiddenException('You do not have access to this attachment.');
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

    try {
      await cloudinary.uploader.destroy(attachment.publicId, {
        resource_type: attachment.resourceType as CloudinaryResourceType
      });
    } catch {
      // Cloudinary may have already removed the asset. Keep DB cleanup idempotent.
    }

    await this.prisma.attachment.delete({ where: { id } });
  }

  private uploadToCloudinary(
    buffer: Buffer,
    options: { originalName: string; mimeType: string; uploaderId: string }
  ) {
    this.ensureCloudinaryConfigured();

    const resourceType = this.getResourceType(options.mimeType);
    const folder = process.env.CLOUDINARY_UPLOAD_FOLDER || 'chat-app/attachments';

    return new Promise<UploadApiResponse>((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder,
          resource_type: resourceType,
          use_filename: false,
          unique_filename: true,
          overwrite: false,
          context: {
            originalName: options.originalName,
            uploaderId: options.uploaderId
          }
        },
        (error, result) => {
          if (error || !result) {
            reject(new InternalServerErrorException('Upload failed. Please try again.'));
            return;
          }

          resolve(result);
        }
      );

      uploadStream.end(buffer);
    });
  }

  private ensureCloudinaryConfigured() {
    if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
      throw new InternalServerErrorException('File uploads are not configured.');
    }
  }

  private getResourceType(mimeType: string): CloudinaryResourceType {
    return mimeType.startsWith('image/') ? 'image' : 'raw';
  }

  private getFileType(mimeType: string) {
    return mimeType.startsWith('image/') ? 'image' : 'document';
  }
}
