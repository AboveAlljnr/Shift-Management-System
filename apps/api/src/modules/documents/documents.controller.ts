import { Controller } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { DocumentsService } from './documents.service';

@ApiTags('Documents')
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}
}
