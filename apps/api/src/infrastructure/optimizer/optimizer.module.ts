import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { OptimizerClient } from './optimizer.client';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [OptimizerClient],
  exports: [OptimizerClient],
})
export class OptimizerModule {}
