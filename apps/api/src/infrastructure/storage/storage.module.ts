import { S3Client } from '@aws-sdk/client-s3';
import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

export const S3_CLIENT = 'S3_CLIENT';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: S3_CLIENT,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) =>
        new S3Client({
          endpoint: configService.get<string>('S3_ENDPOINT'),
          region: configService.get<string>('S3_REGION', 'us-east-1'),
          credentials: {
            accessKeyId: configService.get<string>('S3_ACCESS_KEY', ''),
            secretAccessKey: configService.get<string>('S3_SECRET_KEY', ''),
          },
          forcePathStyle: true, // required for MinIO / localstack
        }),
    },
  ],
  exports: [S3_CLIENT],
})
export class StorageModule {}
