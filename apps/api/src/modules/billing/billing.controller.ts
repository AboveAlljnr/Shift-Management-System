import {
  Controller,
  Get,
  Post,
  Body,
  Headers,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';

import { CompanyId } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/roles.decorator';

import { BillingService } from './billing.service';

@ApiTags('Billing')
@Controller('billing')
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @ApiBearerAuth()
  @Get('subscription')
  @ApiOperation({ summary: 'Get active company subscription and seat utilization' })
  async getSubscription(@CompanyId() companyId: string) {
    return this.billingService.getSubscription(companyId);
  }

  @Public()
  @Get('plans')
  @ApiOperation({ summary: 'List available subscription plans' })
  async getPlans() {
    return this.billingService.getPlans();
  }

  @Public()
  @Post('webhook')
  @ApiOperation({ summary: 'Provider billing webhook endpoint (idempotent)' })
  async handleWebhook(
    @Headers('x-provider') provider = 'stripe',
    @Headers('x-event-id') eventId: string,
    @Body() body: any,
  ) {
    const calculatedEventId = eventId || body.id || `evt_${Date.now()}`;
    const eventType = body.type || 'unknown';
    return this.billingService.handleWebhook(provider, calculatedEventId, eventType, body);
  }
}
