/**
 * Storage service — handles uploading rendered MP4s to AWS S3
 * and generating pre-signed download URLs.
 */

import fs from 'fs';
import path from 'path';
import {
  S3Client,
  PutObjectCommand,
  type PutObjectCommandInput,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Pre-signed URL validity in seconds (1 hour) */
const PRESIGNED_URL_EXPIRY_SECONDS = 3_600;

/** S3 key prefix for all rendered animations */
const S3_KEY_PREFIX = 'animations';

// ---------------------------------------------------------------------------
// StorageService
// ---------------------------------------------------------------------------

export class StorageService {
  private readonly s3: S3Client;

  constructor() {
    this.s3 = new S3Client({
      region: env.AWS_REGION,
      credentials: {
        accessKeyId: env.AWS_ACCESS_KEY_ID,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
      },
    });
  }

  /**
   * Uploads a rendered MP4 file to S3 and returns a pre-signed download URL.
   *
   * The S3 object key is: animations/{jobId}/output.mp4
   *
   * @param jobId     - Unique job identifier used to namespace the S3 key.
   * @param localPath - Absolute path to the rendered MP4 file on disk.
   * @returns Pre-signed GET URL valid for {@link PRESIGNED_URL_EXPIRY_SECONDS} seconds.
   * @throws If the upload or pre-sign operation fails.
   */
  async uploadAndSign(jobId: string, localPath: string): Promise<string> {
    const s3Key = `${S3_KEY_PREFIX}/${jobId}/output.mp4`;

    logger.info({ msg: 'Uploading MP4 to S3', jobId, s3Key, localPath });

    // Upload
    const fileStream = fs.createReadStream(localPath);
    const fileSize = fs.statSync(localPath).size;

    const putParams: PutObjectCommandInput = {
      Bucket: env.AWS_S3_BUCKET,
      Key: s3Key,
      Body: fileStream,
      ContentType: 'video/mp4',
      ContentLength: fileSize,
    };

    try {
      await this.s3.send(new PutObjectCommand(putParams));
      logger.info({ msg: 'S3 upload complete', jobId, s3Key });
    } catch (err) {
      logger.error({ msg: 'S3 upload failed', jobId, s3Key, error: (err as Error).message });
      throw new Error(`S3 upload failed: ${(err as Error).message}`);
    }

    // Generate pre-signed GET URL
    const getCommand = new GetObjectCommand({
      Bucket: env.AWS_S3_BUCKET,
      Key: s3Key,
    });

    let signedUrl: string;
    try {
      signedUrl = await getSignedUrl(this.s3, getCommand, {
        expiresIn: PRESIGNED_URL_EXPIRY_SECONDS,
      });
      logger.info({ msg: 'Generated pre-signed URL', jobId, expiresIn: PRESIGNED_URL_EXPIRY_SECONDS });
    } catch (err) {
      logger.error({ msg: 'Pre-signing failed', jobId, error: (err as Error).message });
      throw new Error(`Failed to generate pre-signed URL: ${(err as Error).message}`);
    }

    return signedUrl;
  }

  /**
   * Deletes the local temp directory for a job after it has been uploaded to S3.
   *
   * @param jobId   - Job identifier.
   * @param tempDir - Base temp directory from env.
   */
  cleanupLocalFiles(jobId: string, tempDir: string): void {
    const jobDir = path.join(tempDir, jobId);
    try {
      fs.rmSync(jobDir, { recursive: true, force: true });
      logger.info({ msg: 'Deleted local temp files', jobDir });
    } catch (err) {
      logger.warn({ msg: 'Could not delete local temp files', jobDir, error: (err as Error).message });
    }
  }
}

export const storageService = new StorageService();
