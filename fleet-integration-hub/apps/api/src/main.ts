import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const port = parseInt(process.env.FIH_PORT ?? '8090', 10);
  await app.listen(port);
  new Logger('FIH').log(`Fleet Integration Hub escuchando en :${port}`);
}

bootstrap();
