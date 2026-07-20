import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { AppModule } from "./app.module";
import { JsonLogger } from "./common/logging/json-logger.service";

async function bootstrap() {
  const useJsonLogs = process.env.NODE_ENV === "production";
  const app = await NestFactory.create(AppModule, { rawBody: true, logger: useJsonLogs ? new JsonLogger() : undefined });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  const port = process.env.PORT ? Number(process.env.PORT) : 3001;
  await app.listen(port, "0.0.0.0");
}

bootstrap();
