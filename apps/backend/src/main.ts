import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { PrismaService } from './prisma.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Auto-migrate: add sol_neo / sol_mp columns if not present
  try {
    const prisma = app.get(PrismaService);
    await prisma.$executeRawUnsafe(
      `ALTER TABLE codes ADD COLUMN IF NOT EXISTS sol_neo TEXT;`,
    );
    await prisma.$executeRawUnsafe(
      `ALTER TABLE codes ADD COLUMN IF NOT EXISTS sol_mp TEXT;`,
    );
    console.log('✅ sol_neo / sol_mp columns ensured');
  } catch (e) {
    console.warn('⚠️  sol column migration skipped:', (e as Error).message);
  }

  // 🔒 CORS RESTRINGIDO A DOMINIOS OFICIALES
  app.enableCors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, curl, etc.)
      if (!origin) return callback(null, true);

      const envAllowed = (process.env.FRONTEND_URLS || '')
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);

      const allowed = [
        'https://cosmosx.tech',
        'https://www.cosmosx.tech',
        ...envAllowed,
      ];

      if (allowed.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error(`CORS blocked for origin: ${origin}`), false);
    },
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders: 'Content-Type,Authorization,X-Requested-With',
    credentials: true,
  });

  const port = process.env.PORT || 8080;
  await app.listen(port, '0.0.0.0');
  console.log(`Backend NestJS en Railway corriendo en el puerto ${port} con CORS seguro 🔒`);
}

bootstrap();
