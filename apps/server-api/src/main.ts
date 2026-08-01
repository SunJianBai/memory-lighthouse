import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureHttpApplication } from './bootstrap/configure-http-application';

async function bootstrap() {
  // LiveKit signs the exact request bytes. Nest keeps those bytes alongside
  // the parsed JSON body only when rawBody support is enabled at bootstrap.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const config = app.get(ConfigService);

  configureHttpApplication(app, config);
  app.enableShutdownHooks();

  await app.listen(
    config.getOrThrow<number>('PORT'),
    config.getOrThrow<string>('HOST'),
  );
}

void bootstrap();
